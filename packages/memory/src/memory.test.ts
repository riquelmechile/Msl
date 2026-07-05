import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { unlinkSync } from "node:fs";

import {
  createPreparedAction,
  evaluateFreshness,
  guardrailsForCandidateEvidence,
  summarizeProjectionReadiness,
  type ApprovalRecord,
  type ReadSnapshot,
  type StorefrontCandidate,
  type StorefrontProjection,
} from "@msl/domain";

import {
  canStoreInCortex,
  createSqliteOwnedEcommerceStore,
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

describe("owned ecommerce operational store", () => {
  it("persists stale and incomplete evidence with redacted guardrail reasons", async () => {
    const db = new Database(":memory:");
    try {
      const store = createSqliteOwnedEcommerceStore(db);
      const checks = guardrailsForCandidateEvidence({
        stockFreshness: "stale",
        marginFreshness: "unknown",
        supplierFreshness: "fresh",
        completeness: "partial",
        evidenceIds: ["evidence-stock-stale", "evidence-margin-missing"],
      });
      const candidate: StorefrontCandidate = {
        id: "candidate-1",
        rank: 1,
        itemRef: "jinpeng:XKP-001",
        title: "Supplier item",
        provenance: {
          source: "supplier-mirror",
          sourceId: "jinpeng:XKP-001",
          supplierId: "jinpeng",
          snapshotIds: ["snapshot-1"],
          evidenceIds: [
            "evidence-stock-stale",
            "evidence-margin-missing",
            "evidence-candidate-only",
          ],
        },
        evidenceIds: ["evidence-stock-stale", "evidence-margin-missing", "evidence-candidate-only"],
        evidenceState: {
          stockFreshness: "stale",
          marginFreshness: "unknown",
          supplierFreshness: "fresh",
          completeness: "partial",
          evidenceIds: [
            "evidence-stock-stale",
            "evidence-margin-missing",
            "evidence-candidate-only",
          ],
        },
        stock: {
          status: "unknown",
          authority: "unknown",
          evidenceId: "evidence-stock-stale",
        },
        blockedReasons: checks.map((check) => check.code),
        redactedReasons: checks.map((check) => check.redactedMessage),
        createdAt: "2026-07-04T00:00:00.000Z",
      };
      const projection: StorefrontProjection = {
        id: "projection-1",
        candidateIds: [candidate.id],
        status: "preview",
        catalog: {
          collectionHandle: "storage",
          products: [
            {
              handle: "supplier-item",
              title: "Supplier item",
              description: "Preview-only product projection.",
              variants: [
                {
                  sku: "XKP-001",
                  title: "Default",
                  price: 1000,
                  currency: "CLP",
                  evidenceIds: ["evidence-margin-missing"],
                },
              ],
              evidenceIds: ["evidence-stock-stale"],
            },
          ],
        },
        content: {
          seoTitle: "Supplier item preview",
          geoCopy: "Preview content requiring fresh evidence before publishing.",
          claims: [
            {
              id: "claim-1",
              text: "Availability needs fresh confirmation.",
              claimType: "availability",
              evidenceIds: ["evidence-stock-stale"],
              status: "blocked",
              redactedReason: "Stock evidence is stale.",
            },
          ],
          schemaMetadata: { type: "Product" },
        },
        media: [
          {
            src: "https://example.invalid/image.jpg",
            alt: "Supplier item",
            width: 800,
            height: 800,
            sizes: "(max-width: 768px) 100vw, 50vw",
            hash: "hash-1",
            priority: true,
            evidenceIds: ["evidence-media-1"],
          },
        ],
        readiness: {
          status: summarizeProjectionReadiness(checks),
          checks,
          generatedAt: "2026-07-04T00:01:00.000Z",
        },
        evidenceIds: ["evidence-stock-stale", "evidence-margin-missing", "evidence-media-1"],
        generatedAt: "2026-07-04T00:01:00.000Z",
      };

      await store.upsertCandidate(candidate);
      await store.upsertProjection(projection);
      await store.recordValidation({
        id: "validation-1",
        projectionId: projection.id,
        result: { ...checks[0]!, evidenceIds: ["evidence-validation-result-only"] },
        evidenceIds: ["evidence-validation-top-level"],
        redactedMessage: checks[0]!.redactedMessage,
        createdAt: "2026-07-04T00:02:00.000Z",
      });
      const action = createPreparedAction({
        id: "action-owned-ecommerce-publish-1",
        sellerId: "seller-1",
        kind: "owned-ecommerce-publish",
        target: { type: "storefront-projection", projectionId: projection.id },
        exactChange: [{ field: "status", from: "preview", to: "published" }],
        rationale: "Publish the approved storefront projection.",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      });
      const approval: ApprovalRecord = {
        id: "approval-1",
        actionId: action.id,
        sellerId: action.sellerId,
        approvedBy: "seller",
        approvedAt: new Date("2026-07-04T00:03:00.000Z"),
        exactChangeAccepted: action.exactChange,
        riskAccepted: action.riskLevel,
        executionStatus: "not-executed",
      };
      await store.recordApproval({
        id: approval.id,
        projectionId: projection.id,
        actionId: action.id,
        approval,
        evidenceIds: ["evidence-approval-1"],
        redactedReason: "CEO approved publish for this projection.",
        createdAt: "2026-07-04T00:04:00.000Z",
      });

      await expect(store.getCandidate(candidate.id)).resolves.toMatchObject({
        id: "candidate-1",
        blockedReasons: ["stale-stock-evidence", "unknown-margin-evidence", "incomplete-evidence"],
        redactedReasons: [
          "Stock evidence is stale.",
          "Margin evidence is unavailable.",
          "Required storefront evidence is incomplete.",
        ],
      });
      await expect(store.getProjection(projection.id)).resolves.toMatchObject({
        id: "projection-1",
        readiness: { status: "blocked" },
      });
      await expect(store.listValidationResults(projection.id)).resolves.toMatchObject([
        {
          id: "validation-1",
          evidenceIds: ["evidence-validation-top-level"],
          redactedMessage: "Stock evidence is stale.",
        },
      ]);
      const storedApproval = await store.getApproval(approval.id);
      expect(storedApproval).toMatchObject({
        id: "approval-1",
        evidenceIds: ["evidence-approval-1"],
      });
      expect(storedApproval?.approval.approvedAt).toBeInstanceOf(Date);
      expect(storedApproval?.approval.approvedAt.toISOString()).toBe("2026-07-04T00:03:00.000Z");
      await expect(
        store.recordApproval({
          id: approval.id,
          projectionId: projection.id,
          actionId: action.id,
          approval,
          evidenceIds: ["evidence-approval-1"],
          redactedReason: "CEO approved publish for this projection.",
          createdAt: "2026-07-04T00:04:00.000Z",
        }),
      ).resolves.toEqual(storedApproval);
      await expect(store.getApproval(approval.id)).resolves.toEqual(storedApproval);
      await expect(store.listEvidenceIdsForProjection(projection.id)).resolves.toEqual([
        "evidence-stock-stale",
        "evidence-margin-missing",
        "evidence-media-1",
        "evidence-candidate-only",
        "evidence-validation-top-level",
        "evidence-validation-result-only",
        "evidence-approval-1",
      ]);

      await expect(
        store.recordApproval({
          id: approval.id,
          projectionId: projection.id,
          actionId: action.id,
          approval: { ...approval, riskAccepted: "critical" },
          evidenceIds: ["evidence-approval-mutated"],
          redactedReason: "Changed audit trail.",
          createdAt: "2026-07-04T00:05:00.000Z",
        }),
      ).rejects.toThrow(
        "Owned ecommerce approval id collision for approval-1: existing audit record differs",
      );
    } finally {
      db.close();
    }
  });

  it("fails closed when persisted approval audit dates are malformed", async () => {
    const malformedDates = [
      ["invalid", "not-a-date"],
      ["null", null],
      ["missing", undefined],
      ["number", 0],
    ] as const;

    for (const [name, approvedAt] of malformedDates) {
      const db = new Database(":memory:");
      try {
        const store = createSqliteOwnedEcommerceStore(db);
        const approvalJson: Record<string, unknown> = {
          id: `approval-malformed-date-${name}`,
          actionId: `action-owned-ecommerce-publish-${name}`,
          sellerId: "seller-1",
          approvedBy: "seller",
          approvedAt,
          exactChangeAccepted: [{ field: "status", from: "preview", to: "published" }],
          riskAccepted: "high",
          executionStatus: "not-executed",
        };
        if (approvedAt === undefined) {
          delete approvalJson.approvedAt;
        }
        db.prepare(
          `INSERT INTO owned_ecommerce_approvals (
            id, projection_id, action_id, approval_json, evidence_ids_json, redacted_reason, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          `approval-malformed-date-${name}`,
          "projection-1",
          `action-owned-ecommerce-publish-${name}`,
          JSON.stringify(approvalJson),
          JSON.stringify(["evidence-approval-1"]),
          "CEO approved publish for this projection.",
          "2026-07-04T00:04:00.000Z",
        );

        await expect(store.getApproval(`approval-malformed-date-${name}`)).rejects.toThrow(
          `Owned ecommerce audit integrity error for approval approval-malformed-date-${name}: invalid approvedAt`,
        );
      } finally {
        db.close();
      }
    }
  });

  it("fails closed when a second approval id targets an existing projection action", async () => {
    const db = new Database(":memory:");
    try {
      const store = createSqliteOwnedEcommerceStore(db);
      const approval: ApprovalRecord = {
        id: "approval-1",
        actionId: "action-owned-ecommerce-publish-1",
        sellerId: "seller-1",
        approvedBy: "seller",
        approvedAt: new Date("2026-07-04T00:03:00.000Z"),
        exactChangeAccepted: [{ field: "status", from: "preview", to: "published" }],
        riskAccepted: "high",
        executionStatus: "not-executed",
      };

      await store.recordApproval({
        id: approval.id,
        projectionId: "projection-1",
        actionId: approval.actionId,
        approval,
        evidenceIds: ["evidence-approval-1"],
        redactedReason: "CEO approved publish for this projection.",
        createdAt: "2026-07-04T00:04:00.000Z",
      });

      await expect(
        store.recordApproval({
          id: "approval-2",
          projectionId: "projection-1",
          actionId: approval.actionId,
          approval: { ...approval, id: "approval-2" },
          evidenceIds: ["evidence-approval-2"],
          redactedReason: "CEO approved publish for this projection.",
          createdAt: "2026-07-04T00:05:00.000Z",
        }),
      ).rejects.toThrow(
        "Owned ecommerce approval action collision for action-owned-ecommerce-publish-1: existing audit record differs",
      );

      await expect(store.getApproval("approval-2")).resolves.toBeNull();
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
