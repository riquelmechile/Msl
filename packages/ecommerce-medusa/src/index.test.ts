import { describe, expect, it, vi } from "vitest";
import type { ApprovalRecord, StorefrontProjection } from "@msl/domain";
import {
  collectMedusaPreviewBlockingChecks,
  buildMedusaStorefrontPreview,
  createConfiguredMedusaWriteBoundary,
  createFailClosedMedusaWriteBoundary,
  createMedusaPreviewAdapter,
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

  it("fails blocked readiness before preview publish can reach a write path", async () => {
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
      createMedusaPreviewAdapter().publish(blockedProjection, approval),
    ).rejects.toMatchObject({ code: "readiness-blocked" });
  });

  it("keeps preview publish fail-closed instead of acting as a live write path", async () => {
    await expect(createMedusaPreviewAdapter().publish(projection, approval)).rejects.toMatchObject({
      code: "publishing-disabled",
    });
  });

  it("provides fail-closed runtime boundaries and never fakes configured write success", async () => {
    const failClosed = createFailClosedMedusaWriteBoundary();
    expect(failClosed.isConfigured()).toBe(false);
    await expect(
      failClosed.publish({
        projection,
        approval,
        auditId: "audit-1",
        rollbackRef: "rollback-1",
        operation: "publish",
      }),
    ).resolves.toEqual({ allowed: false, reason: "credentials-missing" });

    const configuredWithoutWriter = createConfiguredMedusaWriteBoundary({
      enabled: true,
      backendUrl: "https://medusa.example.test/",
      adminApiToken: "redacted",
    });
    expect(configuredWithoutWriter.isConfigured()).toBe(false);
    await expect(
      configuredWithoutWriter.activateCheckout({
        projection,
        approval,
        auditId: "audit-1",
        rollbackRef: "rollback-1",
        operation: "checkout-activation",
      }),
    ).resolves.toEqual({ allowed: false, reason: "publishing-disabled" });

    const liveWriter = {
      publish: vi.fn(() =>
        Promise.resolve({
          allowed: true as const,
          publicUrl: "https://medusa.example.test/store/owned",
        }),
      ),
      activateCheckout: vi.fn(() =>
        Promise.resolve({
          allowed: true as const,
          publicUrl: "https://medusa.example.test/store/owned",
        }),
      ),
    };
    const configured = createConfiguredMedusaWriteBoundary({
      enabled: true,
      backendUrl: "https://medusa.example.test/",
      adminApiToken: "redacted",
      liveWriter,
    });
    expect(configured.isConfigured()).toBe(true);
    await expect(
      configured.activateCheckout({
        projection,
        approval,
        auditId: "audit-1",
        rollbackRef: "rollback-1",
        operation: "checkout-activation",
      }),
    ).resolves.toEqual({ allowed: true, publicUrl: "https://medusa.example.test/store/owned" });
    expect(liveWriter.activateCheckout).toHaveBeenCalledTimes(1);
  });

  it("blocks publish and checkout activation independently when credentials are missing", async () => {
    const failClosed = createFailClosedMedusaWriteBoundary();

    await expect(
      failClosed.publish({
        projection,
        approval,
        auditId: "audit-publish-1",
        rollbackRef: "rollback-publish-1",
        operation: "publish",
      }),
    ).resolves.toEqual({ allowed: false, reason: "credentials-missing" });

    await expect(
      failClosed.activateCheckout({
        projection,
        approval,
        auditId: "audit-checkout-1",
        rollbackRef: "rollback-checkout-1",
        operation: "checkout-activation",
      }),
    ).resolves.toEqual({ allowed: false, reason: "credentials-missing" });
  });

  it("never activates checkout when only publish is explicitly configured", async () => {
    const publishOnlyWriter = {
      publish: vi.fn(() =>
        Promise.resolve({
          allowed: true as const,
          publicUrl: "https://medusa.example.test/store/owned",
        }),
      ),
      activateCheckout: vi.fn(() =>
        Promise.resolve({ allowed: false as const, reason: "publishing-disabled" as const }),
      ),
    };
    const configured = createConfiguredMedusaWriteBoundary({
      enabled: true,
      backendUrl: "https://medusa.example.test/",
      adminApiToken: "redacted",
      liveWriter: publishOnlyWriter,
    });

    expect(configured.isConfigured()).toBe(true);
    await expect(
      configured.publish({
        projection,
        approval,
        auditId: "audit-publish-only-1",
        rollbackRef: "rollback-publish-only-1",
        operation: "publish",
      }),
    ).resolves.toEqual({ allowed: true, publicUrl: "https://medusa.example.test/store/owned" });
    expect(publishOnlyWriter.publish).toHaveBeenCalledTimes(1);

    await expect(
      configured.activateCheckout({
        projection,
        approval,
        auditId: "audit-checkout-only-1",
        rollbackRef: "rollback-checkout-only-1",
        operation: "checkout-activation",
      }),
    ).resolves.toEqual({ allowed: false, reason: "publishing-disabled" });
    expect(publishOnlyWriter.activateCheckout).toHaveBeenCalledTimes(1);
  });
});
