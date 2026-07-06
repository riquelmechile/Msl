import { describe, expect, it, vi } from "vitest";
import type { ApprovalRecord, StorefrontProjection } from "@msl/domain";
import {
  collectMedusaPreviewBlockingChecks,
  buildMedusaStorefrontPreview,
  createMedusaPreviewAdapter,
  MedusaWriteBoundaryError,
} from "./index.js";

const projection: StorefrontProjection = {
  id: "projection-1",
  projectionVersion: "projection-1:v1",
  candidateIds: ["candidate-1"],
  status: "preview",
  catalog: {
    collectionHandle: "plasticov-preview",
    products: [
      {
        handle: "vaso-termico",
        title: "Vaso térmico",
        description: "Evidence-backed preview product.",
        variants: [
          {
            sku: "VASO-1",
            title: "Default",
            price: 1000,
            currency: "CLP",
            inventoryQuantity: 12,
            evidenceIds: ["e-stock"],
          },
        ],
        evidenceIds: ["e-product"],
      },
    ],
  },
  content: {
    seoTitle: "Plasticov preview",
    geoCopy: "Evidence-backed owned ecommerce preview.",
    claims: [],
    schemaMetadata: { "@type": "CollectionPage" },
  },
  media: [],
  readiness: { status: "ready", checks: [], generatedAt: "2026-07-05T00:00:00.000Z" },
  evidenceIds: ["e-product", "e-stock"],
  generatedAt: "2026-07-05T00:00:00.000Z",
};

const approval: ApprovalRecord = {
  id: "approval-1",
  actionId: "action-1",
  sellerId: "seller-1",
  approvedBy: "seller",
  approvedAt: new Date("2026-07-05T00:00:00.000Z"),
  exactChangeAccepted: [{ field: "projectionId", from: null, to: projection.id }],
  riskAccepted: "high",
  executionStatus: "not-executed",
};

describe("Medusa preview adapter", () => {
  it("builds a Medusa-ready preview payload without write activation fields", () => {
    const preview = buildMedusaStorefrontPreview(projection);

    expect(preview.projectionId).toBe("projection-1");
    expect(preview.collectionHandle).toBe("plasticov-preview");
    expect(preview.products[0]?.variants[0]?.evidenceIds).toEqual(["e-stock"]);
    expect(JSON.stringify(preview)).not.toMatch(/checkout|payment|publishUrl|publicUrl/i);
  });

  it("returns blocked preview refs when readiness contains blocking checks", async () => {
    const blockedProjection: StorefrontProjection = {
      ...projection,
      readiness: {
        status: "blocked",
        generatedAt: projection.generatedAt,
        checks: [
          {
            passed: false,
            severity: "block",
            code: "stale-stock-evidence",
            evidenceIds: ["e-stale"],
            redactedMessage: "Stock evidence is stale.",
          },
        ],
      },
    };

    expect(collectMedusaPreviewBlockingChecks(blockedProjection)).toHaveLength(1);
    await expect(createMedusaPreviewAdapter().buildPreview(blockedProjection)).resolves.toEqual({
      previewRef: "medusa-preview:projection-1:blocked",
    });
  });

  it("fails blocked readiness before invoking the write boundary", async () => {
    const publish = vi.fn(() =>
      Promise.resolve({ allowed: true as const, publicUrl: "https://example.test" }),
    );
    const blockedProjection: StorefrontProjection = {
      ...projection,
      readiness: {
        status: "approval-required",
        generatedAt: projection.generatedAt,
        checks: [
          {
            passed: false,
            severity: "block",
            code: "missing-readiness-check",
            evidenceIds: ["e-readiness"],
            redactedMessage: "Projection is not ready for publishing.",
          },
        ],
      },
    };

    await expect(
      createMedusaPreviewAdapter({ writeBoundary: { publish } }).publish(
        blockedProjection,
        approval,
      ),
    ).rejects.toMatchObject({ code: "readiness-blocked" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("fails closed for public publish unless an explicit write boundary allows it", async () => {
    await expect(createMedusaPreviewAdapter().publish(projection, approval)).rejects.toMatchObject({
      code: "publishing-disabled",
    });

    await expect(
      createMedusaPreviewAdapter({
        writeBoundary: {
          publish: () => Promise.resolve({ allowed: false, reason: "approval-required" }),
        },
      }).publish(projection, approval),
    ).rejects.toBeInstanceOf(MedusaWriteBoundaryError);

    await expect(
      createMedusaPreviewAdapter({
        writeBoundary: {
          publish: () => Promise.resolve({ allowed: true, publicUrl: "https://example.test" }),
        },
      }).publish(projection, approval),
    ).resolves.toEqual({ publicUrl: "https://example.test" });
  });
});
