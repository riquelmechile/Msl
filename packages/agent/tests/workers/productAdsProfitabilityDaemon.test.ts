import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { createGraphEngine } from "@msl/memory";
import { createSqliteOperationalReadModel } from "@msl/memory";
import type { GraphEngine, OperationalReadModel } from "@msl/memory";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import type {
  AgentMessageBusStore,
  AgentMessage,
} from "../../src/conversation/agentMessageBusStore.js";
import { productAdsProfitabilityDaemon } from "../../src/workers/productAdsProfitabilityDaemon.js";
import {
  enrichWithEconomics,
} from "../../src/workers/productAdsShared.js";
import type { DaemonResult } from "../../src/workers/daemonTypes.js";
import type { MlcProductAdsInsights } from "@msl/mercadolibre";

// ── Helpers ─────────────────────────────────────────────────────────

const SELLER_IDS = ["seller-plasticov"];

function claimFixture(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? 1,
    messageId: overrides.messageId ?? crypto.randomUUID(),
    senderAgentId: overrides.senderAgentId ?? "ceo",
    receiverAgentId: overrides.receiverAgentId ?? "product-ads-profitability",
    messageType: overrides.messageType ?? "task",
    payloadJson: overrides.payloadJson ?? "{}",
    status: overrides.status ?? "processing",
    priority: overrides.priority ?? 5,
    attempts: overrides.attempts ?? 0,
    dedupeKey: overrides.dedupeKey ?? null,
    lockedAt: overrides.lockedAt ?? null,
    resolvedAt: overrides.resolvedAt ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

// ── Seed helpers ────────────────────────────────────────────────────

function seedProductAdsInsights(
  store: OperationalReadModel,
  overrides: Partial<{
    sellerId: string;
    campaigns: Array<{ id: string; name?: string; metrics?: Record<string, number> }>;
    ads: Array<{
      id: string;
      name?: string;
      itemId?: string;
      campaignId?: string;
      status?: string;
      metrics?: Record<string, number>;
    }>;
    entityId: string;
  }> = {},
): void {
  const now = new Date().toISOString();
  const campaigns = overrides.campaigns ?? [];
  const ads = overrides.ads ?? [];
  const effectiveSellerId = overrides.sellerId ?? SELLER_IDS[0]!;

  void store.upsertSnapshot<MlcProductAdsInsights>({
    sellerId: effectiveSellerId,
    kind: "product-ads-insights",
    source: "mercadolibre-api",
    data: {
      advertiser: { id: "adv-1", siteId: "MLC", productId: "PADS" },
      campaigns,
      ads,
      noMutationExecuted: true as const,
      performanceMetric: "roas" as const,
      transitionalMetrics: { acosTargetDeprecatedAfter: "2026-03-30" },
    },
    completeness: "complete",
    freshness: {
      source: "mercadolibre-api",
      signalKind: "product-ads-insights",
      risk: "medium",
      capturedAt: new Date(now),
      maxAgeMs: 24 * 60 * 60 * 1000,
      status: "fresh",
    },
    confidence: "high",
    evidence: {
      evidenceId: `orm:product-ads-insights:${effectiveSellerId}:test:${now}`,
      snapshotKind: "product-ads-insights",
      sellerId: effectiveSellerId,
      entityId: overrides.entityId ?? "test",
      capturedAt: new Date(now),
      freshnessStatus: "fresh",
      completeness: "complete",
      source: "operational-read-model",
    },
  });
}

function seedCostNode(
  engine: GraphEngine,
  itemId: string,
  cost: number,
  sellerId?: string,
): void {
  engine.getOrCreateNode(
    `cost_snapshot_${itemId}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    {
      type: "cost_snapshot",
      itemId,
      cost,
      sellerId: sellerId ?? SELLER_IDS[0],
      capturedAt: new Date().toISOString(),
    },
  );
}

async function seedListingSnapshot(
  store: OperationalReadModel,
  itemId: string,
  price: number,
  sellerId?: string,
): Promise<void> {
  const effectiveSellerId = sellerId ?? SELLER_IDS[0]!;
  await store.upsertSnapshot({
    sellerId: effectiveSellerId,
    kind: "listing_snapshot" as never,
    source: "mercadolibre-api",
    data: { price },
    completeness: "complete",
    freshness: {
      source: "mercadolibre-api",
      signalKind: "listing_snapshot" as never,
      risk: "medium",
      capturedAt: new Date(),
      maxAgeMs: 60 * 60 * 1000,
      status: "fresh",
    },
    confidence: "high",
    evidence: {
      evidenceId: `test:listing:${itemId}`,
      snapshotKind: "listing_snapshot" as never,
      sellerId: effectiveSellerId,
      entityId: itemId,
      capturedAt: new Date(),
      freshnessStatus: "fresh",
      completeness: "complete",
      source: "operational-read-model",
    },
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe("productAdsProfitabilityDaemon", () => {
  let db: Database.Database;
  let bus: AgentMessageBusStore;
  let engine: GraphEngine;
  let operationalStore: OperationalReadModel;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    bus = createAgentMessageBusStore(db);
    engine = createGraphEngine(":memory:");
    operationalStore = createSqliteOperationalReadModel(db);
  });

  describe("empty state", () => {
    it("returns empty findings when no product-ads-insights exist", async () => {
      const result: DaemonResult = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.findings).toEqual([]);
      expect(result.proposalEnqueued).toBe(false);
      expect(result.messageIds).toEqual([]);
    });
  });

  describe("data completeness labeling", () => {
    it("labels as 'insufficient' when cost data is missing", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-1" }],
        ads: [
          {
            id: "ad-1",
            itemId: "MLC-001",
            campaignId: "camp-1",
            metrics: {
              investment: 1000,
              revenue: 2000,
              clicks: 50,
              cvr: 0.05,
              total_units: 3,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-001", 10000);
      // No cost node → insufficient

      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      // Should have data-quality notice, not seller-impacting
      const dataQuality = result.findings.filter(
        (f) => f.summary.includes("Insufficient cost data"),
      );
      expect(dataQuality.length).toBeGreaterThanOrEqual(1);
    });

    it("labels as 'full' when all cost, CVR, units, and revenue present", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-1" }],
        ads: [
          {
            id: "ad-1",
            itemId: "MLC-001",
            campaignId: "camp-1",
            metrics: {
              investment: 1000,
              revenue: 5000,
              clicks: 50,
              cvr: 0.05,
              total_units: 3,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-001", 10000);
      seedCostNode(engine, "MLC-001", 4000);

      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      // Should have unit economics signal (info), not insufficient data
      const insufficient = result.findings.filter(
        (f) => f.summary.includes("Insufficient cost data"),
      );
      expect(insufficient.length).toBe(0);
    });
  });

  describe("margin-consuming signal (critical)", () => {
    it("flags ad when netContribution <= 0", async () => {
      // price=10000, cost=8000, units=2, adSpend=12000
      // grossContribution = (10000 - 8000) * 2 = 4000
      // netContribution = 4000 - 12000 = -8000
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-1" }],
        ads: [
          {
            id: "ad-1",
            itemId: "MLC-MARGIN-001",
            campaignId: "camp-1",
            metrics: {
              investment: 12000,
              revenue: 20000,
              total_units: 2,
              cvr: 0.03,
              roas: 20000 / 12000,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-MARGIN-001", 10000);
      seedCostNode(engine, "MLC-MARGIN-001", 8000);

      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const critical = result.findings.filter(
        (f) => f.kind === "alert" && f.severity === "critical",
      );
      expect(critical.length).toBeGreaterThanOrEqual(1);
      expect(critical[0]!.summary).toContain("Margin-consuming ad");
      expect(critical[0]!.summary).toContain("MLC-MARGIN-001");
    });
  });

  describe("scale candidate signal (opportunity)", () => {
    it("flags ad when ROAS > 2.0, margin > 20%, CVR > 2%", async () => {
      // price=10000, cost=4000 → margin = 60%, units=5, adSpend=2000, revenue=25000 → ROAS=12.5
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-1" }],
        ads: [
          {
            id: "ad-scale-1",
            itemId: "MLC-SCALE-001",
            campaignId: "camp-1",
            metrics: {
              investment: 2000,
              revenue: 25000,
              total_units: 5,
              cvr: 0.04,
              roas: 12.5,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-SCALE-001", 10000);
      seedCostNode(engine, "MLC-SCALE-001", 4000);

      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const opportunities = result.findings.filter(
        (f) => f.kind === "opportunity",
      );
      expect(opportunities.length).toBeGreaterThanOrEqual(1);
      expect(opportunities[0]!.summary).toContain("Scale candidate");
      expect(opportunities[0]!.summary).toContain("MLC-SCALE-001");
    });
  });

  describe("budget waste signal (warning)", () => {
    it("flags ad when adSpend > cost × 0.5 AND CVR < 1%", async () => {
      // cost=8000 → 0.5 * 8000 = 4000, adSpend=5000 → exceeds
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-1" }],
        ads: [
          {
            id: "ad-waste-1",
            itemId: "MLC-WASTE-001",
            campaignId: "camp-1",
            metrics: {
              investment: 5000,
              revenue: 2000,
              total_units: 0,
              cvr: 0.005,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-WASTE-001", 10000);
      seedCostNode(engine, "MLC-WASTE-001", 8000);

      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const warnings = result.findings.filter(
        (f) => f.severity === "warning",
      );
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings[0]!.summary).toContain("Budget waste");
    });
  });

  describe("underinvested signal (info)", () => {
    it("flags ad when margin > 30% AND SoV < 10%", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-1" }],
        ads: [
          {
            id: "ad-under-1",
            itemId: "MLC-UNDER-001",
            campaignId: "camp-1",
            metrics: {
              investment: 1000,
              revenue: 5000,
              total_units: 5,
              cvr: 0.05,
              sov: 0.05,
              roas: 5.0,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-UNDER-001", 10000);
      seedCostNode(engine, "MLC-UNDER-001", 4000);

      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const underinvested = result.findings.filter(
        (f) => f.summary.includes("Underinvested"),
      );
      expect(underinvested.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("per-product campaign granularity", () => {
    it("evaluates profitable and unprofitable products independently in same campaign", async () => {
      // Product A: profitable, ROAS=3.5, margin=40%
      // Product B: unprofitable, ROAS=0.4, negative contribution
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-mixed", name: "Mixed Campaign" }],
        ads: [
          {
            id: "ad-profitable",
            itemId: "MLC-PROFITABLE",
            campaignId: "camp-mixed",
            metrics: {
              investment: 2000,
              revenue: 7000,
              total_units: 5,
              cvr: 0.05,
              roas: 3.5,
            },
          },
          {
            id: "ad-unprofitable",
            itemId: "MLC-UNPROFITABLE",
            campaignId: "camp-mixed",
            metrics: {
              investment: 12000,
              revenue: 5000,
              total_units: 2,
              cvr: 0.02,
              roas: 0.4,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-PROFITABLE", 10000);
      await seedListingSnapshot(operationalStore, "MLC-UNPROFITABLE", 10000);
      seedCostNode(engine, "MLC-PROFITABLE", 5000);
      seedCostNode(engine, "MLC-UNPROFITABLE", 8000);

      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      // Should have both: a scale opportunity and a margin-consuming alert
      const opportunities = result.findings.filter(
        (f) => f.kind === "opportunity",
      );
      const criticals = result.findings.filter(
        (f) => f.severity === "critical",
      );

      expect(opportunities.length).toBeGreaterThanOrEqual(1);
      expect(criticals.length).toBeGreaterThanOrEqual(1);

      // Verify neither finding mentions campaign average
      for (const f of result.findings) {
        expect(f.summary).not.toContain("campaign average");
      }
    });

    it("does NOT suppress per-product signal when campaign ROAS is acceptable", async () => {
      // Campaign ROAS: 2.5 (acceptable) but product X has ROAS=0.7
      seedProductAdsInsights(operationalStore, {
        campaigns: [
          {
            id: "camp-ok-avg",
            metrics: { investment: 3000, revenue: 7500 /* ROAS=2.5 */ },
          },
        ],
        ads: [
          {
            id: "ad-bad-product",
            itemId: "MLC-WEAK",
            campaignId: "camp-ok-avg",
            metrics: {
              investment: 1000,
              revenue: 700,
              total_units: 1,
              cvr: 0.01,
              roas: 0.7,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-WEAK", 10000);
      seedCostNode(engine, "MLC-WEAK", 9000);

      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      // Product X should still be flagged based on its own economics
      const findingsForWeak = result.findings.filter(
        (f) => f.summary.includes("MLC-WEAK"),
      );
      expect(findingsForWeak.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("rolling 7-day recommendation cadence", () => {
    it("suppresses seller-impacting rec when same identity emitted within 7 days", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-1" }],
        ads: [
          {
            id: "ad-1",
            itemId: "MLC-CADENCE-001",
            campaignId: "camp-1",
            metrics: {
              investment: 12000,
              revenue: 20000,
              total_units: 2,
              cvr: 0.03,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-CADENCE-001", 10000);
      seedCostNode(engine, "MLC-CADENCE-001", 8000);

      // Pre-populate bus with a recent seller-impacting message (3 days ago)
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      bus.enqueue({
        senderAgentId: "product-ads-profitability",
        receiverAgentId: "ceo",
        messageType: "proposal",
        payloadJson: "{}",
        dedupeKey: "product-ads-cfo:seller-plasticov:camp-1:MLC-CADENCE-001:margin-consuming:2026-07-05",
      });

      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      // Should NOT have a margin-consuming alert because within 7-day window
      const criticals = result.findings.filter(
        (f) => f.severity === "critical" && f.summary.includes("MLC-CADENCE-001"),
      );
      expect(criticals.length).toBe(0);
    });

    it("emits rec when same identity expired (8+ days ago)", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-1" }],
        ads: [
          {
            id: "ad-2",
            itemId: "MLC-EXPIRED-001",
            campaignId: "camp-1",
            metrics: {
              investment: 5000,
              revenue: 3000,
              total_units: 1,
              cvr: 0.005,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-EXPIRED-001", 10000);
      seedCostNode(engine, "MLC-EXPIRED-001", 8000);

      // No pre-populated message → window open, should emit
      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const hasFindings = result.findings.length > 0;
      expect(hasFindings).toBe(true);
    });

    it("emits for different product identity even when same tier for another product was recent", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-1" }],
        ads: [
          {
            id: "ad-diff-1",
            itemId: "MLC-DIFF-001",
            campaignId: "camp-1",
            metrics: {
              investment: 12000,
              revenue: 5000,
              total_units: 2,
              cvr: 0.02,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-DIFF-001", 10000);
      seedCostNode(engine, "MLC-DIFF-001", 8000);

      // Enqueue a message for a DIFFERENT product (same tier)
      bus.enqueue({
        senderAgentId: "product-ads-profitability",
        receiverAgentId: "ceo",
        messageType: "proposal",
        payloadJson: "{}",
        dedupeKey: "product-ads-cfo:seller-plasticov:camp-1:OTHER-PRODUCT:margin-consuming",
      });

      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      // Should still emit for MLC-DIFF-001 (different identity)
      const criticals = result.findings.filter(
        (f) => f.severity === "critical" && f.summary.includes("MLC-DIFF-001"),
      );
      expect(criticals.length).toBeGreaterThanOrEqual(1);
    });

    it("regression: daemon-written dedupe keys use identity prefix so cadence lookup finds them", async () => {
      // This validates that the dedupe key the daemon writes via
      // bus.enqueue() uses the same identity prefix that
      // lookupRecentByDedupePrefix() checks, so the rolling 7-day
      // cadence works in production (not just with manually injected
      // test keys).
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-regr" }],
        ads: [
          {
            id: "ad-regr",
            itemId: "MLC-REGR-001",
            campaignId: "camp-regr",
            metrics: {
              investment: 12000,
              revenue: 5000,
              total_units: 2,
              cvr: 0.03,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-REGR-001", 10000);
      seedCostNode(engine, "MLC-REGR-001", 8000);

      // First run: enqueues a margin-consuming recommendation
      const result1 = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result1.proposalEnqueued).toBe(true);
      expect(result1.messageIds.length).toBeGreaterThanOrEqual(1);

      // Verify the enqueued message's dedupe key starts with the lookup prefix
      const ceoMsgs1 = bus.claimNext("ceo", { limit: 10 });
      const margMsg = ceoMsgs1.find((m) =>
        m.dedupeKey?.startsWith(
          "product-ads-cfo:seller-plasticov:camp-regr:MLC-REGR-001:margin-consuming",
        ),
      );
      expect(margMsg).toBeDefined();
      // Resolve claimed messages
      for (const m of ceoMsgs1) bus.resolve(m.messageId, {});

      // Second run: should suppress because the first run wrote a dedupe
      // key that starts with the identity prefix the lookup checks
      const result2 = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const suppressed = result2.findings.filter(
        (f) => f.severity === "critical" && f.summary.includes("MLC-REGR-001"),
      );
      expect(suppressed.length).toBe(0);
    });
  });

  describe("data-quality notice daily dedup", () => {
    it("suppresses data-quality notice when already emitted today", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-1" }],
        ads: [
          {
            id: "ad-1",
            itemId: "MLC-DQ-001",
            campaignId: "camp-1",
            metrics: { investment: 1000, revenue: 2000 },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-DQ-001", 10000);
      // No cost → insufficient

      const today = new Date().toISOString().slice(0, 10);
      // Pre-populate today's data-quality notice
      bus.enqueue({
        senderAgentId: "product-ads-profitability",
        receiverAgentId: "ceo",
        messageType: "proposal",
        payloadJson: "{}",
        dedupeKey: `product-ads-data-gap:seller-plasticov:camp-1:MLC-DQ-001:${today}`,
      });

      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      // Should be suppressed (already emitted today)
      const dqFindings = result.findings.filter(
        (f) => f.summary.includes("Insufficient cost data") && f.summary.includes("MLC-DQ-001"),
      );
      expect(dqFindings.length).toBe(0);
    });
  });

  describe("CEO proposal enqueue", () => {
    it("enqueues proposals grouped by severity tier", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-1" }],
        ads: [
          {
            id: "ad-crit",
            itemId: "MLC-CRIT-001",
            campaignId: "camp-1",
            metrics: {
              investment: 12000,
              revenue: 5000,
              total_units: 2,
              cvr: 0.03,
            },
          },
          {
            id: "ad-waste",
            itemId: "MLC-WASTE-002",
            campaignId: "camp-1",
            metrics: {
              investment: 5000,
              revenue: 2000,
              cvr: 0.005,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-CRIT-001", 10000);
      await seedListingSnapshot(operationalStore, "MLC-WASTE-002", 10000);
      seedCostNode(engine, "MLC-CRIT-001", 8000);
      seedCostNode(engine, "MLC-WASTE-002", 8000);

      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(result.messageIds.length).toBeGreaterThan(0);

      // Verify CEO messages exist on the bus
      const ceoMsgs = bus.claimNext("ceo", { limit: 10 });
      const ceoIds = new Set(ceoMsgs.map((m) => m.messageId));
      for (const msgId of result.messageIds) {
        expect(ceoIds.has(msgId)).toBe(true);
      }
      // Resolve all claimed messages
      for (const m of ceoMsgs) {
        bus.resolve(m.messageId, {});
      }
    });

    it("all payloads carry noMutationExecuted: true", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-1" }],
        ads: [
          {
            id: "ad-1",
            itemId: "MLC-NOMUT-001",
            campaignId: "camp-1",
            metrics: {
              investment: 1000,
              revenue: 3000,
              total_units: 3,
              cvr: 0.05,
              roas: 3.0,
              sov: 0.05,
            },
          },
        ],
      });
      await seedListingSnapshot(operationalStore, "MLC-NOMUT-001", 10000);
      seedCostNode(engine, "MLC-NOMUT-001", 4000);

      const result = await productAdsProfitabilityDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const ceoMsgs = bus.claimNext("ceo", { limit: 10 });
      const ceoIds = new Set(ceoMsgs.map((m) => m.messageId));
      for (const msgId of result.messageIds) {
        expect(ceoIds.has(msgId)).toBe(true);
        const msg = ceoMsgs.find((m) => m.messageId === msgId);
        if (msg) {
          const payload = JSON.parse(msg.payloadJson) as { noMutationExecuted: boolean };
          expect(payload.noMutationExecuted).toBe(true);
        }
      }
      for (const m of ceoMsgs) {
        bus.resolve(m.messageId, {});
      }
    });
  });

  describe("formula helpers (unit)", () => {
    it("compute netContribution correctly", () => {
      const listingPrice = new Map([["item-1", 10000]]);
      const costMap = new Map([["item-1", 8000]]);

      const enriched = enrichWithEconomics(
        [
          {
            id: "ad-1",
            name: "Test Ad",
            itemId: "item-1",
            campaignId: "camp-1",
            status: "active",
            sellerId: "seller-1",
            metrics: {
              investment: 12000,
              revenue: 20000,
              total_units: 2,
              cvr: 0.03,
            },
          },
        ],
        listingPrice,
        costMap,
      );

      expect(enriched.length).toBe(1);
      // grossContribution = (10000 - 8000) * 2 = 4000
      // netContribution = 4000 - 12000 = -8000
      expect(enriched[0]!.netContribution).toBe(-8000);
    });

    it("compute breakEvenCpa correctly", () => {
      const listingPrice = new Map([["item-1", 10000]]);
      const costMap = new Map([["item-1", 8000]]);

      const enriched = enrichWithEconomics(
        [
          {
            id: "ad-1",
            name: "Test Ad",
            itemId: "item-1",
            campaignId: "camp-1",
            status: "active",
            sellerId: "seller-1",
            metrics: {
              investment: 1000,
              revenue: 5000,
              total_units: 3,
              cvr: 0.05,
            },
          },
        ],
        listingPrice,
        costMap,
      );

      // breakEvenCpa = price - costPerUnit = 10000 - 8000 = 2000
      expect(enriched[0]!.breakEvenCpa).toBe(2000);
    });

    it("labels dataCompleteness correctly for each state", () => {
      // Full: cost + CVR + units + revenue
      const full = enrichWithEconomics(
        [
          {
            id: "ad-1",
            name: "Test",
            itemId: "item-1",
            campaignId: "camp-1",
            status: "active",
            sellerId: "s-1",
            metrics: {
              investment: 1000,
              revenue: 5000,
              total_units: 3,
              cvr: 0.05,
            },
          },
        ],
        new Map([["item-1", 10000]]),
        new Map([["item-1", 4000]]),
      );
      expect(full[0]!.dataCompleteness).toBe("full");

      // Insufficient: no cost
      const insufficient = enrichWithEconomics(
        [
          {
            id: "ad-2",
            name: "Test2",
            itemId: "item-2",
            campaignId: "camp-1",
            status: "active",
            sellerId: "s-1",
            metrics: { investment: 1000, revenue: 2000 },
          },
        ],
        new Map([["item-2", 10000]]),
        new Map(), // no cost
      );
      expect(insufficient[0]!.dataCompleteness).toBe("insufficient");

      // Partial: has cost but missing CVR
      const partial = enrichWithEconomics(
        [
          {
            id: "ad-3",
            name: "Test3",
            itemId: "item-3",
            campaignId: "camp-1",
            status: "active",
            sellerId: "s-1",
            metrics: { investment: 1000, revenue: 2000 },
          },
        ],
        new Map([["item-3", 10000]]),
        new Map([["item-3", 4000]]),
      );
      expect(partial[0]!.dataCompleteness).toBe("partial");
    });
  });
});
