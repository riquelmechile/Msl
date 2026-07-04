import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { unlinkSync } from "node:fs";

import { evaluateFreshness, type ReadSnapshot } from "@msl/domain";

import {
  canStoreInCortex,
  createSqliteSupplierMirrorStore,
  decideReadSnapshotFreshness,
  decideSelectiveSync,
  decideCortexFeedbackAction,
  type DelegationApprovalFeedback,
  type OperationalReadModelReader,
  type PgvectorMemoryStore,
  type PostgresRepositoryBoundary,
} from "./index.js";
import { backupDatabase } from "./backup.js";
import { createGraphEngine } from "./cortex/index.js";

function listingSnapshot(
  overrides: Partial<ReadSnapshot<{ id: string }>> = {},
): ReadSnapshot<{ id: string }> {
  return {
    sellerId: "seller-1",
    kind: "listing",
    source: "mercadolibre-api",
    data: [{ id: "MLC123" }],
    completeness: "complete",
    freshness: evaluateFreshness({
      source: "mercadolibre-api",
      signalKind: "listing",
      capturedAt: new Date("2026-06-25T12:00:00.000Z"),
      now: new Date("2026-06-25T12:05:00.000Z"),
    }),
    confidence: "high",
    ...overrides,
  };
}

describe("PostgreSQL and pgvector memory boundaries", () => {
  it("keeps repository contracts local-first by default", async () => {
    const saved: string[] = [];
    const repository: PostgresRepositoryBoundary<{ id: string }, string> = {
      storage: "postgresql",
      residency: "local-only",
      findById: (id) => Promise.resolve({ id }),
      save: (entity) => {
        saved.push(entity.id);
        return Promise.resolve();
      },
      transaction: (operation) => operation(),
    };

    await repository.save({ id: "memory-1" });

    expect(repository.storage).toBe("postgresql");
    expect(repository.residency).toBe("local-only");
    expect(saved).toEqual(["memory-1"]);
  });

  it("defines pgvector search without requiring an external service", async () => {
    const store: PgvectorMemoryStore = {
      storage: "postgresql-pgvector",
      upsert: () => Promise.resolve(),
      search: () => Promise.resolve([]),
    };

    await expect(
      store.search({ sellerId: "seller-1", embedding: [0.1, 0.2], limit: 3 }),
    ).resolves.toEqual([]);
  });
});

describe("selective sync policy", () => {
  it("keeps fresh local data local when remote sync is not explicitly needed", () => {
    const freshness = evaluateFreshness({
      source: "local-cache",
      signalKind: "historical-summary",
      capturedAt: new Date("2026-06-25T00:00:00.000Z"),
      now: new Date("2026-06-25T12:00:00.000Z"),
    });

    expect(decideSelectiveSync({ freshness, explicitRemoteSyncNeeded: false })).toEqual({
      shouldSync: false,
      storage: "local-only",
      reason: "fresh-local",
      refreshMode: "none",
    });
  });

  it("prioritizes stale critical signals without broad remote sync", () => {
    const freshness = evaluateFreshness({
      source: "local-cache",
      signalKind: "claim",
      capturedAt: new Date("2026-06-25T12:00:00.000Z"),
      now: new Date("2026-06-25T12:06:00.000Z"),
    });

    expect(decideSelectiveSync({ freshness, explicitRemoteSyncNeeded: false })).toEqual({
      shouldSync: true,
      storage: "local-only",
      reason: "critical-stale-refresh",
      refreshMode: "webhook-or-risk-scheduled",
    });
  });
});

describe("read snapshot freshness decisions", () => {
  it("allows fresh complete snapshots with usable confidence", () => {
    expect(decideReadSnapshotFreshness(listingSnapshot())).toEqual({
      status: "fresh-enough",
      reason: "fresh-complete-confidence",
      refreshRequired: false,
    });
  });

  it("requires refresh for stale snapshots", () => {
    const staleSnapshot = listingSnapshot({
      freshness: evaluateFreshness({
        source: "mercadolibre-api",
        signalKind: "listing",
        capturedAt: new Date("2026-06-25T12:00:00.000Z"),
        now: new Date("2026-06-25T13:01:00.000Z"),
      }),
    });

    expect(decideReadSnapshotFreshness(staleSnapshot)).toEqual({
      status: "refresh-required",
      reason: "stale",
      refreshRequired: true,
    });
  });

  it("requires refresh for partial snapshots before claiming confidence", () => {
    expect(decideReadSnapshotFreshness(listingSnapshot({ completeness: "partial" }))).toEqual({
      status: "refresh-required",
      reason: "partial",
      refreshRequired: true,
    });
  });
});

describe("operational read-model boundaries", () => {
  it("defines minimal read-model interfaces without requiring ingestion", async () => {
    const reader: OperationalReadModelReader = {
      findEvidence: () => Promise.resolve(null),
      readSnapshot: () => Promise.resolve(null),
      listSnapshots: () => Promise.resolve([]),
    };

    await expect(
      reader.findEvidence({ sellerId: "seller-1", snapshotKind: "listing" }),
    ).resolves.toBeNull();
  });
});

describe("supplier mirror operational store", () => {
  it("migrates and stores suppliers, snapshots, confidence metadata, and stock observations", async () => {
    const db = new Database(":memory:");
    try {
      const store = createSqliteSupplierMirrorStore(db);

      await store.upsertSupplier({
        id: "jinpeng",
        name: "Jinpeng / XKP",
        enabled: true,
        primarySource: "mercadolibre-api",
        metadata: { country: "CL" },
        createdAt: "2026-07-03T00:00:00.000Z",
        updatedAt: "2026-07-03T00:00:00.000Z",
      });

      await store.upsertSupplierItemSnapshot({
        supplierId: "jinpeng",
        supplierItemId: "XKP-001",
        mlItemId: "MLC100",
        title: "Supplier item",
        sku: "SKU-1",
        categoryId: "storage",
        price: 1000,
        currency: "CLP",
        snapshot: { color: "black" },
        source: "mercadolibre-api",
        confidence: "high",
        freshness: "fresh",
        evidenceId: "evidence-snapshot-1",
        capturedAt: "2026-07-03T00:01:00.000Z",
      });

      await store.recordStockObservation({
        id: "stock-1",
        supplierId: "jinpeng",
        supplierItemId: "XKP-001",
        source: "mercadolibre-api",
        authority: "stock-authoritative",
        quantity: 2,
        status: "low-stock",
        confidence: "high",
        evidenceId: "evidence-stock-1",
        capturedAt: "2026-07-03T00:02:00.000Z",
      });

      await expect(store.listEnabledSuppliers()).resolves.toMatchObject([
        { id: "jinpeng", enabled: true, primarySource: "mercadolibre-api" },
      ]);
      await expect(store.getSupplierItemSnapshot("jinpeng", "XKP-001")).resolves.toMatchObject({
        supplierId: "jinpeng",
        confidence: "high",
        freshness: "fresh",
        evidenceId: "evidence-snapshot-1",
      });
      await expect(store.listStockObservations("jinpeng", "XKP-001")).resolves.toMatchObject([
        {
          authority: "stock-authoritative",
          confidence: "high",
          evidenceId: "evidence-stock-1",
          quantity: 2,
        },
      ]);
    } finally {
      db.close();
    }
  });

  it("resolves target policies without using the old Plasticov to Maustian direction guard", async () => {
    const db = new Database(":memory:");
    try {
      const store = createSqliteSupplierMirrorStore(db);

      await store.upsertTargetPolicy({
        scopeType: "supplier",
        scopeId: "jinpeng",
        supplierId: "jinpeng",
        targetSellerIds: ["plasticov", "maustian"],
        lowStockThreshold: 3,
        autoPauseAllowed: false,
        pricingPolicy: { kind: "multiplier", multiplier: 3 },
      });
      await store.upsertTargetPolicy({
        scopeType: "category",
        scopeId: "storage",
        supplierId: "jinpeng",
        targetSellerIds: ["maustian"],
        lowStockThreshold: 2,
        autoPauseAllowed: true,
      });

      await expect(
        store.resolveTargetPolicy({
          supplierId: "jinpeng",
          supplierItemId: "XKP-001",
          categoryId: "storage",
        }),
      ).resolves.toMatchObject({
        scopeType: "category",
        targetSellerIds: ["maustian"],
        autoPauseAllowed: true,
      });
      await expect(
        store.resolveTargetPolicy({ supplierId: "jinpeng", supplierItemId: "XKP-002" }),
      ).resolves.toMatchObject({
        scopeType: "supplier",
        targetSellerIds: ["plasticov", "maustian"],
        pricingPolicy: { kind: "multiplier", multiplier: 3 },
      });
    } finally {
      db.close();
    }
  });

  it("upserts mappings and keeps ledger writes idempotent by action key", async () => {
    const db = new Database(":memory:");
    try {
      const store = createSqliteSupplierMirrorStore(db);

      await store.upsertTargetMapping({
        supplierId: "jinpeng",
        supplierItemId: "XKP-001",
        targetSellerId: "maustian",
        targetItemId: "MLC200",
        policyRef: {
          scopeType: "category",
          scopeId: "storage",
          supplierId: "jinpeng",
        },
        state: "approved",
        approvedAt: "2026-07-03T00:03:00.000Z",
        evidenceIds: ["evidence-mapping-1"],
      });

      const firstLedger = await store.appendLedger({
        id: "ledger-1",
        actionType: "skip",
        idempotencyKey: "supplier-mirror:skip:jinpeng:XKP-001:maustian",
        status: "skipped",
        reason: "unmapped-target-policy",
        supplierId: "jinpeng",
        supplierItemId: "XKP-001",
        targetSellerId: "maustian",
        targetItemId: "MLC200",
        evidenceIds: ["evidence-stock-1"],
        before: null,
        after: null,
        createdAt: "2026-07-03T00:04:00.000Z",
      });
      const duplicateLedger = await store.appendLedger({
        ...firstLedger,
        id: "ledger-duplicate",
        status: "failed",
        reason: "should-not-replace-original",
      });

      await expect(store.listTargetMappings("jinpeng", "XKP-001")).resolves.toMatchObject([
        {
          targetSellerId: "maustian",
          policyRef: { scopeType: "category", scopeId: "storage", supplierId: "jinpeng" },
          state: "approved",
          evidenceIds: ["evidence-mapping-1"],
        },
      ]);
      expect(duplicateLedger).toMatchObject({
        id: "ledger-1",
        status: "skipped",
        reason: "unmapped-target-policy",
      });
    } finally {
      db.close();
    }
  });

  it("fails safely when a ledger id collides with a different idempotency key", async () => {
    const db = new Database(":memory:");
    try {
      const store = createSqliteSupplierMirrorStore(db);
      const record = {
        id: "ledger-1",
        actionType: "skip" as const,
        idempotencyKey: "supplier-mirror:skip:jinpeng:XKP-001:maustian",
        status: "skipped" as const,
        reason: "unmapped-target-policy",
        supplierId: "jinpeng",
        supplierItemId: "XKP-001",
        targetSellerId: "maustian",
        targetItemId: "MLC200",
        evidenceIds: ["evidence-stock-1"],
        before: null,
        after: null,
        createdAt: "2026-07-03T00:04:00.000Z",
      };

      await store.appendLedger(record);

      await expect(
        store.appendLedger({
          ...record,
          idempotencyKey: "supplier-mirror:skip:jinpeng:XKP-001:plasticov",
        }),
      ).rejects.toThrow(
        "Supplier Mirror ledger id collision for ledger-1: existing idempotency key supplier-mirror:skip:jinpeng:XKP-001:maustian does not match supplier-mirror:skip:jinpeng:XKP-001:plasticov",
      );
    } finally {
      db.close();
    }
  });

  it("stores notification preferences and learned fallback policy skeletons for later slices", async () => {
    const db = new Database(":memory:");
    try {
      const store = createSqliteSupplierMirrorStore(db);

      await store.saveNotificationPreference({
        scopeType: "supplier",
        scopeId: "jinpeng",
        preference: { suppressLowConfidenceStock: true },
      });
      await store.upsertLearnedFallbackPolicy({
        id: "policy-1",
        policyType: "pricing",
        scope: { supplierId: "jinpeng" },
        decision: { kind: "multiplier", multiplier: 3 },
        confidence: "medium",
        evidenceIds: ["evidence-ceo-answer-1"],
        status: "proposed",
      });
      await store.recordNotificationEvent({
        id: "notification-1",
        type: "pause-deferred",
        status: "pending",
        supplierId: "jinpeng",
        supplierItemId: "XKP-001",
        targetSellerId: "maustian",
        targetItemId: "MLC200",
        reason: "target-seller-not-allowed-by-policy",
        evidenceIds: ["evidence-stock-1"],
        metadata: { policyTargetSellerIds: ["plasticov"] },
        createdAt: "2026-07-04T00:00:00.000Z",
      });

      await expect(store.getNotificationPreference("supplier", "jinpeng")).resolves.toMatchObject({
        preference: { suppressLowConfidenceStock: true },
      });
      await expect(store.getLearnedFallbackPolicy("policy-1")).resolves.toMatchObject({
        policyType: "pricing",
        confidence: "medium",
        evidenceIds: ["evidence-ceo-answer-1"],
        status: "proposed",
      });
      await expect(store.getNotificationEvent("notification-1")).resolves.toMatchObject({
        type: "pause-deferred",
        status: "pending",
        supplierId: "jinpeng",
        targetSellerId: "maustian",
        reason: "target-seller-not-allowed-by-policy",
        evidenceIds: ["evidence-stock-1"],
      });
    } finally {
      db.close();
    }
  });
});

describe("Cortex delegation feedback boundaries", () => {
  it("maps approval feedback to reinforcement without storing catalog snapshots", () => {
    const feedback: DelegationApprovalFeedback = {
      kind: "approval",
      proposalId: "proposal-1",
      sellerId: "seller-1",
      reasoningEdgeIds: [1, 2],
      evidenceIds: ["evidence-1"],
      observedAt: "2026-07-02T00:00:00.000Z",
      approvedScope: "prepare campaign draft",
      outcome: "positive",
    };

    expect(decideCortexFeedbackAction(feedback)).toEqual({
      action: "reinforce",
      proposalId: "proposal-1",
      reasoningEdgeIds: [1, 2],
      evidenceIds: ["evidence-1"],
    });
    expect(
      canStoreInCortex({
        kind: "full-catalog-snapshot",
        sellerId: "seller-1",
        payload: { listings: [{ id: "MLC123" }] },
      }),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Database backup (bottleneck 2.7)
// ─────────────────────────────────────────────────────────────────────
describe("backupDatabase", () => {
  const backupPath = "/tmp/msl-backup-test.db";

  it("creates a valid backup copy of a file-based database", async () => {
    const sourcePath = "/tmp/msl-backup-source.db";
    // Clean up from previous runs
    try {
      unlinkSync(sourcePath);
    } catch {
      /* ok */
    }
    try {
      unlinkSync(backupPath);
    } catch {
      /* ok */
    }

    // Create a file-based source DB with some data.
    const sourceDb = new Database(sourcePath);
    try {
      sourceDb.pragma("journal_mode = WAL");
      sourceDb.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
      sourceDb.exec("INSERT INTO test (value) VALUES ('hello'), ('world')");

      const pages = await backupDatabase(sourceDb, backupPath, false);
      expect(typeof pages).toBe("number");
    } finally {
      sourceDb.close();
    }

    // Open the backup and verify data integrity
    const backup = new Database(backupPath);
    try {
      const rows = backup.prepare("SELECT * FROM test").all() as Array<{
        id: number;
        value: string;
      }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]!.value).toBe("hello");
      expect(rows[1]!.value).toBe("world");
    } finally {
      backup.close();
    }

    // Cleanup
    try {
      unlinkSync(sourcePath);
    } catch {
      /* ok */
    }
    try {
      unlinkSync(backupPath);
    } catch {
      /* ok */
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cortex Darwinian Feedback: empty constellation + outcome node recording
// ─────────────────────────────────────────────────────────────────────
describe("Cortex outcome node recording (engine-level)", () => {
  it("traverse() returns zero edges on empty graph", () => {
    const engine = createGraphEngine(":memory:");
    const result = engine.traverse();
    expect(result.traversedEdges).toHaveLength(0);
    expect(result.activatedNodes).toHaveLength(0);
  });

  it("createNode persists proposal_outcome with metadata even when graph is empty", () => {
    const engine = createGraphEngine(":memory:");
    const timestamp = new Date().toISOString();

    const node = engine.createNode(`proposal_outcome_${timestamp}`, {
      type: "proposal_outcome",
      outcome: "rejected",
      sellerId: "seller-test",
      timestamp,
    });

    expect(node.id).toBeGreaterThan(0);

    // Query back by metadata
    const outcomeNodes = engine.queryByMetadata({ type: "proposal_outcome" });
    expect(outcomeNodes).toHaveLength(1);
    expect(outcomeNodes[0]!.metadata).toMatchObject({
      type: "proposal_outcome",
      outcome: "rejected",
      sellerId: "seller-test",
    });
  });

  it("outcome node persists even when constellation remains empty after previous turns", () => {
    const engine = createGraphEngine(":memory:");

    // Empty graph — traverse returns nothing.
    expect(engine.traverse().traversedEdges).toHaveLength(0);

    // Record two outcomes — both should be persisted.
    const ts1 = new Date().toISOString();
    engine.createNode(`proposal_outcome_${ts1}`, {
      type: "proposal_outcome",
      outcome: "confirmed",
      sellerId: "seller-1",
      timestamp: ts1,
    });

    const ts2 = new Date(Date.now() + 1000).toISOString();
    engine.createNode(`proposal_outcome_${ts2}`, {
      type: "proposal_outcome",
      outcome: "rejected",
      sellerId: "seller-1",
      timestamp: ts2,
    });

    const nodes = engine.queryByMetadata({ type: "proposal_outcome" });
    expect(nodes).toHaveLength(2);
  });
});
