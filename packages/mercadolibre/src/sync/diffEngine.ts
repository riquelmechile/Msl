import type { MlItem } from "../types.js";
import type { SyncState } from "./syncStore.js";

// ---------------------------------------------------------------------------
// Diff result types
// ---------------------------------------------------------------------------

export type DiffResult = {
  changed: MlItem[];
  unchanged: MlItem[];
  new: MlItem[];
  /** Items present in sync state but no longer in source listings */
  removed: string[];
};

// ---------------------------------------------------------------------------
// Diff engine
// ---------------------------------------------------------------------------

/**
 * Compare current source listings against prior sync state to produce a
 * differential result set.
 *
 * - **changed**: items whose price, available_quantity, title, or status
 *   differ from the stored snapshot
 * - **unchanged**: items that match their stored snapshot exactly
 * - **new**: items present in source but never synced before
 * - **removed**: item IDs in sync state that no longer appear in source
 */
export function diffListings(items: MlItem[], syncStates: SyncState[]): DiffResult {
  const stateMap = new Map<string, SyncState>();
  for (const state of syncStates) {
    stateMap.set(state.sourceItemId, state);
  }

  const itemIds = new Set(items.map((i) => i.id));

  const changed: MlItem[] = [];
  const unchanged: MlItem[] = [];
  const newItems: MlItem[] = [];

  for (const item of items) {
    const state = stateMap.get(item.id);

    if (!state) {
      newItems.push(item);
      continue;
    }

    if (isOutOfSync(item, state)) {
      changed.push(item);
    } else {
      unchanged.push(item);
    }
  }

  // Items in sync state that no longer appear in source
  const removed: string[] = [];
  for (const state of syncStates) {
    if (!itemIds.has(state.sourceItemId)) {
      removed.push(state.sourceItemId);
    }
  }

  return { changed, unchanged, new: newItems, removed };
}

/**
 * Check whether a single MlItem differs from its stored sync snapshot.
 */
export function isOutOfSync(item: MlItem, state: SyncState): boolean {
  // If never synced, it's out of sync
  if (state.syncStatus === "pending" || state.syncStatus === "failed") {
    return true;
  }

  // No stored snapshot → out of sync
  if (!state.sourceData) {
    return true;
  }

  let stored: Partial<MlItem>;
  try {
    stored = JSON.parse(state.sourceData) as Partial<MlItem>;
  } catch {
    return true;
  }

  return (
    stored.price !== item.price ||
    stored.available_quantity !== item.available_quantity ||
    stored.title !== item.title ||
    stored.status !== item.status
  );
}
