import type {
  BusinessSignalKind,
  CacheFreshness,
  OperationalEvidence,
  OperationalEvidenceCompleteness,
  ReadSnapshot,
  ReadSnapshotCompleteness,
  ReadSnapshotConfidence,
  ReadSnapshotKind,
  SellerId,
} from "@msl/domain";
import Database from "better-sqlite3";

// ── Row types ─────────────────────────────────────────────────────────

export type SnapshotRow = {
  seller_id: string;
  item_id: string;
  kind: string;
  data_json: string;
  source: string;
  captured_at: string;
  freshness: string;
  completeness: string;
  confidence: string;
  evidence_id: string;
};

export type CheckpointRow = {
  seller_id: string;
  kind: string;
  last_captured_at: string;
};

// ── Query / Snapshot types ────────────────────────────────────────────

export type OperationalEvidenceQuery = {
  sellerId: SellerId;
  snapshotKind: BusinessSignalKind;
  entityId?: string;
  requiredFreshness?: "fresh" | "allow-stale-with-warning";
};

export type OperationalReadModelSnapshot<TData> = ReadSnapshot<TData> & {
  evidence: OperationalEvidence;
};

// ── Reader / Writer interfaces ────────────────────────────────────────

export type OperationalReadModelReader = {
  findEvidence(query: OperationalEvidenceQuery): Promise<OperationalEvidence | null>;
  readSnapshot<TData>(
    query: OperationalEvidenceQuery,
  ): Promise<OperationalReadModelSnapshot<TData> | null>;
  listSnapshots<TData>(
    sellerId: string,
    kind: string,
    options?: { limit?: number; status?: string; categoryId?: string },
  ): Promise<Array<{ itemId: string; data: TData; capturedAt: string; freshness: string }>>;
};

export type OperationalReadModelWriter = {
  upsertSnapshot<TData>(snapshot: OperationalReadModelSnapshot<TData>): Promise<void>;
  upsertCheckpoint(sellerId: string, kind: string, lastCapturedAt: string): Promise<void>;
  getCheckpoint(sellerId: string, kind: string): Promise<CheckpointRow | null>;
};

export type OperationalReadModel = OperationalReadModelReader & OperationalReadModelWriter;

// ── Helpers ───────────────────────────────────────────────────────────

function cacheFreshnessFromRow(
  source: string,
  kind: string,
  capturedAt: string,
  freshness: string,
): CacheFreshness {
  // businessRiskForSignal and maxAgeForBusinessRisk are imported from @msl/domain,
  // but to keep this module self-contained we compute them inline.
  const criticalKinds = new Set([
    "order",
    "claim",
    "cancellation",
    "stock",
    "reputation",
    "message",
  ]);
  const risk = criticalKinds.has(kind)
    ? "critical"
    : kind === "historical-summary"
      ? "low"
      : "medium";
  const maxAgeMs =
    risk === "critical" ? 5 * 60 * 1000 : risk === "medium" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

  return {
    source: source as CacheFreshness["source"],
    signalKind: kind as BusinessSignalKind,
    risk,
    capturedAt: new Date(capturedAt),
    maxAgeMs,
    status: freshness as "fresh" | "stale",
  };
}

function operationalEvidenceFromRow(row: SnapshotRow): OperationalEvidence {
  return {
    evidenceId: row.evidence_id,
    snapshotKind: row.kind as BusinessSignalKind,
    sellerId: row.seller_id,
    entityId: row.item_id,
    capturedAt: new Date(row.captured_at),
    freshnessStatus: row.freshness as "fresh" | "stale",
    completeness: row.completeness as OperationalEvidenceCompleteness,
    source: "operational-read-model",
  };
}

// ── Migration ─────────────────────────────────────────────────────────

export function migrateOperationalStore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS operational_snapshots (
      seller_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      data_json TEXT NOT NULL,
      source TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      freshness TEXT NOT NULL,
      completeness TEXT NOT NULL,
      confidence TEXT NOT NULL,
      evidence_id TEXT NOT NULL UNIQUE,
      PRIMARY KEY (seller_id, item_id, kind)
    );

    CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
      seller_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      last_captured_at TEXT NOT NULL,
      PRIMARY KEY (seller_id, kind)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_kind ON operational_snapshots(kind);
  `);
}

// ── Factory ───────────────────────────────────────────────────────────

export function createSqliteOperationalReadModel(db: Database.Database): OperationalReadModel {
  migrateOperationalStore(db);

  const upsertSnapshotStmt = db.prepare(`
    INSERT OR REPLACE INTO operational_snapshots
      (seller_id, item_id, kind, data_json, source, captured_at,
       freshness, completeness, confidence, evidence_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const findEvidenceStmt = db.prepare(`
    SELECT * FROM operational_snapshots
    WHERE seller_id = ? AND kind = ?
    ORDER BY captured_at DESC
    LIMIT 1
  `);

  const findEvidenceByEntityStmt = db.prepare(`
    SELECT * FROM operational_snapshots
    WHERE seller_id = ? AND kind = ? AND item_id = ?
    ORDER BY captured_at DESC
    LIMIT 1
  `);

  const upsertCheckpointStmt = db.prepare(`
    INSERT OR REPLACE INTO ingestion_checkpoints
      (seller_id, kind, last_captured_at)
    VALUES (?, ?, ?)
  `);

  const getCheckpointStmt = db.prepare(`
    SELECT * FROM ingestion_checkpoints
    WHERE seller_id = ? AND kind = ?
  `);

  const listSnapshotsStmt = db.prepare(`
    SELECT * FROM operational_snapshots
    WHERE seller_id = ? AND kind = ?
    ORDER BY captured_at DESC
    LIMIT ?
  `);

  function matchesFreshnessFilter(
    row: SnapshotRow,
    filter: "fresh" | "allow-stale-with-warning" | undefined,
  ): boolean {
    if (!filter) return true;
    if (filter === "allow-stale-with-warning") return true;
    // "fresh" filter
    return row.freshness === "fresh" && row.completeness === "complete" && row.confidence !== "low";
  }

  /* eslint-disable @typescript-eslint/require-await */
  return {
    async findEvidence(query: OperationalEvidenceQuery): Promise<OperationalEvidence | null> {
      const row =
        query.entityId !== undefined
          ? (findEvidenceByEntityStmt.get(query.sellerId, query.snapshotKind, query.entityId) as
              | SnapshotRow
              | undefined)
          : (findEvidenceStmt.get(query.sellerId, query.snapshotKind) as SnapshotRow | undefined);

      if (!row) return null;

      if (!matchesFreshnessFilter(row, query.requiredFreshness)) {
        return null;
      }

      return operationalEvidenceFromRow(row);
    },

    async readSnapshot<TData>(
      query: OperationalEvidenceQuery,
    ): Promise<OperationalReadModelSnapshot<TData> | null> {
      const row =
        query.entityId !== undefined
          ? (findEvidenceByEntityStmt.get(query.sellerId, query.snapshotKind, query.entityId) as
              | SnapshotRow
              | undefined)
          : (findEvidenceStmt.get(query.sellerId, query.snapshotKind) as SnapshotRow | undefined);

      if (!row) return null;

      if (!matchesFreshnessFilter(row, query.requiredFreshness)) {
        return null;
      }

      let data: ReadonlyArray<TData> | TData;
      try {
        data = JSON.parse(row.data_json) as ReadonlyArray<TData> | TData;
      } catch {
        return null;
      }

      const freshness = cacheFreshnessFromRow(row.source, row.kind, row.captured_at, row.freshness);

      return {
        sellerId: row.seller_id,
        kind: row.kind as ReadSnapshotKind,
        source: row.source as ReadSnapshot<unknown>["source"],
        data,
        completeness: row.completeness as ReadSnapshotCompleteness,
        freshness,
        confidence: row.confidence as ReadSnapshotConfidence,
        evidence: operationalEvidenceFromRow(row),
      };
    },

    async listSnapshots<TData>(
      sellerId: string,
      kind: string,
      options?: { limit?: number; status?: string; categoryId?: string },
    ): Promise<Array<{ itemId: string; data: TData; capturedAt: string; freshness: string }>> {
      const limit = options?.limit ?? 200;
      const rows = listSnapshotsStmt.all(sellerId, kind, limit) as SnapshotRow[];

      return rows
        .map((row) => {
          let data: TData;
          try {
            data = JSON.parse(row.data_json) as TData;
          } catch {
            return null;
          }

          // Client-side filtering
          if (options?.status && (data as Record<string, unknown>)?.status !== options.status)
            return null;
          if (
            options?.categoryId &&
            (data as Record<string, unknown>)?.category_id !== options.categoryId
          )
            return null;

          return {
            itemId: row.item_id,
            data,
            capturedAt: row.captured_at,
            freshness: row.freshness,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
    },

    async upsertSnapshot<TData>(snapshot: OperationalReadModelSnapshot<TData>): Promise<void> {
      upsertSnapshotStmt.run(
        snapshot.sellerId,
        snapshot.evidence.entityId ?? "",
        snapshot.kind,
        JSON.stringify(snapshot.data),
        snapshot.source,
        snapshot.evidence.capturedAt.toISOString(),
        snapshot.freshness.status,
        snapshot.evidence.completeness,
        snapshot.confidence,
        snapshot.evidence.evidenceId,
      );
    },

    async upsertCheckpoint(sellerId: string, kind: string, lastCapturedAt: string): Promise<void> {
      upsertCheckpointStmt.run(sellerId, kind, lastCapturedAt);
    },

    async getCheckpoint(sellerId: string, kind: string): Promise<CheckpointRow | null> {
      const row = getCheckpointStmt.get(sellerId, kind) as CheckpointRow | undefined;
      return row ?? null;
    },
  };
  /* eslint-enable @typescript-eslint/require-await */
}
