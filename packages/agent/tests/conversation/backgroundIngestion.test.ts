import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  processSellerListings,
  processSellerPricing,
  processSellerProductAds,
  resolveDailyInsightsDeepSeekUserId,
  selectRotatedPricingListings,
  paginateAll,
  KIND_FRESHNESS_TTL,
  KIND_DEFAULT_MAX_PAGES,
  PRICING_MAX_ITEMS_PER_CYCLE,
} from "../../src/conversation/backgroundIngestion.js";
import type {
  BackgroundIngestionConfig,
  PaginationConfig,
} from "../../src/conversation/backgroundIngestion.js";
import { createGraphEngine, createSqliteOperationalReadModel } from "@msl/memory";
import type { OperationalReadModel } from "@msl/memory";
import type {
  MlcApiClient,
  MlcClaimSummary,
  MlcListingSummary,
  MlcListingsSnapshot,
  MlcOrderSummary,
  MlcPriceToWinSnapshot,
  MlcPriceToWinSummary,
  MlcProductAdsInsights,
  MlcProductAdsInsightsSnapshot,
  MlcQuestionSummary,
  MlcReputationSummary,
} from "@msl/mercadolibre";

// ── Mock MlcApiClient ─────────────────────────────────────────────────

function mockMlcApiClient(listings: MlcListingSummary[]): MlcApiClient {
  return {
    getListings: vi.fn().mockResolvedValue({
      sellerId: "plasticov",
      kind: "listing",
      source: "mercadolibre-api",
      data: listings,
      completeness: "complete",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "listing",
        risk: "medium",
        capturedAt: new Date("2026-07-01T12:00:00Z"),
        maxAgeMs: 60 * 60 * 1000,
        status: "fresh",
      },
      confidence: "high",
    } satisfies MlcListingsSnapshot),
    // Stubs for required methods not exercised in this test
    getItem: vi.fn().mockRejectedValue(new Error("not implemented")),
    getOrders: vi.fn().mockResolvedValue({
      data: [],
      sellerId: "",
      kind: "order",
      source: "mercadolibre-api",
      completeness: "complete",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "order",
        risk: "critical",
        capturedAt: new Date(),
        maxAgeMs: 300000,
        status: "fresh",
      },
      confidence: "high",
    }),
    getMessages: vi.fn().mockRejectedValue(new Error("not implemented")),
    getReputation: vi.fn().mockRejectedValue(new Error("not implemented")),
    getCategoryAttributes: vi.fn().mockRejectedValue(new Error("not implemented")),
    getCategoryTechnicalSpecs: vi.fn().mockRejectedValue(new Error("not implemented")),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("DeepSeek daily insights routing", () => {
  it("uses the market-catalog lane and available sellers for background insight user_id", () => {
    expect(resolveDailyInsightsDeepSeekUserId(["plasticov", "maustian"])).toBe(
      "msl-lane-market-catalog-seller-plasticov-maustian-agent-background-ingestion",
    );
  });
});

describe("processSellerListings dual-write", () => {
  let db: Database.Database;
  let operationalStore: OperationalReadModel;
  let baseConfig: BackgroundIngestionConfig;

  beforeEach(() => {
    const engine = createGraphEngine(":memory:");
    db = engine.db;
    operationalStore = createSqliteOperationalReadModel(db);

    baseConfig = {
      mlcClient: mockMlcApiClient([]),
      engine,
      sendProactiveMessage: vi.fn().mockResolvedValue(undefined),
      listActiveChats: vi.fn().mockResolvedValue([]),
      sellerIds: ["plasticov"],
    };
  });

  it("upserts listings into the operational store during ingestion", async () => {
    const listing: MlcListingSummary = {
      id: "MLC123",
      title: "Test Product",
      price: 1000,
      currencyId: "CLP",
      status: "active",
      categoryId: "MLC1234",
    };

    const mlcClient = mockMlcApiClient([listing]);
    const config: BackgroundIngestionConfig = {
      ...baseConfig,
      mlcClient,
      operationalStore,
    };

    await processSellerListings(config, "plasticov", "Plasticov");

    // Verify the listing was persisted to the operational store
    const evidence = await operationalStore.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC123",
    });

    expect(evidence).not.toBeNull();
    expect(evidence!.evidenceId).toMatch(/^orm:listing:plasticov:MLC123:/);
    expect(evidence!.snapshotKind).toBe("listing");
    expect(evidence!.freshnessStatus).toBe("fresh");
    expect(evidence!.completeness).toBe("complete");
    expect(evidence!.source).toBe("operational-read-model");
  });

  it("does not call operational store when config does not include it", async () => {
    const listing: MlcListingSummary = {
      id: "MLC456",
      title: "No Store Test",
      price: 500,
      currencyId: "CLP",
      status: "active",
    };

    const mlcClient = mockMlcApiClient([listing]);
    const config: BackgroundIngestionConfig = {
      ...baseConfig,
      mlcClient,
      // NO operationalStore — should skip dual-write silently
    };

    await processSellerListings(config, "plasticov", "Plasticov");

    // Verify no snapshot was written
    const evidence = await operationalStore.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "listing",
    });
    expect(evidence).toBeNull();
  });

  it("writes a checkpoint after processing all listings", async () => {
    const listings: MlcListingSummary[] = [
      { id: "MLC111", title: "Item 1", price: 100, currencyId: "CLP", status: "active" },
      { id: "MLC222", title: "Item 2", price: 200, currencyId: "CLP", status: "active" },
    ];

    const mlcClient = mockMlcApiClient(listings);
    const config: BackgroundIngestionConfig = {
      ...baseConfig,
      mlcClient,
      operationalStore,
    };

    await processSellerListings(config, "plasticov", "Plasticov");

    // Verify both listings were stored
    const snap1 = await operationalStore.readSnapshot<MlcListingSummary>({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC111",
    });
    expect(snap1).not.toBeNull();

    const snap2 = await operationalStore.readSnapshot<MlcListingSummary>({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC222",
    });
    expect(snap2).not.toBeNull();

    // Verify checkpoint was written
    const checkpoint = await operationalStore.getCheckpoint("plasticov", "listing");
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.seller_id).toBe("plasticov");
    expect(checkpoint!.kind).toBe("listing");
    // last_captured_at should be a valid ISO date string
    expect(() => new Date(checkpoint!.last_captured_at)).not.toThrow();
  });

  it("isolates snapshots per seller lane", async () => {
    const plasticovListing: MlcListingSummary = {
      id: "MLC-P1",
      title: "Plasticov Item",
      price: 100,
      currencyId: "CLP",
      status: "active",
    };
    const maustianListing: MlcListingSummary = {
      id: "MLC-M1",
      title: "Maustian Item",
      price: 200,
      currencyId: "CLP",
      status: "active",
    };

    // Process Plasticov
    const pConfig: BackgroundIngestionConfig = {
      ...baseConfig,
      mlcClient: mockMlcApiClient([plasticovListing]),
      operationalStore,
    };
    await processSellerListings(pConfig, "plasticov", "Plasticov");

    // Process Maustian
    const mConfig: BackgroundIngestionConfig = {
      ...baseConfig,
      mlcClient: mockMlcApiClient([maustianListing]),
      operationalStore,
    };
    await processSellerListings(mConfig, "maustian", "Maustian");

    // Plasticov can only see own listings
    const pEvidence = await operationalStore.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "listing",
    });
    expect(pEvidence).not.toBeNull();
    expect(pEvidence!.sellerId).toBe("plasticov");

    // Maustian can only see own listings
    const mEvidence = await operationalStore.findEvidence({
      sellerId: "maustian",
      snapshotKind: "listing",
    });
    expect(mEvidence).not.toBeNull();
    expect(mEvidence!.sellerId).toBe("maustian");

    // Plasticov cannot see Maustian data
    const pSeesM = await operationalStore.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC-M1",
    });
    expect(pSeesM).toBeNull();
  });

  it("skips listings without an item id", async () => {
    const listings: MlcListingSummary[] = [
      { id: "MLC-OK", title: "OK", price: 100, currencyId: "CLP", status: "active" },
      // listing without id — should be skipped by the loop's `if (!itemId) continue;`
      { id: "", title: "No ID", price: 50, currencyId: "CLP", status: "active" },
    ];

    const mlcClient = mockMlcApiClient(listings);
    const config: BackgroundIngestionConfig = {
      ...baseConfig,
      mlcClient,
      operationalStore,
    };

    await processSellerListings(config, "plasticov", "Plasticov");

    // The valid listing should be stored
    const valid = await operationalStore.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC-OK",
    });
    expect(valid).not.toBeNull();

    // Only one snapshot should exist (the empty-id listing was skipped before dual-write)
    const rowCount = db
      .prepare("SELECT COUNT(*) as cnt FROM operational_snapshots WHERE seller_id = ? AND kind = ?")
      .get("plasticov", "listing") as { cnt: number };
    expect(rowCount.cnt).toBe(1);
  });
});

// ── paginateAll unit tests ──────────────────────────────────────────

describe("paginateAll", () => {
  it("exhausts all pages when total > pageSize", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ total: 5, results: [{ id: "A" }, { id: "B" }] })
      .mockResolvedValueOnce({ total: 5, results: [{ id: "C" }, { id: "D" }] })
      .mockResolvedValueOnce({ total: 5, results: [{ id: "E" }] });

    const config: PaginationConfig = { maxPages: 10, pageSize: 2 };
    const results = await paginateAll(fetchPage, config);

    expect(results).toHaveLength(5);
    expect(results.map((r) => (r as { id: string }).id)).toEqual(["A", "B", "C", "D", "E"]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("respects maxPages and stops early", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      total: 100,
      results: [{ id: "X" }, { id: "Y" }],
    });

    const config: PaginationConfig = { maxPages: 2, pageSize: 2 };
    const results = await paginateAll(fetchPage, config);

    expect(results).toHaveLength(4); // 2 pages × 2 items
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("stops on empty page (exhaustion)", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ total: 10, results: [{ id: "A" }] })
      .mockResolvedValueOnce({ total: 10, results: [] });

    const config: PaginationConfig = { maxPages: 10, pageSize: 1 };
    const results = await paginateAll(fetchPage, config);

    expect(results).toHaveLength(1);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("handles zero results cleanly", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ total: 0, results: [] });
    const config: PaginationConfig = { maxPages: 10 };
    const results = await paginateAll(fetchPage, config);
    expect(results).toHaveLength(0);
  });

  it("uses default pageSize of 200 when not specified", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ total: 50, results: [{ id: "Z" }] });
    const config: PaginationConfig = { maxPages: 5 };
    await paginateAll(fetchPage, config);
    expect(fetchPage).toHaveBeenCalledWith(0);
  });
});

// ── Freshness TTL constants ──────────────────────────────────────────

describe("KIND_FRESHNESS_TTL", () => {
  it("has TTLs for all supported operational entity kinds", () => {
    expect(KIND_FRESHNESS_TTL.claim).toBe(60 * 60 * 1000);
    expect(KIND_FRESHNESS_TTL.order).toBe(60 * 60 * 1000);
    expect(KIND_FRESHNESS_TTL.question).toBe(2 * 60 * 60 * 1000);
    expect(KIND_FRESHNESS_TTL.message).toBe(6 * 60 * 60 * 1000);
    expect(KIND_FRESHNESS_TTL.reputation).toBe(6 * 60 * 60 * 1000);
    expect(KIND_FRESHNESS_TTL["product-ads-insights"]).toBe(24 * 60 * 60 * 1000);
    expect(KIND_FRESHNESS_TTL.pricing).toBe(6 * 60 * 60 * 1000);
  });
});

describe("KIND_DEFAULT_MAX_PAGES", () => {
  it("defaults reputation to 1 page (single snapshot per cycle)", () => {
    expect(KIND_DEFAULT_MAX_PAGES.reputation).toBe(1);
  });

  it("defaults Product Ads to 1 page (single seller-level snapshot per cycle)", () => {
    expect(KIND_DEFAULT_MAX_PAGES["product-ads-insights"]).toBe(1);
  });

  it("defaults claims, orders, questions, and messages to 100 pages", () => {
    expect(KIND_DEFAULT_MAX_PAGES.claim).toBe(100);
    expect(KIND_DEFAULT_MAX_PAGES.order).toBe(100);
    expect(KIND_DEFAULT_MAX_PAGES.question).toBe(100);
    expect(KIND_DEFAULT_MAX_PAGES.message).toBe(100);
  });
});

describe("processSellerProductAds", () => {
  let db: Database.Database;
  let operationalStore: OperationalReadModel;
  let baseConfig: BackgroundIngestionConfig;

  function productAdsSnapshot(overrides: Partial<MlcProductAdsInsightsSnapshot> = {}) {
    return {
      sellerId: "plasticov",
      kind: "product-ads-insights",
      source: "mercadolibre-api",
      data: {
        advertiser: { id: "adv-1", siteId: "MLC", productId: "PADS" },
        dateFrom: "2026-06-01",
        dateTo: "2026-07-01",
        campaigns: [{ id: "campaign-1", metrics: { roas: 4.2, cost: 1000 } }],
        ads: [{ id: "ad-1", itemId: "MLC123", metrics: { roas: 3.7 } }],
        noMutationExecuted: true,
        performanceMetric: "roas",
        transitionalMetrics: { acosTargetDeprecatedAfter: "2026-03-30" },
      },
      completeness: "complete",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "product-ads-insights",
        risk: "medium",
        capturedAt: new Date("2026-07-01T12:00:00Z"),
        maxAgeMs: 24 * 60 * 60 * 1000,
        status: "fresh",
      },
      confidence: "high",
      ...overrides,
    } satisfies MlcProductAdsInsightsSnapshot;
  }

  beforeEach(() => {
    const engine = createGraphEngine(":memory:");
    db = engine.db;
    operationalStore = createSqliteOperationalReadModel(db);
    baseConfig = {
      mlcClient: mockMlcApiClient([]),
      engine,
      sendProactiveMessage: vi.fn().mockResolvedValue(undefined),
      listActiveChats: vi.fn().mockResolvedValue([]),
      sellerIds: ["plasticov"],
      operationalStore,
    };
  });

  it("persists Product Ads insights with date-range entity ID and ROAS metadata", async () => {
    const getProductAdsInsights = vi.fn().mockResolvedValue(productAdsSnapshot());
    const config = {
      ...baseConfig,
      mlcClient: { ...baseConfig.mlcClient, getProductAdsInsights },
    };

    await expect(processSellerProductAds(config, "plasticov")).resolves.toEqual({
      persisted: true,
    });

    expect(getProductAdsInsights).toHaveBeenCalledOnce();
    expect(getProductAdsInsights).toHaveBeenCalledWith(
      "plasticov",
      expect.objectContaining({ limit: 50, offset: 0 }),
    );

    const snapshot = await operationalStore.readSnapshot<MlcProductAdsInsights>({
      sellerId: "plasticov",
      snapshotKind: "product-ads-insights",
      entityId: "2026-06-01_2026-07-01",
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.evidence.evidenceId).toMatch(
      /^orm:product-ads-insights:plasticov:2026-06-01_2026-07-01:/,
    );
    expect(Array.isArray(snapshot!.data)).toBe(false);
    const data = snapshot!.data as MlcProductAdsInsights;
    expect(data.noMutationExecuted).toBe(true);
    expect(data.performanceMetric).toBe("roas");
    expect(data.transitionalMetrics.acosTargetDeprecatedAfter).toBe("2026-03-30");
    expect(snapshot!.freshness.status).toBe("fresh");
  });

  it("writes the Product Ads checkpoint only after snapshot persistence succeeds", async () => {
    const getProductAdsInsights = vi.fn().mockResolvedValue(productAdsSnapshot());
    const upsertSnapshot = vi.fn().mockResolvedValue(undefined);
    const upsertCheckpoint = vi.fn().mockResolvedValue(undefined);
    const config = {
      ...baseConfig,
      mlcClient: { ...baseConfig.mlcClient, getProductAdsInsights },
      operationalStore: { ...operationalStore, upsertSnapshot, upsertCheckpoint },
    };

    await processSellerProductAds(config, "plasticov");

    expect(upsertSnapshot).toHaveBeenCalledOnce();
    expect(upsertCheckpoint).toHaveBeenCalledWith(
      "plasticov",
      "product-ads-insights",
      expect.any(String),
    );
    expect(upsertCheckpoint.mock.invocationCallOrder[0]).toBeGreaterThan(
      upsertSnapshot.mock.invocationCallOrder[0]!,
    );
  });

  it("does not checkpoint when Product Ads snapshot persistence fails", async () => {
    const getProductAdsInsights = vi.fn().mockResolvedValue(productAdsSnapshot());
    const upsertCheckpoint = vi.fn().mockResolvedValue(undefined);
    const config = {
      ...baseConfig,
      mlcClient: { ...baseConfig.mlcClient, getProductAdsInsights },
      operationalStore: {
        ...operationalStore,
        upsertSnapshot: vi.fn().mockRejectedValue(new Error("write failed")),
        upsertCheckpoint,
      },
    };

    await expect(processSellerProductAds(config, "plasticov")).rejects.toThrow("write failed");
    expect(upsertCheckpoint).not.toHaveBeenCalled();
  });

  it("skips missing Product Ads client without snapshots or checkpoints", async () => {
    const result = await processSellerProductAds(baseConfig, "plasticov");

    expect(result).toEqual({ persisted: false });
    expect(
      db
        .prepare("SELECT COUNT(*) as cnt FROM operational_snapshots WHERE kind = ?")
        .get("product-ads-insights"),
    ).toEqual({ cnt: 0 });
    expect(await operationalStore.getCheckpoint("plasticov", "product-ads-insights")).toBeNull();
  });

  it.each([401, 403, 404])("treats Product Ads HTTP %i as graceful no-data", async (status) => {
    const err = Object.assign(new Error(`Product Ads ${status}`), { status });
    const config = {
      ...baseConfig,
      mlcClient: {
        ...baseConfig.mlcClient,
        getProductAdsInsights: vi.fn().mockRejectedValue(err),
      },
    };

    await expect(processSellerProductAds(config, "plasticov")).resolves.toEqual({
      persisted: false,
    });
    expect(await operationalStore.getCheckpoint("plasticov", "product-ads-insights")).toBeNull();
  });

  it("treats missing advertiser errors as graceful no-data", async () => {
    const config = {
      ...baseConfig,
      mlcClient: {
        ...baseConfig.mlcClient,
        getProductAdsInsights: vi.fn().mockRejectedValue(new Error("no advertiser account")),
      },
    };

    await expect(processSellerProductAds(config, "plasticov")).resolves.toEqual({
      persisted: false,
    });
    expect(await operationalStore.getCheckpoint("plasticov", "product-ads-insights")).toBeNull();
  });
});

describe("processSellerPricing", () => {
  let db: Database.Database;
  let operationalStore: OperationalReadModel;
  let baseConfig: BackgroundIngestionConfig;

  function priceToWinSnapshot(
    itemId: string,
    overrides: Partial<MlcPriceToWinSnapshot> = {},
  ): MlcPriceToWinSnapshot {
    return {
      sellerId: "plasticov",
      kind: "pricing",
      source: "mercadolibre-api",
      data: {
        itemId,
        currentPrice: 12000,
        priceToWin: 11500,
        status: "winning",
        catalogProductId: "MLC999",
        boosts: [],
      } satisfies MlcPriceToWinSummary,
      completeness: "complete",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "pricing",
        risk: "medium",
        capturedAt: new Date("2026-07-01T12:00:00Z"),
        maxAgeMs: 6 * 60 * 60 * 1000,
        status: "fresh",
      },
      confidence: "high",
      ...overrides,
    };
  }

  beforeEach(() => {
    const engine = createGraphEngine(":memory:");
    db = engine.db;
    operationalStore = createSqliteOperationalReadModel(db);
    baseConfig = {
      mlcClient: mockMlcApiClient([]),
      engine,
      sendProactiveMessage: vi.fn().mockResolvedValue(undefined),
      listActiveChats: vi.fn().mockResolvedValue([]),
      sellerIds: ["plasticov"],
      operationalStore,
    };
  });

  it("selects a deterministic rotated batch bounded by the configured cap", () => {
    const listings: MlcListingSummary[] = ["MLC5", "MLC1", "MLC3", "MLC2", "MLC4"].map((id) => ({
      id,
    }));

    const first = selectRotatedPricingListings("plasticov", listings, 2, "2026-07-01T00:00:00Z");
    const second = selectRotatedPricingListings("plasticov", listings, 2, "2026-07-01T00:00:00Z");

    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first.every((listing) => listing.id.startsWith("MLC"))).toBe(true);
    expect(PRICING_MAX_ITEMS_PER_CYCLE).toBe(20);
  });

  it("calls price-to-win reads only up to the configured cap", async () => {
    const listings: MlcListingSummary[] = ["MLC1", "MLC2", "MLC3"].map((id) => ({ id }));
    const getItemPriceToWin = vi
      .fn()
      .mockImplementation((_sellerId: string, itemId: string) =>
        Promise.resolve(priceToWinSnapshot(itemId)),
      );

    await processSellerPricing(
      {
        ...baseConfig,
        pricingMaxItemsPerCycle: 2,
        mlcClient: { ...baseConfig.mlcClient, getItemPriceToWin },
      },
      "plasticov",
      listings,
    );

    expect(getItemPriceToWin).toHaveBeenCalledTimes(2);
  });

  it("persists pricing snapshots with evidence IDs and read-only metadata", async () => {
    const getItemPriceToWin = vi.fn().mockResolvedValue(priceToWinSnapshot("MLC123"));
    const relistItem = vi.fn();
    const uploadImage = vi.fn();
    const getPromotionItems = vi.fn();

    await expect(
      processSellerPricing(
        {
          ...baseConfig,
          mlcClient: {
            ...baseConfig.mlcClient,
            getItemPriceToWin,
            relistItem,
            uploadImage,
            getPromotionItems,
          },
        },
        "plasticov",
        [{ id: "MLC123" }],
      ),
    ).resolves.toEqual({ persisted: 1, skipped: 0 });

    const snapshot = await operationalStore.readSnapshot<
      MlcPriceToWinSummary & { noMutationExecuted: true }
    >({
      sellerId: "plasticov",
      snapshotKind: "pricing",
      entityId: "MLC123",
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.evidence.evidenceId).toMatch(/^orm:pricing:plasticov:MLC123:/);
    expect(snapshot!.kind).toBe("pricing");
    expect(Array.isArray(snapshot!.data)).toBe(false);
    const data = snapshot!.data as MlcPriceToWinSummary & { noMutationExecuted: true };
    expect(data.noMutationExecuted).toBe(true);
    expect(snapshot!.freshness.status).toBe("fresh");
    expect(relistItem).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
    expect(getPromotionItems).not.toHaveBeenCalled();
  });

  it("writes the pricing checkpoint only after the bounded batch completes", async () => {
    const getItemPriceToWin = vi
      .fn()
      .mockImplementation((_sellerId: string, itemId: string) =>
        Promise.resolve(priceToWinSnapshot(itemId)),
      );
    const upsertSnapshot = vi.fn().mockResolvedValue(undefined);
    const upsertCheckpoint = vi.fn().mockResolvedValue(undefined);

    await processSellerPricing(
      {
        ...baseConfig,
        pricingMaxItemsPerCycle: 2,
        mlcClient: { ...baseConfig.mlcClient, getItemPriceToWin },
        operationalStore: { ...operationalStore, upsertSnapshot, upsertCheckpoint },
      },
      "plasticov",
      [{ id: "MLC1" }, { id: "MLC2" }],
    );

    expect(upsertSnapshot).toHaveBeenCalledTimes(2);
    expect(upsertCheckpoint).toHaveBeenCalledWith("plasticov", "pricing", expect.any(String));
    expect(upsertCheckpoint.mock.invocationCallOrder[0]).toBeGreaterThan(
      upsertSnapshot.mock.invocationCallOrder[1]!,
    );
  });

  it("does not checkpoint when pricing snapshot persistence fails", async () => {
    const upsertCheckpoint = vi.fn().mockResolvedValue(undefined);

    await expect(
      processSellerPricing(
        {
          ...baseConfig,
          mlcClient: {
            ...baseConfig.mlcClient,
            getItemPriceToWin: vi.fn().mockResolvedValue(priceToWinSnapshot("MLC123")),
          },
          operationalStore: {
            ...operationalStore,
            upsertSnapshot: vi.fn().mockRejectedValue(new Error("write failed")),
            upsertCheckpoint,
          },
        },
        "plasticov",
        [{ id: "MLC123" }],
      ),
    ).rejects.toThrow("write failed");
    expect(upsertCheckpoint).not.toHaveBeenCalled();
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not found"],
  ])("skips graceful HTTP %i pricing failures", async (status, message) => {
    const err = Object.assign(new Error(message), { status });

    await expect(
      processSellerPricing(
        {
          ...baseConfig,
          mlcClient: {
            ...baseConfig.mlcClient,
            getItemPriceToWin: vi.fn().mockRejectedValue(err),
          },
        },
        "plasticov",
        [{ id: "MLC123" }],
      ),
    ).resolves.toEqual({ persisted: 0, skipped: 1 });
    expect(await operationalStore.getCheckpoint("plasticov", "pricing")).not.toBeNull();
  });

  it("skips no-data pricing snapshots without failing", async () => {
    await expect(
      processSellerPricing(
        {
          ...baseConfig,
          mlcClient: {
            ...baseConfig.mlcClient,
            getItemPriceToWin: vi.fn().mockResolvedValue(
              priceToWinSnapshot("MLC123", {
                data: { itemId: "MLC123", boosts: [] },
                completeness: "partial",
                confidence: "low",
              }),
            ),
          },
        },
        "plasticov",
        [{ id: "MLC123" }],
      ),
    ).resolves.toEqual({ persisted: 0, skipped: 1 });

    expect(
      db.prepare("SELECT COUNT(*) as cnt FROM operational_snapshots WHERE kind = ?").get("pricing"),
    ).toEqual({ cnt: 0 });
  });
});

describe("operational store checkpoint resume", () => {
  let db: Database.Database;
  let operationalStore: OperationalReadModel;

  beforeEach(() => {
    const engine = createGraphEngine(":memory:");
    db = engine.db;
    operationalStore = createSqliteOperationalReadModel(db);
  });

  it("checkpoints track per (seller_id, kind)", async () => {
    const capturedAt1 = "2026-07-01T00:00:00.000Z";
    const capturedAt2 = "2026-07-02T00:00:00.000Z";

    await operationalStore.upsertCheckpoint("plasticov", "claim", capturedAt1);
    await operationalStore.upsertCheckpoint("plasticov", "order", capturedAt2);
    await operationalStore.upsertCheckpoint("maustian", "claim", capturedAt1);

    const claimCheckpoint = await operationalStore.getCheckpoint("plasticov", "claim");
    expect(claimCheckpoint).not.toBeNull();
    expect(claimCheckpoint!.last_captured_at).toBe(capturedAt1);
    expect(claimCheckpoint!.kind).toBe("claim");

    const orderCheckpoint = await operationalStore.getCheckpoint("plasticov", "order");
    expect(orderCheckpoint!.last_captured_at).toBe(capturedAt2);

    // Cross-seller isolation
    const maustianClaim = await operationalStore.getCheckpoint("maustian", "claim");
    expect(maustianClaim!.seller_id).toBe("maustian");
    expect(maustianClaim!.last_captured_at).toBe(capturedAt1);
  });

  it("checkpoint updates on re-save (upsert)", async () => {
    await operationalStore.upsertCheckpoint("plasticov", "claim", "2026-06-01T00:00:00.000Z");
    await operationalStore.upsertCheckpoint("plasticov", "claim", "2026-07-01T00:00:00.000Z");

    const checkpoint = await operationalStore.getCheckpoint("plasticov", "claim");
    expect(checkpoint!.last_captured_at).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("entity snapshot writes", () => {
  let db: Database.Database;
  let operationalStore: OperationalReadModel;

  beforeEach(() => {
    const engine = createGraphEngine(":memory:");
    db = engine.db;
    operationalStore = createSqliteOperationalReadModel(db);
  });

  it("stores claims with correct kind and evidenceId format", async () => {
    const claim: MlcClaimSummary = {
      id: "CLM-1",
      status: "open",
      type: "dispute",
      stage: "mediation",
    };
    const capturedAt = new Date("2026-07-01T12:00:00Z");

    await operationalStore.upsertSnapshot({
      sellerId: "plasticov",
      kind: "claim",
      source: "mercadolibre-api",
      data: claim,
      completeness: "complete",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "claim",
        risk: "critical",
        capturedAt,
        maxAgeMs: 3600000,
        status: "fresh",
      },
      confidence: "high",
      evidence: {
        evidenceId: "orm:claim:plasticov:CLM-1:2026-07-01T12:00:00.000Z",
        snapshotKind: "claim",
        sellerId: "plasticov",
        entityId: "CLM-1",
        capturedAt,
        freshnessStatus: "fresh",
        completeness: "complete",
        source: "operational-read-model",
      },
    });

    const evidence = await operationalStore.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "claim",
      entityId: "CLM-1",
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.snapshotKind).toBe("claim");
    expect(evidence!.evidenceId).toMatch(/^orm:claim:plasticov:CLM-1:/);
  });

  it("stores questions with correct kind", async () => {
    const question: MlcQuestionSummary = {
      id: "Q-99",
      text: "¿Tienen stock?",
      answerText: "Sí, disponible.",
      status: "ANSWERED",
      itemId: "MLC5001",
    };
    const capturedAt = new Date("2026-07-01T12:00:00Z");

    await operationalStore.upsertSnapshot({
      sellerId: "plasticov",
      kind: "question",
      source: "mercadolibre-api",
      data: question,
      completeness: "complete",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "question",
        risk: "medium",
        capturedAt,
        maxAgeMs: 7200000,
        status: "fresh",
      },
      confidence: "high",
      evidence: {
        evidenceId: "orm:question:plasticov:Q-99:2026-07-01T12:00:00.000Z",
        snapshotKind: "question",
        sellerId: "plasticov",
        entityId: "Q-99",
        capturedAt,
        freshnessStatus: "fresh",
        completeness: "complete",
        source: "operational-read-model",
      },
    });

    const evidence = await operationalStore.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "question",
      entityId: "Q-99",
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.snapshotKind).toBe("question");
  });

  it("stores reputation with item_id as metric period label", async () => {
    const reputation: MlcReputationSummary = {
      level: "5_green",
      powerSellerStatus: "gold",
      completedTransactions: 100,
      metricPeriodDays: 60,
    };
    const capturedAt = new Date("2026-07-01T12:00:00Z");

    await operationalStore.upsertSnapshot({
      sellerId: "plasticov",
      kind: "reputation",
      source: "mercadolibre-api",
      data: reputation,
      completeness: "complete",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "reputation",
        risk: "critical",
        capturedAt,
        maxAgeMs: 21600000,
        status: "fresh",
      },
      confidence: "high",
      evidence: {
        evidenceId: "orm:reputation:plasticov:60d:2026-07-01T12:00:00.000Z",
        snapshotKind: "reputation",
        sellerId: "plasticov",
        entityId: "60d",
        capturedAt,
        freshnessStatus: "fresh",
        completeness: "complete",
        source: "operational-read-model",
      },
    });

    const evidence = await operationalStore.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "reputation",
      entityId: "60d",
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.snapshotKind).toBe("reputation");
  });

  it("stores messages with snippet fields", async () => {
    const capturedAt = new Date("2026-07-01T12:00:00Z");

    await operationalStore.upsertSnapshot({
      sellerId: "plasticov",
      kind: "message",
      source: "mercadolibre-api",
      data: {
        id: "MSG-1",
        role: "buyer",
        date: "2026-07-01T10:00:00Z",
        snippet: "Hola, ¿cuándo llega el pedido?",
        status: "available",
      },
      completeness: "complete",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "message",
        risk: "critical",
        capturedAt,
        maxAgeMs: 21600000,
        status: "fresh",
      },
      confidence: "high",
      evidence: {
        evidenceId: "orm:message:plasticov:MSG-1:2026-07-01T12:00:00.000Z",
        snapshotKind: "message",
        sellerId: "plasticov",
        entityId: "MSG-1",
        capturedAt,
        freshnessStatus: "fresh",
        completeness: "complete",
        source: "operational-read-model",
      },
    });

    const evidence = await operationalStore.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "message",
      entityId: "MSG-1",
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.snapshotKind).toBe("message");
  });

  it("stores orders per-item with correct evidenceId", async () => {
    const order: MlcOrderSummary = {
      id: "ORDER-500",
      status: "paid",
      totalAmount: 15000,
      currencyId: "CLP",
    };
    const capturedAt = new Date("2026-07-01T12:00:00Z");

    await operationalStore.upsertSnapshot({
      sellerId: "plasticov",
      kind: "order",
      source: "mercadolibre-api",
      data: order,
      completeness: "complete",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "order",
        risk: "critical",
        capturedAt,
        maxAgeMs: 3600000,
        status: "fresh",
      },
      confidence: "high",
      evidence: {
        evidenceId: "orm:order:plasticov:ORDER-500:2026-07-01T12:00:00.000Z",
        snapshotKind: "order",
        sellerId: "plasticov",
        entityId: "ORDER-500",
        capturedAt,
        freshnessStatus: "fresh",
        completeness: "complete",
        source: "operational-read-model",
      },
    });

    const evidence = await operationalStore.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "order",
      entityId: "ORDER-500",
    });
    expect(evidence).not.toBeNull();
    expect(evidence!.evidenceId).toMatch(/^orm:order:plasticov:ORDER-500:/);
  });
});
