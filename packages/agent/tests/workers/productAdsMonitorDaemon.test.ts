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
import { productAdsMonitorDaemon } from "../../src/workers/productAdsMonitorDaemon.js";
import type { DaemonResult } from "../../src/workers/daemonTypes.js";
import type { MlcProductAdsInsights } from "@msl/mercadolibre";

// ── Helpers ─────────────────────────────────────────────────────────

const SELLER_IDS = ["seller-plasticov"];

function claimFixture(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? 1,
    messageId: overrides.messageId ?? crypto.randomUUID(),
    senderAgentId: overrides.senderAgentId ?? "ceo",
    receiverAgentId: overrides.receiverAgentId ?? "product-ads-monitor",
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
    resultJson: overrides.resultJson ?? null,
    errorJson: overrides.errorJson ?? null,
    cancelReason: overrides.cancelReason ?? null,
    correlationId: overrides.correlationId ?? null,
    parentMessageId: overrides.parentMessageId ?? null,
    sellerId: overrides.sellerId ?? null,
    learnedAt: overrides.learnedAt ?? null,
    outcomeScore: overrides.outcomeScore ?? null,
    actionId: overrides.actionId ?? null,
  };
}

// ── Seed helpers ────────────────────────────────────────────────────

function seedProductAdsInsights(
  store: OperationalReadModel,
  overrides: Partial<{
    sellerId: string;
    campaigns: Array<{
      id: string;
      name?: string;
      metrics?: Record<string, number>;
    }>;
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

  void store.upsertSnapshot<MlcProductAdsInsights>({
    sellerId: overrides.sellerId ?? SELLER_IDS[0]!,
    kind: "product-ads-insights",
    source: "mercadolibre-api",
    data: {
      advertiser: { id: "adv-1", siteId: "MLC", productId: "PADS" },
      campaigns: campaigns.map((c) => ({
        id: c.id,
        name: c.name!,
        metrics: c.metrics!,
      })),
      ads: ads.map((a) => ({
        id: a.id,
        name: a.name!,
        itemId: a.itemId!,
        campaignId: a.campaignId!,
        status: a.status!,
        metrics: a.metrics!,
      })),
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
      evidenceId: `orm:product-ads-insights:${overrides.sellerId ?? SELLER_IDS[0]!}:test:${now}`,
      snapshotKind: "product-ads-insights",
      sellerId: overrides.sellerId ?? SELLER_IDS[0]!,
      entityId: overrides.entityId ?? "test",
      capturedAt: new Date(now),
      freshnessStatus: "fresh",
      completeness: "complete",
      source: "operational-read-model",
    },
  });
}

function seedCostNode(engine: GraphEngine, itemId: string, cost: number, sellerId?: string): void {
  engine.getOrCreateNode(
    `cost_snapshot_${itemId}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    {
      type: "cost_snapshot",
      itemId,
      cost,
      sellerId: sellerId ?? SELLER_IDS[0]!,
      capturedAt: new Date().toISOString(),
    },
  );
}

function seedListingNode(
  engine: GraphEngine,
  itemId: string,
  overrides: {
    sellerId?: string;
    price?: number;
    capturedAt?: string;
  } = {},
): void {
  engine.getOrCreateNode(
    `listing_snapshot_${itemId}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    {
      type: "listing_snapshot",
      itemId,
      sellerId: overrides.sellerId ?? SELLER_IDS[0]!,
      price: overrides.price ?? 10000,
      capturedAt: overrides.capturedAt ?? new Date().toISOString(),
    },
  );
}

function seedVisitNode(
  engine: GraphEngine,
  itemId: string,
  totalVisits: number,
  capturedAt: string,
  sellerId?: string,
): void {
  engine.getOrCreateNode(
    `visit_snapshot_${itemId}_${capturedAt}_${Math.random().toString(36).slice(2)}`,
    {
      type: "visit_snapshot",
      itemId,
      totalVisits,
      sellerId: sellerId ?? SELLER_IDS[0]!,
      capturedAt,
    },
  );
}

// ── Tests ───────────────────────────────────────────────────────────

describe("productAdsMonitorDaemon", () => {
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

  // ── 3.1 Empty state (scenario 11) ───────────────────────────

  describe("with no data", () => {
    it("returns empty findings when no product-ads-insights exist", async () => {
      const result: DaemonResult = await productAdsMonitorDaemon({
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

  // ── 3.2 Profitability (scenarios 1–2) ───────────────────────

  describe("profitability", () => {
    it("flags unprofitable ads as critical when cost exceeds price", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-1", metrics: { investment: 1000, revenue: 2000 } }],
        ads: [
          {
            id: "ad-profit-1",
            itemId: "MLC-PROFIT-001",
            campaignId: "camp-1",
            metrics: { investment: 500, revenue: 200 },
          },
        ],
      });
      // Price via listing snapshot (ORM)
      await operationalStore.upsertSnapshot({
        sellerId: SELLER_IDS[0]!,
        kind: "listing_snapshot" as never,
        source: "mercadolibre-api",
        data: { price: 5000 },
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
          evidenceId: "test:listing:MLC-PROFIT-001",
          snapshotKind: "listing_snapshot" as never,
          sellerId: SELLER_IDS[0]!,
          entityId: "MLC-PROFIT-001",
          capturedAt: new Date(),
          freshnessStatus: "fresh",
          completeness: "complete",
          source: "operational-read-model",
        },
      });
      // Cost via Cortex
      seedCostNode(engine, "MLC-PROFIT-001", 8000);

      const result = await productAdsMonitorDaemon({
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
      expect(critical[0]!.summary).toContain("Unprofitable ad");
      expect(critical[0]!.summary).toContain("MLC-PROFIT-001");
    });

    it("skips profitability check when cost is unknown", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-2", metrics: { investment: 1000, revenue: 2000 } }],
        ads: [
          {
            id: "ad-cost-unknown",
            itemId: "MLC-COST-UNKNOWN-001",
            campaignId: "camp-2",
            metrics: { investment: 500, revenue: 200 },
          },
        ],
      });
      // Price exists but no cost node → skip
      await operationalStore.upsertSnapshot({
        sellerId: SELLER_IDS[0]!,
        kind: "listing_snapshot" as never,
        source: "mercadolibre-api",
        data: { price: 5000 },
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
          evidenceId: "test:listing:MLC-COST-UNKNOWN-001",
          snapshotKind: "listing_snapshot" as never,
          sellerId: SELLER_IDS[0]!,
          entityId: "MLC-COST-UNKNOWN-001",
          capturedAt: new Date(),
          freshnessStatus: "fresh",
          completeness: "complete",
          source: "operational-read-model",
        },
      });
      // No seedCostNode → cost unknown

      const result = await productAdsMonitorDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const critical = result.findings.filter(
        (f) => f.kind === "alert" && f.severity === "critical",
      );
      expect(critical).toEqual([]);
    });
  });

  // ── 3.3 Visit decline (scenarios 3–4) ───────────────────────

  describe("visit decline", () => {
    it("flags warning when visits decline 30%+ for 2 consecutive weeks", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-visit", metrics: { investment: 500, revenue: 1000 } }],
        ads: [
          {
            id: "ad-visit-1",
            itemId: "MLC-VISIT-001",
            campaignId: "camp-visit",
            metrics: { investment: 200, revenue: 300 },
          },
        ],
      });

      // Seed 3 weeks of visit data with steady decline
      const now = new Date();
      const wk1 = new Date(now);
      wk1.setDate(wk1.getDate() - 14); // 2 weeks ago
      const wk2 = new Date(now);
      wk2.setDate(wk2.getDate() - 7); // 1 week ago
      const wk3 = new Date(now); // this week

      seedVisitNode(engine, "MLC-VISIT-001", 100, wk1.toISOString()); // baseline
      seedVisitNode(engine, "MLC-VISIT-001", 65, wk2.toISOString()); // -35% WoW
      seedVisitNode(engine, "MLC-VISIT-001", 39, wk3.toISOString()); // -40% WoW

      const result = await productAdsMonitorDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const visitFindings = result.findings.filter(
        (f) => f.kind === "alert" && f.summary.includes("Declining visits"),
      );
      expect(visitFindings.length).toBeGreaterThanOrEqual(1);
      expect(visitFindings[0]!.severity).toBe("warning");
    });

    it("excludes single-week dips from visit decline signal", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-visit2", metrics: { investment: 500, revenue: 1000 } }],
        ads: [
          {
            id: "ad-visit-2",
            itemId: "MLC-VISIT-002",
            campaignId: "camp-visit2",
            metrics: { investment: 200, revenue: 300 },
          },
        ],
      });

      const now = new Date();
      const wk1 = new Date(now);
      wk1.setDate(wk1.getDate() - 14);
      const wk2 = new Date(now);
      wk2.setDate(wk2.getDate() - 7);
      const wk3 = new Date(now);

      // Week 1→2: -35% (steep dip), Week 2→3: -5% (recovery)
      seedVisitNode(engine, "MLC-VISIT-002", 100, wk1.toISOString());
      seedVisitNode(engine, "MLC-VISIT-002", 65, wk2.toISOString());
      seedVisitNode(engine, "MLC-VISIT-002", 62, wk3.toISOString());

      const result = await productAdsMonitorDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const visitFindings = result.findings.filter((f) => f.summary.includes("Declining visits"));
      expect(visitFindings).toEqual([]);
    });
  });

  // ── 3.4 Monopoly (scenarios 5–6) ───────────────────────────

  describe("monopoly detection", () => {
    it("flags info when item appears only on owned accounts", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-mon", metrics: { investment: 1000, revenue: 2000 } }],
        ads: [
          {
            id: "ad-mon-1",
            itemId: "MLC-MON-001",
            campaignId: "camp-mon",
            metrics: { investment: 500, revenue: 400 },
          },
        ],
      });

      // Only on owned seller → monopoly
      seedListingNode(engine, "MLC-MON-001", {
        sellerId: SELLER_IDS[0]!,
        price: 10000,
      });

      const result = await productAdsMonitorDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const monFindings = result.findings.filter((f) =>
        f.summary.includes("Cross-account monopoly"),
      );
      expect(monFindings.length).toBeGreaterThanOrEqual(1);
      expect(monFindings[0]!.severity).toBe("info");
    });

    it("suppresses monopoly signal when external seller exists", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-mon2", metrics: { investment: 1000, revenue: 2000 } }],
        ads: [
          {
            id: "ad-mon-2",
            itemId: "MLC-MON-002",
            campaignId: "camp-mon2",
            metrics: { investment: 500, revenue: 400 },
          },
        ],
      });

      // On owned seller
      seedListingNode(engine, "MLC-MON-002", {
        sellerId: SELLER_IDS[0]!,
        price: 10000,
      });
      // Also on external seller → suppress monopoly
      seedListingNode(engine, "MLC-MON-002", {
        sellerId: "seller-external",
        price: 12000,
      });

      const result = await productAdsMonitorDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const monFindings = result.findings.filter((f) =>
        f.summary.includes("Cross-account monopoly"),
      );
      expect(monFindings).toEqual([]);
    });
  });

  // ── 3.5 ROAS (scenarios 7–8) ───────────────────────────────

  describe("per-product ROAS", () => {
    it("flags warning when ROAS < 1.0", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-roas", metrics: { investment: 2000, revenue: 3000 } }],
        ads: [
          {
            id: "ad-roas-1",
            itemId: "MLC-ROAS-001",
            campaignId: "camp-roas",
            metrics: { revenue: 5000, investment: 8000 },
          },
        ],
      });

      const result = await productAdsMonitorDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const roasFindings = result.findings.filter(
        (f) => f.kind === "alert" && f.summary.includes("Low ROAS"),
      );
      expect(roasFindings.length).toBeGreaterThanOrEqual(1);
      expect(roasFindings[0]!.severity).toBe("warning");
    });

    it("skips ROAS check when investment is zero (no div-by-zero)", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-roas2", metrics: { investment: 2000, revenue: 3000 } }],
        ads: [
          {
            id: "ad-roas-2",
            itemId: "MLC-ROAS-002",
            campaignId: "camp-roas2",
            metrics: { revenue: 5000, investment: 0 },
          },
        ],
      });

      const result = await productAdsMonitorDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const roasFindings = result.findings.filter((f) => f.summary.includes("Low ROAS"));
      expect(roasFindings).toEqual([]);
    });
  });

  // ── 3.6 Opportunity gap (scenarios 9–10) ────────────────────

  describe("opportunity gap", () => {
    it("detects opportunity when profitable product not in ads", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [
          {
            id: "camp-opp-1",
            name: "High ROAS Campaign",
            metrics: { revenue: 84000, investment: 20000 }, // ROAS = 4.2
          },
        ],
        // Ads exist but do NOT include the profitable product
        ads: [
          {
            id: "ad-opp-existing",
            itemId: "MLC-OPP-ADVERTISED",
            campaignId: "camp-opp-1",
            metrics: { revenue: 1000, investment: 500 },
          },
        ],
      });

      // Seed the profitable product (not in ads)
      await operationalStore.upsertSnapshot({
        sellerId: SELLER_IDS[0]!,
        kind: "listing_snapshot" as never,
        source: "mercadolibre-api",
        data: { price: 10000 },
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
          evidenceId: "test:listing:MLC-OPP-OPPORTUNITY",
          snapshotKind: "listing_snapshot" as never,
          sellerId: SELLER_IDS[0]!,
          entityId: "MLC-OPP-OPPORTUNITY",
          capturedAt: new Date(),
          freshnessStatus: "fresh",
          completeness: "complete",
          source: "operational-read-model",
        },
      });
      seedCostNode(engine, "MLC-OPP-OPPORTUNITY", 5000); // cost=5000, profitable

      // Seed listing for monopoly check (Cortex)
      seedListingNode(engine, "MLC-OPP-OPPORTUNITY", {
        sellerId: SELLER_IDS[0]!,
        price: 10000,
      });
      seedListingNode(engine, "MLC-OPP-ADVERTISED", {
        sellerId: SELLER_IDS[0]!,
        price: 8000,
      });

      const result = await productAdsMonitorDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const oppFindings = result.findings.filter((f) => f.kind === "opportunity");
      expect(oppFindings.length).toBeGreaterThanOrEqual(1);
      expect(oppFindings[0]!.summary).toContain("MLC-OPP-OPPORTUNITY");
      expect(oppFindings[0]!.summary).toContain("High ROAS Campaign");
      expect(oppFindings[0]!.severity).toBe("info");
    });

    it("excludes unprofitable product from opportunity signal", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [
          {
            id: "camp-opp-2",
            name: "Another High ROAS Campaign",
            metrics: { revenue: 100000, investment: 25000 }, // ROAS = 4.0
          },
        ],
        ads: [
          {
            id: "ad-opp-existing-2",
            itemId: "MLC-OPP-ADVERTISED-2",
            campaignId: "camp-opp-2",
            metrics: { revenue: 1000, investment: 500 },
          },
        ],
      });

      // Seed unprofitable product
      await operationalStore.upsertSnapshot({
        sellerId: SELLER_IDS[0]!,
        kind: "listing_snapshot" as never,
        source: "mercadolibre-api",
        data: { price: 5000 },
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
          evidenceId: "test:listing:MLC-OPP-UNPROFITABLE",
          snapshotKind: "listing_snapshot" as never,
          sellerId: SELLER_IDS[0]!,
          entityId: "MLC-OPP-UNPROFITABLE",
          capturedAt: new Date(),
          freshnessStatus: "fresh",
          completeness: "complete",
          source: "operational-read-model",
        },
      });
      seedCostNode(engine, "MLC-OPP-UNPROFITABLE", 8000); // cost=8000 > price=5000

      // Seed listing for monopoly check
      seedListingNode(engine, "MLC-OPP-UNPROFITABLE", {
        sellerId: SELLER_IDS[0]!,
        price: 5000,
      });
      seedListingNode(engine, "MLC-OPP-ADVERTISED-2", {
        sellerId: SELLER_IDS[0]!,
        price: 8000,
      });

      const result = await productAdsMonitorDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const oppFindings = result.findings.filter((f) => f.kind === "opportunity");
      // The unprofitable product MLC-OPP-UNPROFITABLE should NOT appear
      const found = oppFindings.some((f) => f.summary.includes("MLC-OPP-UNPROFITABLE"));
      expect(found).toBe(false);
    });
  });

  // ── 3.7 Proposal enqueue (scenarios 13–16) ─────────────────

  describe("CEO proposal enqueue", () => {
    it("enqueues proposals with correct sender/receiver and noMutationExecuted when findings exist", async () => {
      // Seed data that triggers at least one finding (profitability)
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-enq-1", metrics: { investment: 1000, revenue: 2000 } }],
        ads: [
          {
            id: "ad-enq-1",
            itemId: "MLC-ENQ-001",
            campaignId: "camp-enq-1",
            metrics: { revenue: 5000, investment: 8000 },
          },
        ],
      });
      await operationalStore.upsertSnapshot({
        sellerId: SELLER_IDS[0]!,
        kind: "listing_snapshot" as never,
        source: "mercadolibre-api",
        data: { price: 5000 },
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
          evidenceId: "test:listing:MLC-ENQ-001",
          snapshotKind: "listing_snapshot" as never,
          sellerId: SELLER_IDS[0]!,
          entityId: "MLC-ENQ-001",
          capturedAt: new Date(),
          freshnessStatus: "fresh",
          completeness: "complete",
          source: "operational-read-model",
        },
      });
      seedCostNode(engine, "MLC-ENQ-001", 8000);
      // Also add listing node for Cortex (monopoly check runs too)
      seedListingNode(engine, "MLC-ENQ-001", {
        sellerId: SELLER_IDS[0]!,
        price: 5000,
      });

      const result = await productAdsMonitorDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(result.messageIds.length).toBeGreaterThan(0);

      // Verify sender/receiver for the first message
      const msgRow = db
        .prepare("SELECT * FROM agent_message_bus WHERE message_id = ?")
        .get(result.messageIds[0]!) as Record<string, unknown> | undefined;

      expect(msgRow).toBeDefined();
      expect(msgRow!.sender_agent_id).toBe("product-ads-monitor");
      expect(msgRow!.receiver_agent_id).toBe("ceo");
      expect(msgRow!.message_type).toBe("proposal");

      // Verify noMutationExecuted
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const payload = JSON.parse(msgRow!.payload_json as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(payload.noMutationExecuted).toBe(true);
    });

    it("sets noMutationExecuted: true on all enqueued proposals", async () => {
      // Seed to trigger multiple severity tiers
      seedProductAdsInsights(operationalStore, {
        campaigns: [
          {
            id: "camp-enq-2",
            name: "Enq Campaign",
            metrics: { revenue: 5000, investment: 2000 },
          },
        ],
        ads: [
          {
            id: "ad-enq-roas",
            itemId: "MLC-ENQ-ROAS",
            campaignId: "camp-enq-2",
            metrics: { revenue: 1000, investment: 4000 }, // ROAS < 1.0 → warning
          },
        ],
      });
      await operationalStore.upsertSnapshot({
        sellerId: SELLER_IDS[0]!,
        kind: "listing_snapshot" as never,
        source: "mercadolibre-api",
        data: { price: 10000 },
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
          evidenceId: "test:listing:MLC-ENQ-ROAS",
          snapshotKind: "listing_snapshot" as never,
          sellerId: SELLER_IDS[0]!,
          entityId: "MLC-ENQ-ROAS",
          capturedAt: new Date(),
          freshnessStatus: "fresh",
          completeness: "complete",
          source: "operational-read-model",
        },
      });
      // Profitability: price=10000 vs cost=8000 → not unprofitable, so no critical
      // But we still get the ROAS warning
      seedCostNode(engine, "MLC-ENQ-ROAS", 8000);
      seedListingNode(engine, "MLC-ENQ-ROAS", {
        sellerId: SELLER_IDS[0]!,
        price: 10000,
      });

      const result = await productAdsMonitorDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.messageIds.length).toBeGreaterThan(0);

      for (const msgId of result.messageIds) {
        const row = db
          .prepare("SELECT payload_json FROM agent_message_bus WHERE message_id = ?")
          .get(msgId) as { payload_json: string } | undefined;

        expect(row).toBeDefined();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const pl = JSON.parse(row!.payload_json);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(pl.noMutationExecuted).toBe(true);
      }
    });

    it("uses correct dedupeKey format with hour segment", async () => {
      seedProductAdsInsights(operationalStore, {
        campaigns: [{ id: "camp-enq-3", metrics: { investment: 2000, revenue: 3000 } }],
        ads: [
          {
            id: "ad-enq-dedup",
            itemId: "MLC-ENQ-DEDUP",
            campaignId: "camp-enq-3",
            metrics: { revenue: 1000, investment: 4000 }, // ROAS < 1.0
          },
        ],
      });
      await operationalStore.upsertSnapshot({
        sellerId: SELLER_IDS[0]!,
        kind: "listing_snapshot" as never,
        source: "mercadolibre-api",
        data: { price: 10000 },
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
          evidenceId: "test:listing:MLC-ENQ-DEDUP",
          snapshotKind: "listing_snapshot" as never,
          sellerId: SELLER_IDS[0]!,
          entityId: "MLC-ENQ-DEDUP",
          capturedAt: new Date(),
          freshnessStatus: "fresh",
          completeness: "complete",
          source: "operational-read-model",
        },
      });
      seedCostNode(engine, "MLC-ENQ-DEDUP", 8000);
      seedListingNode(engine, "MLC-ENQ-DEDUP", {
        sellerId: SELLER_IDS[0]!,
        price: 10000,
      });

      const result = await productAdsMonitorDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      for (const msgId of result.messageIds) {
        const row = db
          .prepare("SELECT dedupe_key, payload_json FROM agent_message_bus WHERE message_id = ?")
          .get(msgId) as { dedupe_key: string | null; payload_json: string } | undefined;

        expect(row).toBeDefined();
        expect(row!.dedupe_key).not.toBeNull();
        expect(row!.dedupe_key).toMatch(
          /^product-ads-(critical|warning|opportunity|info)-\d{4}-\d{2}-\d{2}T\d{2}$/,
        );
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const pl = JSON.parse(row!.payload_json);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(pl.noMutationExecuted).toBe(true);
      }
    });
  });
});
