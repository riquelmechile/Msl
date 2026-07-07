import { describe, expect, it } from "vitest";
import type { OperationalReadModelReader, OperationalEvidenceQuery, SearchSnapshotsFilter, SnapshotSearchResult } from "@msl/memory";
import type { OperationalEvidence } from "@msl/domain";
import { OperationalEvidenceProvider } from "../../src/conversation/operationalEvidenceProvider.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function mockEvidence(overrides: Partial<OperationalEvidence> = {}): OperationalEvidence {
  return {
    evidenceId: "evt-1",
    snapshotKind: "listing",
    sellerId: "seller-1",
    entityId: "item-1",
    capturedAt: new Date("2026-07-02T10:00:00Z"),
    freshnessStatus: "fresh",
    completeness: "complete",
    source: "operational-read-model",
    ...overrides,
  };
}

function mockReader(
  evidences: Record<string, OperationalEvidence | null>,
): OperationalReadModelReader {
  /* eslint-disable @typescript-eslint/require-await */
  return {
    async findEvidence(query: OperationalEvidenceQuery) {
      const key = query.snapshotKind;
      return evidences[key] ?? null;
    },
    async readSnapshot() {
      return null;
    },
    async listSnapshots() {
      return [];
    },
    async searchSnapshots() {
      return [];
    },
  };
  /* eslint-enable @typescript-eslint/require-await */
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("OperationalEvidenceProvider", () => {
  it("returns formatted context for cost-supplier lane with listing and order evidence", async () => {
    const reader = mockReader({
      listing: mockEvidence({ evidenceId: "evt-42", snapshotKind: "listing" }),
      order: mockEvidence({
        evidenceId: "evt-99",
        snapshotKind: "order",
        capturedAt: new Date("2026-07-02T08:00:00Z"),
      }),
    });

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getEvidenceForLane("cost-supplier", "seller-1");

    expect(result).toContain("[listing] evt-42");
    expect(result).toContain("captured=2026-07-02T10:00:00Z");
    expect(result).toContain("fresh");
    expect(result).toContain("[order] evt-99");
    expect(result).toContain("captured=2026-07-02T08:00:00Z");
  });

  it("deduplicates signal kinds across multiple evidence kinds", async () => {
    // cost-supplier has requiredEvidenceKinds: ["cost", "supplier", "margin"]
    // "cost" → ["listing", "order"], "supplier" → ["listing"], "margin" → ["pricing"]
    // "listing" should appear only once.
    const reader = mockReader({
      listing: mockEvidence({ evidenceId: "evt-1", snapshotKind: "listing" }),
      order: mockEvidence({ evidenceId: "evt-2", snapshotKind: "order" }),
      pricing: mockEvidence({ evidenceId: "evt-3", snapshotKind: "pricing" }),
    });

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getEvidenceForLane("cost-supplier", "seller-1");

    // Should have listing, order, pricing — but not duplicate listing.
    const listingCount = (result.match(/\[listing\]/g) ?? []).length;
    expect(listingCount).toBe(1);
    expect(result).toContain("[order]");
    expect(result).toContain("[pricing:evidence-only]");
  });

  it("returns empty string for unknown lane", async () => {
    const reader = mockReader({});
    const provider = new OperationalEvidenceProvider(reader);
    // "ceo" lane has requiredEvidenceKinds: ["specialist-output", "approval-scope"]
    // which are NOT in the KIND_SIGNAL_MAP → no signals → ""
    const result = await provider.getEvidenceForLane("ceo", "seller-1");
    expect(result).toBe("");
  });

  it("returns empty string when no evidence is found for signal kinds", async () => {
    const reader = mockReader({
      listing: null,
      order: null,
      pricing: null,
    });

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getEvidenceForLane("cost-supplier", "seller-1");
    expect(result).toBe("");
  });

  it("returns partial context when some evidence is missing", async () => {
    const reader = mockReader({
      listing: mockEvidence({ evidenceId: "evt-10", snapshotKind: "listing" }),
      order: null,
      pricing: null,
    });

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getEvidenceForLane("cost-supplier", "seller-1");

    expect(result).toContain("[listing] evt-10");
    expect(result).not.toContain("[order]");
    expect(result).not.toContain("[pricing]");
  });

  it("formats evidence lines within 80 chars", async () => {
    const reader = mockReader({
      listing: mockEvidence({
        evidenceId: "evt-long-id-12345",
        snapshotKind: "listing",
        capturedAt: new Date("2026-07-02T10:00:00Z"),
        freshnessStatus: "fresh",
      }),
    });

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getEvidenceForLane("market-catalog", "seller-1");

    for (const line of result.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it("includes freshness status and age in evidence lines", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const reader = mockReader({
      listing: mockEvidence({
        evidenceId: "evt-stale",
        snapshotKind: "listing",
        capturedAt: new Date(oneHourAgo),
        freshnessStatus: "stale",
      }),
    });

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getEvidenceForLane("cost-supplier", "seller-1");

    expect(result).toContain("stale");
    expect(result).toMatch(/h ago/);
  });

  it("returns evidence for market-catalog lane with market signals", async () => {
    // market-catalog: requiredEvidenceKinds = ["catalog", "stock", "market"]
    // catalog → [listing, order, claim], stock → [stock], market → [pricing, product-ads-insights]
    const reader = mockReader({
      listing: mockEvidence({ evidenceId: "evt-list", snapshotKind: "listing" }),
      order: mockEvidence({ evidenceId: "evt-ord", snapshotKind: "order" }),
      claim: mockEvidence({ evidenceId: "evt-claim", snapshotKind: "claim" }),
      stock: mockEvidence({ evidenceId: "evt-stk", snapshotKind: "stock" }),
      pricing: mockEvidence({ evidenceId: "evt-price", snapshotKind: "pricing" }),
      "product-ads-insights": mockEvidence({
        evidenceId:
          "orm:product-ads-insights:seller-1:2026-06-01_2026-07-01:2026-07-02T10:00:00.000Z",
        snapshotKind: "product-ads-insights",
        capturedAt: new Date("2026-07-02T10:00:00Z"),
      }),
    });

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getEvidenceForLane("market-catalog", "seller-1");

    expect(result).toContain("[listing]");
    expect(result).toContain("[order]");
    expect(result).toContain("[claim]");
    expect(result).toContain("[stock]");
    expect(result).toContain("[pricing:evidence-only]");
    expect(result).toContain("[product-ads-insights]");
    expect(result).toContain("orm:product-ads-insights:seller-1:2026-06-01_2026-07-01");
    expect(result).toContain("captured=2026-07-02T10:00:00Z");
  });

  it("returns read-only pricing evidence for market-catalog lane", async () => {
    const reader = mockReader({
      listing: null,
      order: null,
      claim: null,
      stock: null,
      pricing: mockEvidence({
        evidenceId: "orm:pricing:seller-1:MLC123:2026-07-02T10:00:00.000Z",
        snapshotKind: "pricing",
        capturedAt: new Date("2026-07-02T10:00:00Z"),
      }),
      "product-ads-insights": null,
    });

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getEvidenceForLane("market-catalog", "seller-1");

    expect(result).toContain("[pricing:evidence-only]");
    expect(result).toContain("orm:pricing:seller-1:MLC123");
    expect(result).toContain("captured=2026-07-02T10:00:00Z");
    expect(result).not.toMatch(/update|promotion|image generation/i);
  });

  it("returns read-only pricing evidence for margin evidence on cost-supplier lane", async () => {
    const reader = mockReader({
      listing: null,
      order: null,
      pricing: mockEvidence({
        evidenceId: "orm:pricing:seller-1:MLC999:2026-07-02T10:00:00.000Z",
        snapshotKind: "pricing",
        capturedAt: new Date("2026-07-02T10:00:00Z"),
      }),
    });

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getEvidenceForLane("cost-supplier", "seller-1");

    expect(result).toContain("[pricing:evidence-only]");
    expect(result).toContain("orm:pricing:seller-1:MLC999");
    expect(result).not.toContain("[listing]");
    expect(result).not.toContain("[order]");
  });

  it("omits missing pricing evidence without failing market or margin lanes", async () => {
    const reader = mockReader({
      listing: null,
      order: null,
      claim: null,
      stock: null,
      pricing: null,
      "product-ads-insights": null,
    });

    const provider = new OperationalEvidenceProvider(reader);

    await expect(provider.getEvidenceForLane("market-catalog", "seller-1")).resolves.toBe("");
    await expect(provider.getEvidenceForLane("cost-supplier", "seller-1")).resolves.toBe("");
  });

  it("labels partial pricing evidence as limited context without failing", async () => {
    const reader = mockReader({
      listing: null,
      order: null,
      pricing: mockEvidence({
        evidenceId: "orm:pricing:seller-1:MLC777:2026-07-02T10:00:00.000Z",
        snapshotKind: "pricing",
        completeness: "partial",
        capturedAt: new Date("2026-07-02T10:00:00Z"),
      }),
    });

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getEvidenceForLane("cost-supplier", "seller-1");

    expect(result).toContain("[pricing:limited-evidence]");
    expect(result).toContain("orm:pricing:seller-1:MLC777");
    expect(result).not.toMatch(/update|promotion|image generation/i);
  });

  it("returns evidence for creative-commercial lane", async () => {
    // creative-commercial: requiredEvidenceKinds = ["product", "campaign", "outcome"]
    // product → [listing], campaign → [product-ads-insights], outcome → [order, claim]
    const reader = mockReader({
      listing: mockEvidence({ evidenceId: "evt-prod", snapshotKind: "listing" }),
      "product-ads-insights": mockEvidence({
        evidenceId:
          "orm:product-ads-insights:seller-1:2026-06-01_2026-07-01:2026-07-02T10:00:00.000Z",
        snapshotKind: "product-ads-insights",
        capturedAt: new Date("2026-07-02T10:00:00Z"),
      }),
      order: mockEvidence({ evidenceId: "evt-ord", snapshotKind: "order" }),
      claim: mockEvidence({ evidenceId: "evt-claim", snapshotKind: "claim" }),
    });

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getEvidenceForLane("creative-commercial", "seller-1");

    expect(result).toContain("[listing]");
    expect(result).toContain("[product-ads-insights]");
    expect(result).toContain("[order]");
    expect(result).toContain("[claim]");
    expect(result).toContain("orm:product-ads-insights:seller-1:2026-06-01_2026-07-01");
    expect(result).toContain("captured=2026-07-02T10:00:00Z");
  });

  it("includes evidence IDs and timestamps per spec scenario", async () => {
    const reader = mockReader({
      listing: mockEvidence({
        evidenceId: "evt-42",
        snapshotKind: "listing",
        capturedAt: new Date("2026-07-02T10:00:00Z"),
      }),
    });

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getEvidenceForLane("cost-supplier", "seller-1");

    // Per spec: "output MUST include both the ID and captured_at value"
    expect(result).toContain("evt-42");
    expect(result).toContain("2026-07-02T10:00:00Z");
  });

  it("formats multiple evidence items each on their own line", async () => {
    const reader = mockReader({
      listing: mockEvidence({ evidenceId: "evt-1", snapshotKind: "listing" }),
      order: mockEvidence({ evidenceId: "evt-2", snapshotKind: "order" }),
      pricing: mockEvidence({ evidenceId: "evt-3", snapshotKind: "pricing" }),
    });

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getEvidenceForLane("cost-supplier", "seller-1");
    const lines = result.split("\n");

    expect(lines.length).toBeGreaterThanOrEqual(2);
    // Each line should have its own ID
    expect(lines.some((l) => l.includes("evt-1"))).toBe(true);
    expect(lines.some((l) => l.includes("evt-2"))).toBe(true);
  });
});

// ── getStructuredEvidenceForLane tests ────────────────────────────

function makeSearchResult<TData>(
  kind: string,
  itemId: string,
  data: TData,
  overrides: Partial<SnapshotSearchResult<TData>> = {},
): SnapshotSearchResult<TData> {
  return {
    itemId,
    data,
    capturedAt: "2026-07-02T10:00:00Z",
    freshness: "fresh",
    evidenceId: `orm:${kind}:seller-1:${itemId}:2026-07-02T10:00:00.000Z`,
    ...overrides,
  };
}

describe("getStructuredEvidenceForLane", () => {
  it("returns grouped evidence for cost-supplier lane", async () => {
    const listingData = { title: "Widget", status: "active", price: 1000 };
    const orderData = { status: "paid", total: 5000 };

    const reader: OperationalReadModelReader = {
      findEvidence: () => Promise.resolve(null),
      readSnapshot: () => Promise.resolve(null),
      listSnapshots: () => Promise.resolve([]),
      async searchSnapshots<TData>(filter: SearchSnapshotsFilter) {
        await Promise.resolve(); // mock
        const kind = Array.isArray(filter.kind) ? filter.kind[0] : filter.kind;
        if (kind === "listing") {
          return [makeSearchResult("listing", "MLC-1", listingData as TData)];
        }
        if (kind === "order") {
          return [makeSearchResult("order", "ORD-1", orderData as TData)];
        }
        return [];
      },
    };

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getStructuredEvidenceForLane("cost-supplier", "seller-1");

    expect(result).toHaveProperty("listing");
    expect(result).toHaveProperty("order");
    expect(result["listing"]).toHaveLength(1);
    expect(result["listing"]![0]!.data).toEqual(listingData);
    expect(result["order"]![0]!.data).toEqual(orderData);
  });

  it("returns empty record for unknown lane", async () => {
    const reader: OperationalReadModelReader = {
      findEvidence: () => Promise.resolve(null),
      readSnapshot: () => Promise.resolve(null),
      listSnapshots: () => Promise.resolve([]),
      searchSnapshots: () => Promise.resolve([]),
    };

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getStructuredEvidenceForLane("nonexistent" as never, "seller-1");

    expect(result).toEqual({});
  });

  it("omits signal kinds that return no results", async () => {
    const reader: OperationalReadModelReader = {
      findEvidence: () => Promise.resolve(null),
      readSnapshot: () => Promise.resolve(null),
      listSnapshots: () => Promise.resolve([]),
      async searchSnapshots<TData>(filter: SearchSnapshotsFilter) {
        await Promise.resolve(); // mock
        const kind = Array.isArray(filter.kind) ? filter.kind[0] : filter.kind;
        if (kind === "listing") {
          return [makeSearchResult("listing", "MLC-1", { title: "X" } as TData)];
        }
        return [];
      },
    };

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getStructuredEvidenceForLane("cost-supplier", "seller-1");

    // cost-supplier maps cost→[listing,order], supplier→[listing], margin→[pricing]
    // Only listing returns data
    expect(result).toHaveProperty("listing");
    expect(result).not.toHaveProperty("order");
    expect(result).not.toHaveProperty("pricing");
  });

  it("includes evidence metadata in results", async () => {
    const reader: OperationalReadModelReader = {
      findEvidence: () => Promise.resolve(null),
      readSnapshot: () => Promise.resolve(null),
      listSnapshots: () => Promise.resolve([]),
      async searchSnapshots<TData>() {
        await Promise.resolve(); // mock
        return [makeSearchResult("listing", "MLC-X", { status: "active" } as TData, {
          capturedAt: "2026-07-05T12:00:00Z",
          freshness: "fresh",
          evidenceId: "ev-abc",
        })];
      },
    };

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getStructuredEvidenceForLane("cost-supplier", "seller-1");

    const entry = result["listing"]![0]!;
    expect(entry.capturedAt).toBe("2026-07-05T12:00:00Z");
    expect(entry.freshness).toBe("fresh");
    expect(entry.evidenceId).toBe("ev-abc");
  });

  it("returns empty record when signalKinds list is empty (ceo lane)", async () => {
    const reader: OperationalReadModelReader = {
      findEvidence: () => Promise.resolve(null),
      readSnapshot: () => Promise.resolve(null),
      listSnapshots: () => Promise.resolve([]),
      searchSnapshots: () => Promise.resolve([]),
    };

    const provider = new OperationalEvidenceProvider(reader);
    // ceo lane has requiredEvidenceKinds: ["specialist-output", "approval-scope"]
    // which are NOT in KIND_SIGNAL_MAP → empty
    const result = await provider.getStructuredEvidenceForLane("ceo", "seller-1");
    expect(result).toEqual({});
  });

  it("handles lane with multiple signal kinds of the same type", async () => {
    // cost-supplier: cost→[listing,order], supplier→[listing] — listing deduped
    const reader: OperationalReadModelReader = {
      findEvidence: () => Promise.resolve(null),
      readSnapshot: () => Promise.resolve(null),
      listSnapshots: () => Promise.resolve([]),
      async searchSnapshots<TData>(filter: SearchSnapshotsFilter) {
        await Promise.resolve(); // mock
        const kind = Array.isArray(filter.kind) ? filter.kind[0] : filter.kind;
        if (kind === "listing") {
          return [makeSearchResult("listing", "MLC-1", { title: "A" } as TData)];
        }
        return [];
      },
    };

    const provider = new OperationalEvidenceProvider(reader);
    const result = await provider.getStructuredEvidenceForLane("cost-supplier", "seller-1");

    // listing called once (deduped), returns 1 result
    expect(result["listing"]).toHaveLength(1);
  });
});
