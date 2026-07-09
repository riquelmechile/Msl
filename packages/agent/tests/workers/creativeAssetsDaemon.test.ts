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
import { creativeAssetsDaemon } from "../../src/workers/creativeAssetsDaemon.js";
import type { DaemonResult } from "../../src/workers/daemonTypes.js";
import type { CreativeSnapshotData } from "../../src/conversation/backgroundIngestion.js";

// ── Helpers ─────────────────────────────────────────────────────────

const SELLER_IDS = ["seller-plasticov"];

function claimFixture(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? 1,
    messageId: overrides.messageId ?? crypto.randomUUID(),
    senderAgentId: overrides.senderAgentId ?? "ceo",
    receiverAgentId: overrides.receiverAgentId ?? "creative-assets",
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

function seedCreativeSnapshot(
  store: OperationalReadModel,
  overrides: Partial<CreativeSnapshotData> & { itemId: string },
): void {
  const now = new Date().toISOString();
  const creativeData = {
    itemId: overrides.itemId,
    sellerId: overrides.sellerId ?? SELLER_IDS[0]!,
    pictureCount: overrides.pictureCount ?? 5,
    variationPictureCount: overrides.variationPictureCount ?? 0,
    hasMainImage: overrides.hasMainImage ?? true,
    moderationStatus: overrides.moderationStatus ?? "active",
    moderationTags: overrides.moderationTags ?? [],
    moderationWordings: overrides.moderationWordings ?? [],
    performancePicturesStatus: overrides.performancePicturesStatus,
    performancePicturesScore: overrides.performancePicturesScore,
    capturedAt: now,
  } as CreativeSnapshotData;

  void store.upsertSnapshot<CreativeSnapshotData>({
    sellerId: overrides.sellerId ?? SELLER_IDS[0]!,
    kind: "creative-snapshot",
    source: "mercadolibre-api",
    data: creativeData,
    completeness: "complete",
    freshness: {
      source: "mercadolibre-api",
      signalKind: "creative-snapshot",
      risk: "medium",
      capturedAt: new Date(now),
      maxAgeMs: 24 * 60 * 60 * 1000,
      status: "fresh",
    },
    confidence: "high",
    evidence: {
      evidenceId: `orm:creative-snapshot:${overrides.sellerId ?? SELLER_IDS[0]!}:${overrides.itemId}:${now}`,
      snapshotKind: "creative-snapshot",
      sellerId: overrides.sellerId ?? SELLER_IDS[0]!,
      entityId: overrides.itemId,
      capturedAt: new Date(now),
      freshnessStatus: "fresh",
      completeness: "complete",
      source: "operational-read-model",
    },
  });
}

function seedVisitNode(
  engine: GraphEngine,
  itemId: string,
  totalVisits: number,
  capturedAt?: string,
  sellerId?: string,
): void {
  engine.getOrCreateNode(
    `visit_snapshot_${itemId}_${capturedAt ?? new Date().toISOString()}_${Math.random().toString(36).slice(2)}`,
    {
      type: "visit_snapshot",
      itemId,
      totalVisits,
      sellerId: sellerId ?? SELLER_IDS[0]!,
      capturedAt: capturedAt ?? new Date().toISOString(),
    },
  );
}

function seedProductAdsInsights(
  store: OperationalReadModel,
  overrides: {
    sellerId?: string;
    ads?: Array<{
      id: string;
      name?: string;
      itemId?: string;
      campaignId?: string;
      status?: string;
      metrics?: Record<string, number>;
    }>;
    campaigns?: Array<{
      id: string;
      name?: string;
      metrics?: Record<string, number>;
    }>;
  } = {},
): void {
  const now = new Date().toISOString();
  void store.upsertSnapshot({
    sellerId: overrides.sellerId ?? SELLER_IDS[0]!,
    kind: "product-ads-insights",
    source: "mercadolibre-api",
    data: {
      advertiser: { id: "adv-1", siteId: "MLC", productId: "PADS" },
      campaigns: overrides.campaigns ?? [],
      ads: overrides.ads ?? [],
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
      entityId: "test",
      capturedAt: new Date(now),
      freshnessStatus: "fresh",
      completeness: "complete",
      source: "operational-read-model",
    },
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe("creativeAssetsDaemon", () => {
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

  // ── 4.1 Empty state ─────────────────────────────────────────

  describe("with no data", () => {
    it("returns empty findings when no creative snapshots exist", async () => {
      const result: DaemonResult = await creativeAssetsDaemon({
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

  // ── 4.2 Signal 1: Low image count ───────────────────────────

  describe("Signal 1 — low image count", () => {
    it("flags warning when pictureCount is 0", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-LOW-IMG-001",
        pictureCount: 0,
        hasMainImage: false,
      });

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const lowImage = result.findings.filter((f) => f.summary.includes("Low image count"));
      expect(lowImage.length).toBeGreaterThanOrEqual(1);
      expect(lowImage[0]!.severity).toBe("warning");
      expect(lowImage[0]!.summary).toContain("MLC-LOW-IMG-001");
    });

    it("flags warning when pictureCount is 1", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-LOW-IMG-002",
        pictureCount: 1,
      });

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const lowImage = result.findings.filter((f) => f.summary.includes("Low image count"));
      expect(lowImage.length).toBeGreaterThanOrEqual(1);
    });

    it("skips signal when pictureCount is 2 or more", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-OK-IMG-001",
        pictureCount: 3,
      });

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const lowImage = result.findings.filter((f) => f.summary.includes("Low image count"));
      expect(lowImage).toEqual([]);
    });
  });

  // ── 4.3 Signal 2: Moderation blocked ────────────────────────

  describe("Signal 2 — moderation blocked", () => {
    it("flags warning when moderationStatus is blocked", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-BLOCKED-001",
        moderationStatus: "blocked",
        moderationTags: ["offensive_content"],
        moderationWordings: [{ kind: "offensive_content", value: "Contenido inapropiado" }],
      });

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const blocked = result.findings.filter((f) => f.summary.includes("Moderation blocked"));
      expect(blocked.length).toBeGreaterThanOrEqual(1);
      expect(blocked[0]!.severity).toBe("warning");
      expect(blocked[0]!.summary).toContain("MLC-BLOCKED-001");
    });

    it("skips signal when moderationStatus is active or none", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-ACTIVE-001",
        moderationStatus: "active",
      });

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const blocked = result.findings.filter((f) => f.summary.includes("Moderation blocked"));
      expect(blocked).toEqual([]);
    });
  });

  // ── 4.4 Signal 3: Poor PICTURES score ───────────────────────

  describe("Signal 3 — poor PICTURES score", () => {
    it("flags warning when PICTURES status is PENDING", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-PICT-001",
        performancePicturesStatus: "PENDING",
        performancePicturesScore: 30,
      });

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const poorPictures = result.findings.filter((f) => f.summary.includes("Poor PICTURES score"));
      expect(poorPictures.length).toBeGreaterThanOrEqual(1);
      expect(poorPictures[0]!.severity).toBe("warning");
      expect(poorPictures[0]!.summary).toContain("MLC-PICT-001");
    });

    it("skips signal when PICTURES status is COMPLETED", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-PICT-002",
        performancePicturesStatus: "COMPLETED",
        performancePicturesScore: 85,
      });

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const poorPictures = result.findings.filter((f) => f.summary.includes("Poor PICTURES score"));
      expect(poorPictures).toEqual([]);
    });

    it("skips signal when PICTURES data is undefined", async () => {
      // Omit performancePicturesStatus to test skipping
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-PICT-003",
      });

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const poorPictures = result.findings.filter((f) => f.summary.includes("Poor PICTURES score"));
      expect(poorPictures).toEqual([]);
    });
  });

  // ── 4.5 Signal 4: High-traffic + poor creative ─────────────

  describe("Signal 4 — high-traffic poor creative", () => {
    it("flags warning when visits > avg AND pictureCount < 2", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-HIGH-TRAFFIC-001",
        sellerId: SELLER_IDS[0]!,
        pictureCount: 1,
        hasMainImage: false,
        moderationStatus: "active",
        performancePicturesStatus: "COMPLETED",
      });
      // High visit item
      seedVisitNode(engine, "MLC-HIGH-TRAFFIC-001", 1000);
      // Other items for seller average (low visits)
      seedVisitNode(engine, "MLC-OTHER-001", 10);
      seedVisitNode(engine, "MLC-OTHER-002", 30);
      seedVisitNode(engine, "MLC-OTHER-003", 20);

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const highTraffic = result.findings.filter((f) =>
        f.summary.includes("High-traffic poor creative"),
      );
      expect(highTraffic.length).toBeGreaterThanOrEqual(1);
      expect(highTraffic[0]!.severity).toBe("warning");
      expect(highTraffic[0]!.summary).toContain("MLC-HIGH-TRAFFIC-001");
    });

    it("skips when visits > avg but creative is healthy", async () => {
      // Item with high visits but good creative
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-GOOD-CREATIVE",
        sellerId: SELLER_IDS[0]!,
        pictureCount: 5,
        hasMainImage: true,
        moderationStatus: "active",
        performancePicturesStatus: "COMPLETED",
      });
      seedVisitNode(engine, "MLC-GOOD-CREATIVE", 1000);
      // Low avg from other items
      seedVisitNode(engine, "MLC-OTHER-010", 10);
      seedVisitNode(engine, "MLC-OTHER-011", 20);

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const highTraffic = result.findings.filter((f) =>
        f.summary.includes("High-traffic poor creative"),
      );
      expect(highTraffic).toEqual([]);
    });

    it("skips when visits <= avg even with poor creative", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-LOW-TRAFFIC",
        sellerId: SELLER_IDS[0]!,
        pictureCount: 1,
        hasMainImage: false,
        moderationStatus: "blocked",
        performancePicturesStatus: "PENDING",
      });
      // Low visit item
      seedVisitNode(engine, "MLC-LOW-TRAFFIC", 5);
      // High avg from other items
      seedVisitNode(engine, "MLC-OTHER-020", 500);

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const highTraffic = result.findings.filter((f) =>
        f.summary.includes("High-traffic poor creative"),
      );
      expect(highTraffic).toEqual([]);
    });
  });

  // ── 4.6 Signal 5: Moderated-in-campaign ─────────────────────

  describe("Signal 5 — moderated-in-campaign", () => {
    it("flags critical when blocked AND in active campaign", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-MOD-CAMP-001",
        moderationStatus: "blocked",
      });
      seedProductAdsInsights(operationalStore, {
        ads: [
          {
            id: "ad-mod-camp-1",
            itemId: "MLC-MOD-CAMP-001",
            campaignId: "camp-1",
            status: "active",
            metrics: { investment: 100, revenue: 200 },
          },
        ],
      });

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const moderated = result.findings.filter((f) => f.summary.includes("Moderated-in-campaign"));
      expect(moderated.length).toBeGreaterThanOrEqual(1);
      expect(moderated[0]!.severity).toBe("critical");
      expect(moderated[0]!.summary).toContain("MLC-MOD-CAMP-001");
    });

    it("does NOT flag moderated-in-campaign when blocked but not in ads", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-BLOCKED-NOAD-001",
        moderationStatus: "blocked",
      });
      // No product ads data → no active ad set → signal skips

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const moderated = result.findings.filter((f) => f.summary.includes("Moderated-in-campaign"));
      expect(moderated).toEqual([]);

      // But R2 "moderation blocked" warning SHOULD fire
      const blocked = result.findings.filter((f) => f.summary.includes("Moderation blocked"));
      expect(blocked.length).toBeGreaterThanOrEqual(1);
    });

    it("does NOT flag moderated-in-campaign when item is in paused campaign only", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-PAUSED-AD-001",
        moderationStatus: "blocked",
      });
      seedProductAdsInsights(operationalStore, {
        ads: [
          {
            id: "ad-paused-1",
            itemId: "MLC-PAUSED-AD-001",
            campaignId: "camp-paused",
            status: "paused",
            metrics: { investment: 100, revenue: 200 },
          },
        ],
      });

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      const moderated = result.findings.filter((f) => f.summary.includes("Moderated-in-campaign"));
      expect(moderated).toEqual([]);
    });
  });

  // ── 4.7 Integration: full daemon run ────────────────────────

  describe("integration — full daemon run", () => {
    it("returns correct findings count with mixed data", async () => {
      // Item 1: low image count → warning
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-INT-001",
        pictureCount: 0,
        hasMainImage: false,
        moderationStatus: "active",
        performancePicturesStatus: "COMPLETED",
      });
      // Item 2: moderation blocked + in campaign → both R2 warning + critical
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-INT-002",
        pictureCount: 5,
        hasMainImage: true,
        moderationStatus: "blocked",
        performancePicturesStatus: "COMPLETED",
      });
      // Item 3: poor PICTURES → warning
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-INT-003",
        pictureCount: 3,
        hasMainImage: true,
        moderationStatus: "active",
        performancePicturesStatus: "PENDING",
      });
      // Item 4: healthy — no findings
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-INT-004",
        pictureCount: 5,
        hasMainImage: true,
        moderationStatus: "active",
        performancePicturesStatus: "COMPLETED",
      });

      seedProductAdsInsights(operationalStore, {
        ads: [
          {
            id: "ad-int-2",
            itemId: "MLC-INT-002",
            campaignId: "camp-int",
            status: "active",
            metrics: { investment: 100, revenue: 200 },
          },
        ],
      });

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      // Expected: 3 findings total
      // - low image count (warning)
      // - moderation blocked (warning)
      // - poor PICTURES score (warning)
      // - moderated-in-campaign (critical)
      // Blocked item is both moderation blocked AND moderated-in-campaign
      expect(result.findings.length).toBeGreaterThanOrEqual(3);

      const criticals = result.findings.filter((f) => f.severity === "critical");
      expect(criticals.length).toBe(1);
      expect(criticals[0]!.kind).toBe("alert");

      const warnings = result.findings.filter((f) => f.severity === "warning");
      expect(warnings.length).toBeGreaterThanOrEqual(2);
    });

    it("enqueues proposals with correct sender/receiver and noMutationExecuted", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-ENQ-001",
        pictureCount: 0,
        hasMainImage: false,
        moderationStatus: "active",
      });

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(result.messageIds.length).toBeGreaterThan(0);

      const msgRow = db
        .prepare("SELECT * FROM agent_message_bus WHERE message_id = ?")
        .get(result.messageIds[0]!) as Record<string, unknown> | undefined;

      expect(msgRow).toBeDefined();
      expect(msgRow!.sender_agent_id).toBe("creative-assets");
      expect(msgRow!.receiver_agent_id).toBe("ceo");
      expect(msgRow!.message_type).toBe("proposal");

      const payload = JSON.parse(msgRow!.payload_json as string); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      expect(payload.noMutationExecuted).toBe(true); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
    });

    it("uses correct dedupeKey format with hour segment", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-DEDUP-001",
        pictureCount: 1,
        hasMainImage: false,
      });

      const result = await creativeAssetsDaemon({
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
          /^creative-assets-(critical|warning)-\d{4}-\d{2}-\d{2}T\d{2}$/,
        );
        const pl = JSON.parse(row!.payload_json); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        expect(pl.noMutationExecuted).toBe(true); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
      }
    });

    it("enqueues creative-studio delegation message when env gate is enabled and low image count detected", () => {
      // Set env gate for creative-studio
      process.env.MSL_CREATIVE_STUDIO_ENABLED = "true";

      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-STUDIO-001",
        pictureCount: 0,
        hasMainImage: false,
        moderationStatus: "active",
      });

      // Verify CEO proposal was enqueued (existing flow preserved)
      const ceoMessages = db
        .prepare("SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'ceo'")
        .all() as Array<Record<string, unknown>>;
      expect(ceoMessages.length).toBeGreaterThan(0);

      // Verify creative-studio message was enqueued (new delegation)
      const studioMessages = db
        .prepare("SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'creative-studio'")
        .all() as Array<Record<string, unknown>>;
      expect(studioMessages.length).toBeGreaterThan(0);
      expect(studioMessages[0]!.sender_agent_id).toBe("creative-assets");
      expect(studioMessages[0]!.message_type).toBe("proposal");

      const payload = JSON.parse(studioMessages[0]!.payload_json as string); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      expect(payload.requestId).toContain("cj_"); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
      expect(payload.kind).toBe("product-cover-i2i"); // eslint-disable-line @typescript-eslint/no-unsafe-member-access
      expect(payload.channel).toBe("mercadolibre"); // eslint-disable-line @typescript-eslint/no-unsafe-member-access

      // Clean up
      delete process.env.MSL_CREATIVE_STUDIO_ENABLED;
    });

    it("does NOT enqueue creative-studio delegation when env gate is disabled", () => {
      process.env.MSL_CREATIVE_STUDIO_ENABLED = "false";

      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-STUDIO-002",
        pictureCount: 0,
        hasMainImage: false,
        moderationStatus: "active",
      });

      // CEO proposal should still be enqueued
      const ceoMessages = db
        .prepare("SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'ceo'")
        .all() as Array<Record<string, unknown>>;
      expect(ceoMessages.length).toBeGreaterThan(0);

      // No creative-studio message
      const studioMessages = db
        .prepare("SELECT * FROM agent_message_bus WHERE receiver_agent_id = 'creative-studio'")
        .all() as Array<Record<string, unknown>>;
      expect(studioMessages).toEqual([]);

      delete process.env.MSL_CREATIVE_STUDIO_ENABLED;
    });

    it("returns empty findings when all checks pass (healthy listings)", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-HEALTHY-001",
        pictureCount: 5,
        hasMainImage: true,
        moderationStatus: "active",
        performancePicturesStatus: "COMPLETED",
        performancePicturesScore: 90,
      });
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-HEALTHY-002",
        pictureCount: 3,
        hasMainImage: true,
        moderationStatus: "active",
        performancePicturesStatus: "COMPLETED",
        performancePicturesScore: 80,
      });

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      expect(result.findings).toEqual([]);
      expect(result.proposalEnqueued).toBe(false);
    });
  });

  // ── 4.8 Edge cases ─────────────────────────────────────────

  describe("edge cases", () => {
    it("handles multiple sellers without error", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-MULTI-001",
        pictureCount: 0,
        hasMainImage: false,
        moderationStatus: "active",
      });

      const multiSellerResult = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: ["seller-a", "seller-b"],
      });

      expect(multiSellerResult.findings.length).toBeGreaterThanOrEqual(0);
      // Should not throw
    });

    it("survives missing visit data without affecting other signals", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-NO-VISIT-001",
        pictureCount: 0,
        moderationStatus: "active",
      });

      // No visit nodes seeded — Cortex returns empty for visit queries

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      // Signal 1 (low image count) should still fire despite no visit data
      const lowImage = result.findings.filter((f) => f.summary.includes("Low image count"));
      expect(lowImage.length).toBeGreaterThanOrEqual(1);

      // Signal 4 should be silently skipped (no visit baseline)
      const highTraffic = result.findings.filter((f) =>
        f.summary.includes("High-traffic poor creative"),
      );
      expect(highTraffic).toEqual([]);
    });

    it("survives missing product-ads-insights data without error", async () => {
      seedCreativeSnapshot(operationalStore, {
        itemId: "MLC-NO-ADS-001",
        pictureCount: 0,
        moderationStatus: "blocked",
      });

      // No ads insights seeded

      const result = await creativeAssetsDaemon({
        claim: claimFixture(),
        reader: operationalStore,
        cortex: engine,
        bus,
        sellerIds: SELLER_IDS,
      });

      // Signal 2 (moderation blocked) should still fire
      const blocked = result.findings.filter((f) => f.summary.includes("Moderation blocked"));
      expect(blocked.length).toBeGreaterThanOrEqual(1);

      // Signal 5 should be silently skipped (no ads data)
      const moderated = result.findings.filter((f) => f.summary.includes("Moderated-in-campaign"));
      expect(moderated).toEqual([]);
    });
  });
});
