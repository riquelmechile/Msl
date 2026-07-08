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

  it("creates the idx_snapshots_kind_captured composite index", () => {
    const db = new Database(":memory:");
    migrateOperationalStore(db);

    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'operational_snapshots'",
      )
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_snapshots_kind_captured");

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

  it("generated columns reject malformed JSON in data_json", async () => {
    // With generated columns that depend on valid JSON, neither INSERT
    // nor UPDATE can store malformed JSON in data_json.
    const db2 = new Database(":memory:");
    const store2 = createSqliteOperationalReadModel(db2);

    // Write a snapshot normally.
    await store2.upsertSnapshot(makeListingSnapshot({ itemId: "MLC999" }));

    // Attempting to corrupt data_json with invalid JSON should throw.
    expect(() => {
      db2
        .prepare("UPDATE operational_snapshots SET data_json = ? WHERE item_id = ?")
        .run("{not valid", "MLC999");
    }).toThrow();

    // The original row is unaffected.
    const result = await store2.readSnapshot({
      sellerId: "plasticov",
      snapshotKind: "listing",
      entityId: "MLC999",
    });
    expect(result).not.toBeNull();

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

// ── searchSnapshots integration tests ──────────────────────────

/**
 * Helper: directly INSERT a row with specific data_json so we can
 * test json_extract filters (status, categoryId, price, etc.).
 */
function seedSnapshot(
  db: Database.Database,
  overrides: {
    sellerId?: string;
    itemId?: string;
    kind?: string;
    capturedAt?: string;
    freshness?: string;
    completeness?: string;
    confidence?: string;
    evidenceId?: string;
    dataJson?: Record<string, unknown>;
  } = {},
): void {
  const sellerId = overrides.sellerId ?? "plasticov";
  const itemId = overrides.itemId ?? "MLC-TEST";
  const kind = overrides.kind ?? "listing";
  const capturedAt = overrides.capturedAt ?? "2026-07-01T12:00:00Z";
  const freshness = overrides.freshness ?? "fresh";
  const completeness = overrides.completeness ?? "complete";
  const confidence = overrides.confidence ?? "high";
  const evidenceId =
    overrides.evidenceId ?? `orm:${kind}:${sellerId}:${itemId}:${capturedAt}`;
  const dataJson = overrides.dataJson ?? { status: "active", price: 1000 };

  db.prepare(
    `INSERT OR REPLACE INTO operational_snapshots
       (seller_id, item_id, kind, data_json, source, captured_at,
        freshness, completeness, confidence, evidence_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sellerId,
    itemId,
    kind,
    JSON.stringify(dataJson),
    "mercadolibre-api",
    capturedAt,
    freshness,
    completeness,
    confidence,
    evidenceId,
  );
}

describe("searchSnapshots", () => {
  let db: Database.Database;
  let store: OperationalReadModel;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createSqliteOperationalReadModel(db);
  });

  it("returns results filtered by sellerId", async () => {
    seedSnapshot(db, { sellerId: "plasticov", itemId: "A" });
    seedSnapshot(db, { sellerId: "maustian", itemId: "B" });

    const results = await store.searchSnapshots({ sellerId: "plasticov", kind: "listing" });
    expect(results).toHaveLength(1);
    expect(results[0]!.itemId).toBe("A");
  });

  it("filters by single kind string", async () => {
    seedSnapshot(db, { kind: "listing", itemId: "L1" });
    seedSnapshot(db, { kind: "order", itemId: "O1" });

    const results = await store.searchSnapshots({ sellerId: "plasticov", kind: "listing" });
    expect(results).toHaveLength(1);
    expect(results[0]!.itemId).toBe("L1");
  });

  it("filters by multiple kinds via array", async () => {
    seedSnapshot(db, { kind: "listing", itemId: "L1" });
    seedSnapshot(db, { kind: "order", itemId: "O1" });
    seedSnapshot(db, { kind: "claim", itemId: "C1" });

    const results = await store.searchSnapshots({
      sellerId: "plasticov",
      kind: ["listing", "order"],
    });
    expect(results).toHaveLength(2);
    const itemIds = results.map((r) => r.itemId).sort();
    expect(itemIds).toEqual(["L1", "O1"]);
  });

  it("filters by status via json_extract", async () => {
    seedSnapshot(db, { itemId: "A", dataJson: { status: "active", price: 100 } });
    seedSnapshot(db, { itemId: "B", dataJson: { status: "paused", price: 200 } });
    seedSnapshot(db, { itemId: "C", dataJson: { status: "active", price: 300 } });

    const results = await store.searchSnapshots({
      sellerId: "plasticov",
      kind: "listing",
      status: "active",
    });
    expect(results).toHaveLength(2);
    const itemIds = results.map((r) => r.itemId).sort();
    expect(itemIds).toEqual(["A", "C"]);
  });

  it("filters by categoryId via json_extract", async () => {
    seedSnapshot(db, { itemId: "A", dataJson: { category_id: "MLC1234", status: "active" } });
    seedSnapshot(db, { itemId: "B", dataJson: { category_id: "MLC5678", status: "active" } });

    const results = await store.searchSnapshots({
      sellerId: "plasticov",
      kind: "listing",
      categoryId: "MLC1234",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.itemId).toBe("A");
  });

  it("filters by price range (priceMin and priceMax)", async () => {
    seedSnapshot(db, { itemId: "A", dataJson: { price: 500, status: "active" } });
    seedSnapshot(db, { itemId: "B", dataJson: { price: 1500, status: "active" } });
    seedSnapshot(db, { itemId: "C", dataJson: { price: 3000, status: "active" } });

    const results = await store.searchSnapshots({
      sellerId: "plasticov",
      kind: "listing",
      priceMin: 1000,
      priceMax: 2500,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.itemId).toBe("B");
  });

  it("filters by capturedAfter date range", async () => {
    seedSnapshot(db, { itemId: "OLD", capturedAt: "2026-06-01T00:00:00Z" });
    seedSnapshot(db, { itemId: "NEW", capturedAt: "2026-07-05T00:00:00Z" });

    const results = await store.searchSnapshots({
      sellerId: "plasticov",
      kind: "listing",
      capturedAfter: "2026-07-01T00:00:00Z",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.itemId).toBe("NEW");
  });

  it("filters by capturedBefore date range", async () => {
    seedSnapshot(db, { itemId: "OLD", capturedAt: "2026-06-01T00:00:00Z" });
    seedSnapshot(db, { itemId: "NEW", capturedAt: "2026-07-05T00:00:00Z" });

    const results = await store.searchSnapshots({
      sellerId: "plasticov",
      kind: "listing",
      capturedBefore: "2026-07-01T00:00:00Z",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.itemId).toBe("OLD");
  });

  it("filters by itemId", async () => {
    seedSnapshot(db, { itemId: "MLC-100" });
    seedSnapshot(db, { itemId: "MLC-200" });

    const results = await store.searchSnapshots({
      sellerId: "plasticov",
      kind: "listing",
      itemId: "MLC-100",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.itemId).toBe("MLC-100");
  });

  it("applies freshness='fresh' post-query filter", async () => {
    seedSnapshot(db, { itemId: "GOOD", freshness: "fresh", completeness: "complete", confidence: "high" });
    seedSnapshot(db, { itemId: "STALE", freshness: "stale", completeness: "complete", confidence: "high" });
    seedSnapshot(db, { itemId: "PARTIAL", freshness: "fresh", completeness: "partial", confidence: "high" });
    seedSnapshot(db, { itemId: "LOWCONF", freshness: "fresh", completeness: "complete", confidence: "low" });

    const results = await store.searchSnapshots({
      sellerId: "plasticov",
      kind: "listing",
      freshness: "fresh",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.itemId).toBe("GOOD");
  });

  it("applies freshness='allow-stale-with-warning' — includes all", async () => {
    seedSnapshot(db, { itemId: "GOOD", freshness: "fresh", completeness: "complete", confidence: "high" });
    seedSnapshot(db, { itemId: "STALE", freshness: "stale", completeness: "complete", confidence: "high" });

    const results = await store.searchSnapshots({
      sellerId: "plasticov",
      kind: "listing",
      freshness: "allow-stale-with-warning",
    });
    expect(results).toHaveLength(2);
  });

  it("composes multiple filters (AND semantics)", async () => {
    seedSnapshot(db, { itemId: "A", kind: "listing", capturedAt: "2026-07-05T00:00:00Z", dataJson: { status: "active", price: 2000 } });
    seedSnapshot(db, { itemId: "B", kind: "listing", capturedAt: "2026-07-01T00:00:00Z", dataJson: { status: "active", price: 2000 } });
    seedSnapshot(db, { itemId: "C", kind: "listing", capturedAt: "2026-07-05T00:00:00Z", dataJson: { status: "paused", price: 2000 } });
    seedSnapshot(db, { itemId: "D", kind: "listing", capturedAt: "2026-07-05T00:00:00Z", dataJson: { status: "active", price: 500 } });

    const results = await store.searchSnapshots({
      sellerId: "plasticov",
      kind: "listing",
      status: "active",
      priceMin: 1000,
      capturedAfter: "2026-07-03T00:00:00Z",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.itemId).toBe("A");
  });

  it("defaults limit to 100", async () => {
    for (let i = 1; i <= 150; i++) {
      seedSnapshot(db, { itemId: `ITEM-${i}`, capturedAt: `2026-07-${String(i).padStart(2, "0")}T00:00:00Z` });
    }

    const results = await store.searchSnapshots({ sellerId: "plasticov", kind: "listing" });
    expect(results).toHaveLength(100);
  });

  it("respects explicit limit", async () => {
    for (let i = 1; i <= 50; i++) {
      seedSnapshot(db, { itemId: `ITEM-${i}`, capturedAt: `2026-07-${String(i).padStart(2, "0")}T00:00:00Z` });
    }

    const results = await store.searchSnapshots({
      sellerId: "plasticov",
      kind: "listing",
      limit: 10,
    });
    expect(results).toHaveLength(10);
  });

  it("returns empty array when no snapshots match", async () => {
    seedSnapshot(db, { itemId: "A", kind: "listing" });

    const results = await store.searchSnapshots({
      sellerId: "plasticov",
      kind: "order", // different kind
    });
    expect(results).toEqual([]);
  });

  it("orders results by captured_at DESC", async () => {
    seedSnapshot(db, { itemId: "MIDDLE", capturedAt: "2026-07-02T00:00:00Z" });
    seedSnapshot(db, { itemId: "OLDEST", capturedAt: "2026-07-01T00:00:00Z" });
    seedSnapshot(db, { itemId: "NEWEST", capturedAt: "2026-07-03T00:00:00Z" });

    const results = await store.searchSnapshots({ sellerId: "plasticov", kind: "listing" });
    expect(results).toHaveLength(3);
    expect(results[0]!.itemId).toBe("NEWEST");
    expect(results[1]!.itemId).toBe("MIDDLE");
    expect(results[2]!.itemId).toBe("OLDEST");
  });

  it("includes evidenceId in results", async () => {
    seedSnapshot(db, { itemId: "A", evidenceId: "ev-abc-123" });

    const results = await store.searchSnapshots({ sellerId: "plasticov", kind: "listing" });
    expect(results).toHaveLength(1);
    expect(results[0]!.evidenceId).toBe("ev-abc-123");
  });

  it("returns full data payload", async () => {
    seedSnapshot(db, { itemId: "A", dataJson: { status: "active", price: 999, title: "Widget" } });

    const results = await store.searchSnapshots<{ status: string; price: number; title: string }>({
      sellerId: "plasticov",
      kind: "listing",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.data.status).toBe("active");
    expect(results[0]!.data.price).toBe(999);
    expect(results[0]!.data.title).toBe("Widget");
  });

  it("rejects malformed JSON at insert time due to generated columns", async () => {
    seedSnapshot(db, { itemId: "GOOD", dataJson: { status: "active" } });

    // With generated columns (data_status, etc.) that depend on valid JSON,
    // inserting malformed JSON now fails at INSERT time instead of at query time.
    expect(() => {
      db.prepare(
        `INSERT INTO operational_snapshots
           (seller_id, item_id, kind, data_json, source, captured_at,
            freshness, completeness, confidence, evidence_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "plasticov",
        "BAD",
        "listing",
        "{not-valid-json",
        "mercadolibre-api",
        "2026-07-01T12:00:00Z",
        "fresh",
        "complete",
        "high",
        "ev-bad",
      );
    }).toThrow();

    // The valid row is still queryable.
    const results = await store.searchSnapshots({ sellerId: "plasticov", kind: "listing" });
    expect(results).toHaveLength(1);
    expect(results[0]!.itemId).toBe("GOOD");
  });

  it("filters seller correctly when no status filter is provided", async () => {
    seedSnapshot(db, { sellerId: "seller-a", itemId: "A1" });
    seedSnapshot(db, { sellerId: "seller-b", itemId: "B1" });
    seedSnapshot(db, { sellerId: "seller-a", itemId: "A2" });

    const results = await store.searchSnapshots({ sellerId: "seller-a", kind: "listing" });
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.itemId).sort();
    expect(ids).toEqual(["A1", "A2"]);
  });
});
