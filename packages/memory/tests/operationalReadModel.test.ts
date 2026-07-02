import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createSqliteOperationalReadModel,
  migrateOperationalStore,
} from "../src/operationalReadModel.js";
import type {
  OperationalReadModel,
  OperationalReadModelSnapshot,
} from "../src/operationalReadModel.js";
import { decideReadSnapshotFreshness } from "../src/index.js";
import type { MlcListingSummary, MlcPriceToWinSummary } from "@msl/mercadolibre";

// ── Helpers ───────────────────────────────────────────────────────────

function makeListingSnapshot(
  overrides: Partial<{
    sellerId: string;
    itemId: string;
    capturedAt: Date;
    freshnessStatus: "fresh" | "stale";
    completeness: "complete" | "partial";
    confidence: "low" | "medium" | "high";
  }> = {},
): OperationalReadModelSnapshot<MlcListingSummary> {
  const sellerId = overrides.sellerId ?? "plasticov";
  const itemId = overrides.itemId ?? "MLC123";
  const capturedAt = overrides.capturedAt ?? new Date("2026-07-01T12:00:00Z");
  const freshnessStatus = overrides.freshnessStatus ?? "fresh";
  const completeness = overrides.completeness ?? "complete";
  const confidence = overrides.confidence ?? "high";

  return {
    sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data: {
      id: itemId,
      title: "Test Product",
      price: 1000,
      currencyId: "CLP",
      status: "active",
    },
    completeness,
    freshness: {
      source: "mercadolibre-api",
      signalKind: "listing",
      risk: "medium",
      capturedAt,
      maxAgeMs: 60 * 60 * 1000,
      status: freshnessStatus,
    },
    confidence,
    evidence: {
      evidenceId: `orm:listing:${sellerId}:${itemId}:${capturedAt.toISOString()}`,
      snapshotKind: "listing",
      sellerId,
      entityId: itemId,
      capturedAt,
      freshnessStatus,
      completeness,
      source: "operational-read-model",
    },
  };
}

function makePricingSnapshot(
  overrides: Partial<{
    sellerId: string;
    itemId: string;
    capturedAt: Date;
    freshnessStatus: "fresh" | "stale";
    completeness: "complete" | "partial";
    confidence: "low" | "medium" | "high";
  }> = {},
): OperationalReadModelSnapshot<MlcPriceToWinSummary & { noMutationExecuted: true }> {
  const sellerId = overrides.sellerId ?? "plasticov";
  const itemId = overrides.itemId ?? "MLC123";
  const capturedAt = overrides.capturedAt ?? new Date("2026-07-01T12:00:00Z");
  const freshnessStatus = overrides.freshnessStatus ?? "fresh";
  const completeness = overrides.completeness ?? "complete";
  const confidence = overrides.confidence ?? "high";

  return {
    sellerId,
    kind: "pricing",
    source: "mercadolibre-api",
    data: {
      itemId,
      currentPrice: 1000,
      priceToWin: 950,
      status: "competing",
      boosts: [],
      noMutationExecuted: true,
    },
    completeness,
    freshness: {
      source: "mercadolibre-api",
      signalKind: "pricing",
      risk: "medium",
      capturedAt,
      maxAgeMs: 6 * 60 * 60 * 1000,
      status: freshnessStatus,
    },
    confidence,
    evidence: {
      evidenceId: `orm:pricing:${sellerId}:${itemId}:${capturedAt.toISOString()}`,
      snapshotKind: "pricing",
      sellerId,
      entityId: itemId,
      capturedAt,
      freshnessStatus,
      completeness,
      source: "operational-read-model",
    },
  };
}

describe("migrateOperationalStore", () => {
  it("creates operational_snapshots and ingestion_checkpoints tables", () => {
    const db = new Database(":memory:");
    migrateOperationalStore(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("operational_snapshots");
    expect(names).toContain("ingestion_checkpoints");

    db.close();
  });

  it("is idempotent — re-running does not fail", () => {
    const db = new Database(":memory:");
    migrateOperationalStore(db);
    migrateOperationalStore(db); // second run — must not throw

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("operational_snapshots");
    expect(names).toContain("ingestion_checkpoints");

    db.close();
  });

  it("creates the idx_snapshots_kind index", () => {
    const db = new Database(":memory:");
    migrateOperationalStore(db);

    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'operational_snapshots'",
      )
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_snapshots_kind");

    db.close();
  });
});

describe("createSqliteOperationalReadModel", () => {
  let db: Database.Database;
  let store: OperationalReadModel;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createSqliteOperationalReadModel(db);
  });

  // ── 3.1 Upsert + read round-trip ──────────────────────────────────

  it("upserts a listing snapshot and reads it back via readSnapshot", async () => {
    const snap = makeListingSnapshot();
    await store.upsertSnapshot(snap);

    const result = await store.readSnapshot<MlcListingSummary>({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC123",
    });

    expect(result).not.toBeNull();
    expect(result!.sellerId).toBe("plasticov");
    expect(result!.kind).toBe("listing");
    expect(result!.completeness).toBe("complete");
    expect(result!.confidence).toBe("high");
    expect(result!.evidence.evidenceId).toBe(snap.evidence.evidenceId);
    expect(result!.evidence.snapshotKind).toBe("listing");
    expect(result!.evidence.entityId).toBe("MLC123");

    const data = result!.data as MlcListingSummary;
    expect(data.id).toBe("MLC123");
    expect(data.title).toBe("Test Product");
  });

  it("upserts a pricing snapshot and reads durable read-only evidence", async () => {
    const snap = makePricingSnapshot();
    await store.upsertSnapshot(snap);

    const result = await store.readSnapshot<MlcPriceToWinSummary & { noMutationExecuted: true }>({
      sellerId: "plasticov",
      snapshotKind: "pricing",
      entityId: "MLC123",
    });
    const evidence = await store.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "pricing",
      entityId: "MLC123",
    });

    expect(result).not.toBeNull();
    expect(result!.kind).toBe("pricing");
    expect(Array.isArray(result!.data)).toBe(false);
    const data = result!.data as MlcPriceToWinSummary & { noMutationExecuted: true };
    expect(data.noMutationExecuted).toBe(true);
    expect(data.priceToWin).toBe(950);
    expect(result!.evidence.evidenceId).toMatch(/^orm:pricing:plasticov:MLC123:/);
    expect(evidence).not.toBeNull();
    expect(evidence!.snapshotKind).toBe("pricing");
    expect(evidence!.evidenceId).toBe(snap.evidence.evidenceId);
  });

  it("upsert replaces an existing row for the same (seller_id, item_id, kind)", async () => {
    const first = makeListingSnapshot({ capturedAt: new Date("2026-07-01T10:00:00Z") });
    await store.upsertSnapshot(first);

    const second = makeListingSnapshot({ capturedAt: new Date("2026-07-01T12:00:00Z") });
    await store.upsertSnapshot(second);

    const result = await store.readSnapshot<MlcListingSummary>({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC123",
    });

    expect(result).not.toBeNull();
    expect(result!.evidence.capturedAt).toEqual(new Date("2026-07-01T12:00:00Z"));
    expect(result!.evidence.evidenceId).toBe(second.evidence.evidenceId);
  });

  // ── 3.2 Stale / partial / low-confidence → refresh-required ─────

  it("findEvidence with requiredFreshness='fresh' returns null for a stale snapshot", async () => {
    const snap = makeListingSnapshot({ freshnessStatus: "stale" });
    await store.upsertSnapshot(snap);

    const evidence = await store.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC123",
      requiredFreshness: "fresh",
    });

    expect(evidence).toBeNull();
  });

  it("findEvidence with requiredFreshness='allow-stale-with-warning' returns stale evidence", async () => {
    const snap = makeListingSnapshot({ freshnessStatus: "stale" });
    await store.upsertSnapshot(snap);

    const evidence = await store.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC123",
      requiredFreshness: "allow-stale-with-warning",
    });

    expect(evidence).not.toBeNull();
    expect(evidence!.freshnessStatus).toBe("stale");
  });

  it("readSnapshot returns null for a partial snapshot when freshness filter is 'fresh'", async () => {
    const snap = makeListingSnapshot({ completeness: "partial" });
    await store.upsertSnapshot(snap);

    const result = await store.readSnapshot<MlcListingSummary>({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC123",
      requiredFreshness: "fresh",
    });

    expect(result).toBeNull();
  });

  it("readSnapshot returns null for a low-confidence snapshot when freshness filter is 'fresh'", async () => {
    const snap = makeListingSnapshot({ confidence: "low" });
    await store.upsertSnapshot(snap);

    const result = await store.readSnapshot<MlcListingSummary>({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC123",
      requiredFreshness: "fresh",
    });

    expect(result).toBeNull();
  });

  it("decideReadSnapshotFreshness returns refresh-required for a stale snapshot", async () => {
    const snap = makeListingSnapshot({ freshnessStatus: "stale" });
    await store.upsertSnapshot(snap);

    const result = await store.readSnapshot<MlcListingSummary>({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC123",
    });

    expect(result).not.toBeNull();
    const decision = decideReadSnapshotFreshness(result!);
    expect(decision.status).toBe("refresh-required");
    expect(decision.reason).toBe("stale");
    expect(decision.refreshRequired).toBe(true);
  });

  it("decideReadSnapshotFreshness returns fresh-enough for a fresh/complete/high-confidence snapshot", async () => {
    const snap = makeListingSnapshot();
    await store.upsertSnapshot(snap);

    const result = await store.readSnapshot<MlcListingSummary>({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC123",
    });

    expect(result).not.toBeNull();
    const decision = decideReadSnapshotFreshness(result!);
    expect(decision.status).toBe("fresh-enough");
    expect(decision.reason).toBe("fresh-complete-confidence");
    expect(decision.refreshRequired).toBe(false);
  });

  // ── 3.3 Lane isolation ──────────────────────────────────────────

  it("Plasticov reads do not return Maustian data", async () => {
    await store.upsertSnapshot(makeListingSnapshot({ sellerId: "plasticov", itemId: "MLC111" }));
    await store.upsertSnapshot(makeListingSnapshot({ sellerId: "maustian", itemId: "MLC222" }));

    const plasticovEvidence = await store.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "listing",
    });

    expect(plasticovEvidence).not.toBeNull();
    expect(plasticovEvidence!.sellerId).toBe("plasticov");
    expect(plasticovEvidence!.entityId).toBe("MLC111");
  });

  it("Maustian reads do not return Plasticov data", async () => {
    await store.upsertSnapshot(makeListingSnapshot({ sellerId: "plasticov", itemId: "MLC111" }));
    await store.upsertSnapshot(makeListingSnapshot({ sellerId: "maustian", itemId: "MLC222" }));

    const maustianEvidence = await store.findEvidence({
      sellerId: "maustian",
      snapshotKind: "listing",
    });

    expect(maustianEvidence).not.toBeNull();
    expect(maustianEvidence!.sellerId).toBe("maustian");
    expect(maustianEvidence!.entityId).toBe("MLC222");
  });

  it("CEO lane can query across sellers", async () => {
    await store.upsertSnapshot(makeListingSnapshot({ sellerId: "plasticov", itemId: "MLC111" }));
    await store.upsertSnapshot(makeListingSnapshot({ sellerId: "maustian", itemId: "MLC222" }));

    const pEvidence = await store.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "listing",
    });
    const mEvidence = await store.findEvidence({
      sellerId: "maustian",
      snapshotKind: "listing",
    });

    expect(pEvidence).not.toBeNull();
    expect(mEvidence).not.toBeNull();
    expect(pEvidence!.sellerId).toBe("plasticov");
    expect(mEvidence!.sellerId).toBe("maustian");
  });

  // ── 3.4 Checkpoint resume ───────────────────────────────────────

  it("upsertCheckpoint stores and getCheckpoint retrieves the last_captured_at", async () => {
    await store.upsertCheckpoint("plasticov", "listing", "2026-07-01T12:00:00Z");

    const cp = await store.getCheckpoint("plasticov", "listing");
    expect(cp).not.toBeNull();
    expect(cp!.seller_id).toBe("plasticov");
    expect(cp!.kind).toBe("listing");
    expect(cp!.last_captured_at).toBe("2026-07-01T12:00:00Z");
  });

  it("upsertCheckpoint replaces previous checkpoint for same seller+kind", async () => {
    await store.upsertCheckpoint("plasticov", "listing", "2026-07-01T10:00:00Z");
    await store.upsertCheckpoint("plasticov", "listing", "2026-07-01T15:00:00Z");

    const cp = await store.getCheckpoint("plasticov", "listing");
    expect(cp).not.toBeNull();
    expect(cp!.last_captured_at).toBe("2026-07-01T15:00:00Z");
  });

  it("getCheckpoint returns null for a seller+kind with no checkpoint", async () => {
    const cp = await store.getCheckpoint("unknown", "listing");
    expect(cp).toBeNull();
  });

  it("checkpoints are isolated per seller", async () => {
    await store.upsertCheckpoint("plasticov", "listing", "2026-07-01T10:00:00Z");
    await store.upsertCheckpoint("maustian", "listing", "2026-07-01T12:00:00Z");

    const pCp = await store.getCheckpoint("plasticov", "listing");
    const mCp = await store.getCheckpoint("maustian", "listing");

    expect(pCp!.last_captured_at).toBe("2026-07-01T10:00:00Z");
    expect(mCp!.last_captured_at).toBe("2026-07-01T12:00:00Z");
  });

  // ── 3.5 findEvidence edge cases ──────────────────────────────────

  it("findEvidence returns null for missing seller+kind", async () => {
    const evidence = await store.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "listing",
    });

    expect(evidence).toBeNull();
  });

  it("findEvidence returns evidence with deterministic evidence_id", async () => {
    const snap = makeListingSnapshot();
    await store.upsertSnapshot(snap);

    const evidence = await store.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC123",
    });

    expect(evidence).not.toBeNull();
    expect(evidence!.evidenceId).toBe(snap.evidence.evidenceId);
    expect(evidence!.evidenceId).toMatch(/^orm:listing:plasticov:MLC123:/);
  });

  it("findEvidence returns the most recent snapshot when multiple exist for same seller+kind (different items)", async () => {
    await store.upsertSnapshot(
      makeListingSnapshot({
        itemId: "MLC111",
        capturedAt: new Date("2026-07-01T10:00:00Z"),
      }),
    );
    await store.upsertSnapshot(
      makeListingSnapshot({
        itemId: "MLC222",
        capturedAt: new Date("2026-07-01T12:00:00Z"),
      }),
    );

    const evidence = await store.findEvidence({
      sellerId: "plasticov",
      snapshotKind: "listing",
    });

    // Without entityId, findEvidence returns the most recent across all items
    expect(evidence).not.toBeNull();
    expect(evidence!.entityId).toBe("MLC222");
  });

  it("readSnapshot returns null for malformed JSON in data_json", async () => {
    // Bypass the store API to inject bad data
    const db2 = new Database(":memory:");
    const store2 = createSqliteOperationalReadModel(db2);

    // Write a snapshot normally, then corrupt data_json directly
    await store2.upsertSnapshot(makeListingSnapshot({ itemId: "MLC999" }));
    db2
      .prepare("UPDATE operational_snapshots SET data_json = ? WHERE item_id = ?")
      .run("{not valid", "MLC999");

    const result = await store2.readSnapshot({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC999",
    });
    expect(result).toBeNull();

    db2.close();
  });

  // ── Data preservation ────────────────────────────────────────────

  it("upsertSnapshot preserves listing data fields", async () => {
    const snap = makeListingSnapshot({
      itemId: "MLC555",
    });
    await store.upsertSnapshot(snap);

    const result = await store.readSnapshot<MlcListingSummary>({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC555",
    });

    expect(result).not.toBeNull();
    const data = result!.data as MlcListingSummary;
    expect(data.status).toBe("active");
    expect(data.price).toBe(1000);
    expect(data.currencyId).toBe("CLP");
  });
});
