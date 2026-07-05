import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listStoredProjectionIds,
  loadStoredProjectionResult,
  resolveProjectionDirectory,
} from "../apps/web/app/storefront/[projectionId]/projectionLoader.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("storefront projection loader", () => {
  it("discovers the demo projection from the workspace cwd", async () => {
    await expect(resolveProjectionDirectory(process.cwd())).resolves.toBe(
      join(process.cwd(), "apps", "web", "data", "storefront-projections"),
    );
    await expect(listStoredProjectionIds()).resolves.toContainEqual({
      projectionId: "demo-preview",
    });
  });

  it("resolves projection data from the app cwd layout", async () => {
    await expect(resolveProjectionDirectory(join(process.cwd(), "apps", "web"))).resolves.toBe(
      join(process.cwd(), "apps", "web", "data", "storefront-projections"),
    );
  });

  it("loads valid projections and exposes static params", async () => {
    const directory = await createProjectionDirectory();
    await writeFile(
      join(directory, "valid-preview.json"),
      JSON.stringify(projectionFixture("valid-preview")),
    );

    await expect(listStoredProjectionIds(directory)).resolves.toEqual([
      { projectionId: "valid-preview" },
    ]);
    await expect(loadStoredProjectionResult("valid-preview", directory)).resolves.toMatchObject({
      status: "found",
      projection: { id: "valid-preview", content: { seoTitle: "Valid preview" } },
    });
  });

  it("distinguishes missing, malformed, and corrupt projections", async () => {
    const directory = await createProjectionDirectory();
    await writeFile(join(directory, "corrupt-preview.json"), "{not-json");
    await writeFile(join(directory, "invalid-shape.json"), JSON.stringify({ id: "invalid-shape" }));
    await writeFile(
      join(directory, "invalid-nested-shape.json"),
      JSON.stringify({ ...projectionFixture("invalid-nested-shape"), catalog: { products: [{}] } }),
    );

    await expect(loadStoredProjectionResult("missing-preview", directory)).resolves.toEqual({
      status: "missing",
    });
    await expect(loadStoredProjectionResult("../escape", directory)).resolves.toEqual({
      status: "invalid",
      reason: "malformed-id",
    });
    await expect(loadStoredProjectionResult("corrupt-preview", directory)).resolves.toEqual({
      status: "invalid",
      reason: "invalid-json",
    });
    await expect(loadStoredProjectionResult("invalid-shape", directory)).resolves.toEqual({
      status: "invalid",
      reason: "invalid-shape",
    });
    await expect(loadStoredProjectionResult("invalid-nested-shape", directory)).resolves.toEqual({
      status: "invalid",
      reason: "invalid-shape",
    });
  });

  it("excludes malformed IDs, corrupt JSON, and invalid nested projection shapes from static params", async () => {
    const directory = await createProjectionDirectory();
    await writeFile(
      join(directory, "valid-preview.json"),
      JSON.stringify(projectionFixture("valid-preview")),
    );
    await writeFile(join(directory, "bad.id.json"), JSON.stringify(projectionFixture("bad.id")));
    await writeFile(join(directory, "corrupt-preview.json"), "{not-json");
    await writeFile(join(directory, "invalid-shape.json"), JSON.stringify({ id: "invalid-shape" }));
    await writeFile(
      join(directory, "invalid-nested-shape.json"),
      JSON.stringify({ ...projectionFixture("invalid-nested-shape"), catalog: { products: [{}] } }),
    );

    await expect(listStoredProjectionIds(directory)).resolves.toEqual([
      { projectionId: "valid-preview" },
    ]);
  });

  it("rejects projections with invalid variant currency codes", async () => {
    const directory = await createProjectionDirectory();
    const invalidCurrencyProjection = projectionFixture("invalid-currency");
    invalidCurrencyProjection.catalog.products[0]!.variants[0]!.currency = "invalid-currency";

    await writeFile(
      join(directory, "valid-preview.json"),
      JSON.stringify(projectionFixture("valid-preview")),
    );
    await writeFile(
      join(directory, "invalid-currency.json"),
      JSON.stringify(invalidCurrencyProjection),
    );

    await expect(loadStoredProjectionResult("invalid-currency", directory)).resolves.toEqual({
      status: "invalid",
      reason: "invalid-shape",
    });
    await expect(listStoredProjectionIds(directory)).resolves.toEqual([
      { projectionId: "valid-preview" },
    ]);
  });

  it("rejects projections with missing or unsafe candidate IDs", async () => {
    const directory = await createProjectionDirectory();
    const missingCandidateIds = projectionFixture("missing-candidates") as Record<string, unknown>;
    delete missingCandidateIds.candidateIds;
    await writeFile(
      join(directory, "missing-candidates.json"),
      JSON.stringify(missingCandidateIds),
    );
    await writeFile(
      join(directory, "empty-candidates.json"),
      JSON.stringify({ ...projectionFixture("empty-candidates"), candidateIds: [] }),
    );
    await writeFile(
      join(directory, "unsafe-candidates.json"),
      JSON.stringify({ ...projectionFixture("unsafe-candidates"), candidateIds: ["../escape"] }),
    );

    await expect(loadStoredProjectionResult("missing-candidates", directory)).resolves.toEqual({
      status: "invalid",
      reason: "invalid-shape",
    });
    await expect(loadStoredProjectionResult("empty-candidates", directory)).resolves.toEqual({
      status: "invalid",
      reason: "invalid-shape",
    });
    await expect(loadStoredProjectionResult("unsafe-candidates", directory)).resolves.toEqual({
      status: "invalid",
      reason: "invalid-shape",
    });
  });

  it("loads blocked fallback projections with empty candidate IDs for static visibility", async () => {
    const directory = await createProjectionDirectory();
    const blockedProjection = projectionFixture("blocked-empty-candidates");
    blockedProjection.candidateIds = [];
    blockedProjection.catalog.products = [];
    blockedProjection.content.claims = [];
    blockedProjection.media = [];
    blockedProjection.readiness = {
      status: "blocked",
      checks: [
        {
          passed: false,
          severity: "block",
          code: "incomplete-evidence",
          evidenceIds: [],
          redactedMessage: "No storefront candidates were available for deterministic projection.",
        },
      ],
      generatedAt: "2026-07-05T00:00:00.000Z",
    };
    blockedProjection.evidenceIds = [];

    await writeFile(
      join(directory, "blocked-empty-candidates.json"),
      JSON.stringify(blockedProjection),
    );

    await expect(listStoredProjectionIds(directory)).resolves.toEqual([
      { projectionId: "blocked-empty-candidates" },
    ]);
    await expect(
      loadStoredProjectionResult("blocked-empty-candidates", directory),
    ).resolves.toMatchObject({
      status: "found",
      projection: {
        id: "blocked-empty-candidates",
        candidateIds: [],
        readiness: { status: "blocked" },
      },
    });
  });

  it("rejects external media URLs in static preview projections", async () => {
    const directory = await createProjectionDirectory();
    const externalMediaProjection = projectionFixture("external-media");
    externalMediaProjection.media[0]!.src = "https://example.test/image.jpg";

    await writeFile(
      join(directory, "external-media.json"),
      JSON.stringify(externalMediaProjection),
    );

    await expect(loadStoredProjectionResult("external-media", directory)).resolves.toEqual({
      status: "invalid",
      reason: "invalid-shape",
    });
  });

  it("returns an empty static param list with a safe warning when the directory is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "msl-storefront-projections-missing-"));
    tempDirectories.push(root);
    const missingDirectory = join(root, "missing");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(listStoredProjectionIds(missingDirectory)).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith("Storefront projection directory is not readable", {
      directory: missingDirectory,
      reason: "ENOENT",
    });
    warn.mockRestore();
  });
});

async function createProjectionDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "msl-storefront-projections-"));
  tempDirectories.push(directory);
  return directory;
}

function projectionFixture(id: string) {
  return {
    id,
    candidateIds: ["candidate-1"],
    status: "preview",
    catalog: {
      collectionHandle: "valid-preview",
      products: [
        {
          handle: "sample-product",
          title: "Sample product",
          description: "Evidence-backed storefront item.",
          variants: [
            {
              sku: "sample-sku",
              title: "Default variant",
              price: 12990,
              currency: "CLP",
              evidenceIds: ["evidence-1"],
            },
          ],
          evidenceIds: ["evidence-1"],
        },
      ],
    },
    content: {
      seoTitle: "Valid preview",
      geoCopy: "Valid projection.",
      claims: [
        {
          id: "claim-1",
          text: "Evidence-backed claim.",
          claimType: "benefit",
          evidenceIds: ["evidence-1"],
          status: "allowed",
        },
      ],
      schemaMetadata: {},
    },
    media: [
      {
        src: "/storefront-preview/sample-product.svg",
        alt: "Sample product",
        width: 1200,
        height: 800,
        sizes: "100vw",
        hash: "image-hash",
        priority: true,
        evidenceIds: ["evidence-1"],
      },
    ],
    readiness: {
      status: "ready",
      checks: [
        {
          passed: true,
          severity: "warning",
          code: "missing-readiness-check",
          evidenceIds: ["evidence-1"],
          redactedMessage: "Readiness check stored for preview.",
        },
      ],
      generatedAt: "2026-07-05T00:00:00.000Z",
    },
    evidenceIds: ["evidence-1"],
    generatedAt: "2026-07-05T00:00:00.000Z",
  };
}
