import Database from "better-sqlite3";
import type { MlItem, NewItem, MlWriteSnapshot } from "../types.js";
import { isOutOfSync as diffOutOfSync } from "./diffEngine.js";

// ---------------------------------------------------------------------------
// Table schema
// ---------------------------------------------------------------------------

const SYNC_STATE_TABLE = `
CREATE TABLE IF NOT EXISTS product_sync_state (
  source_item_id TEXT NOT NULL,
  source_seller_id TEXT NOT NULL,
  target_item_id TEXT,
  target_seller_id TEXT NOT NULL,
  last_synced_at TEXT,
  sync_status TEXT DEFAULT 'pending',
  source_data TEXT,
  target_data TEXT,
  PRIMARY KEY (source_item_id, source_seller_id, target_seller_id)
);
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncStatus = "pending" | "synced" | "failed" | "outdated";

export type SyncState = {
  sourceItemId: string;
  sourceSellerId: string;
  targetItemId: string | null;
  targetSellerId: string;
  lastSyncedAt: string | null;
  syncStatus: SyncStatus;
  sourceData: string | null;
  targetData: string | null;
};

export type MarkSyncedInput = {
  sourceItemId: string;
  sourceSellerId: string;
  targetSellerId: string;
  targetItemId: string;
  sourceItem: MlItem;
  publishedItem: MlWriteSnapshot;
};

export type SyncEntry = SyncState;

// ---------------------------------------------------------------------------
// SyncStore interface
// ---------------------------------------------------------------------------

export type SyncStore = {
  markSynced(input: MarkSyncedInput): void;
  markFailed(
    sourceItemId: string,
    sourceSellerId: string,
    targetSellerId: string,
  ): void;
  getSyncState(
    sourceItemId: string,
    sourceSellerId: string,
    targetSellerId: string,
  ): SyncState | undefined;
  isOutOfSync(
    sourceItemId: string,
    sourceSellerId: string,
    targetSellerId: string,
    currentItem: MlItem,
  ): boolean;
  listSynced(
    sourceSellerId: string,
    targetSellerId: string,
  ): SyncState[];
  close(): void;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function rowToSyncState(
  row: Record<string, unknown> | undefined,
): SyncState | undefined {
  if (!row) return undefined;

  const status = (row.sync_status as string) ?? "pending";
  const validStatuses: SyncStatus[] = [
    "pending",
    "synced",
    "failed",
    "outdated",
  ];

  return {
    sourceItemId: row.source_item_id as string,
    sourceSellerId: row.source_seller_id as string,
    targetItemId: (row.target_item_id as string) ?? null,
    targetSellerId: row.target_seller_id as string,
    lastSyncedAt: (row.last_synced_at as string) ?? null,
    syncStatus: validStatuses.includes(status as SyncStatus)
      ? (status as SyncStatus)
      : "pending",
    sourceData: (row.source_data as string) ?? null,
    targetData: (row.target_data as string) ?? null,
  };
}

export function createSyncStore(dbPath = ":memory:"): SyncStore {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SYNC_STATE_TABLE);

  const upsertStmt = db.prepare(`
    INSERT OR REPLACE INTO product_sync_state
      (source_item_id, source_seller_id, target_item_id, target_seller_id, last_synced_at, sync_status, source_data, target_data)
    VALUES
      (@source_item_id, @source_seller_id, @target_item_id, @target_seller_id, @last_synced_at, @sync_status, @source_data, @target_data)
  `);

  const selectStmt = db.prepare(
    `SELECT * FROM product_sync_state
     WHERE source_item_id = ? AND source_seller_id = ? AND target_seller_id = ?`,
  );

  const listStmt = db.prepare(
    `SELECT * FROM product_sync_state
     WHERE source_seller_id = ? AND target_seller_id = ?
     ORDER BY last_synced_at DESC`,
  );

  return {
    markSynced(input: MarkSyncedInput): void {
      const sourceData = JSON.stringify(input.sourceItem);
      const targetData = JSON.stringify(input.publishedItem);

      upsertStmt.run({
        source_item_id: input.sourceItemId,
        source_seller_id: input.sourceSellerId,
        target_item_id: input.targetItemId,
        target_seller_id: input.targetSellerId,
        last_synced_at: new Date().toISOString(),
        sync_status: "synced",
        source_data: sourceData,
        target_data: targetData,
      });
    },

    markFailed(
      sourceItemId: string,
      sourceSellerId: string,
      targetSellerId: string,
    ): void {
      upsertStmt.run({
        source_item_id: sourceItemId,
        source_seller_id: sourceSellerId,
        target_item_id: null,
        target_seller_id: targetSellerId,
        last_synced_at: new Date().toISOString(),
        sync_status: "failed",
        source_data: null,
        target_data: null,
      });
    },

    getSyncState(
      sourceItemId: string,
      sourceSellerId: string,
      targetSellerId: string,
    ): SyncState | undefined {
      const row = selectStmt.get(
        sourceItemId,
        sourceSellerId,
        targetSellerId,
      ) as Record<string, unknown> | undefined;
      return rowToSyncState(row);
    },

    isOutOfSync(
      sourceItemId: string,
      sourceSellerId: string,
      targetSellerId: string,
      currentItem: MlItem,
    ): boolean {
      const state = this.getSyncState(
        sourceItemId,
        sourceSellerId,
        targetSellerId,
      );

      if (!state) return true;

      return diffOutOfSync(currentItem, state);
    },

    listSynced(
      sourceSellerId: string,
      targetSellerId: string,
    ): SyncState[] {
      const rows = listStmt.all(
        sourceSellerId,
        targetSellerId,
      ) as Record<string, unknown>[];
      return rows.map((r) => rowToSyncState(r)!).filter(Boolean);
    },

    close(): void {
      db.close();
    },
  };
}
