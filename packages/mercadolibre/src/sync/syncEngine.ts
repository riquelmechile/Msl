import type { MlClient } from "../index.js";
import type { MlItem, MlWriteSnapshot } from "../types.js";
import { diffListings } from "./diffEngine.js";
import { applyStrategies, type Strategy } from "./strategyApplier.js";
import { createSyncStore, type SyncStore } from "./syncStore.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncResult = {
  itemId: string;
  status: "published" | "skipped" | "failed" | "unchanged";
  sourcePrice: number;
  targetPrice: number;
  margin: number;
  error?: string;
};

export type SyncReport = {
  total: number;
  published: number;
  skipped: number;
  failed: number;
  unchanged: number;
  results: SyncResult[];
  startedAt: string;
  completedAt: string;
};

export type SyncOptions = {
  /** Only process changed/unsynced items (default: true) */
  differential?: boolean;
  /** Limit total items to process */
  limit?: number;
};

// ---------------------------------------------------------------------------
// ProductSyncEngine interface
// ---------------------------------------------------------------------------

export type ProductSyncEngine = {
  syncProduct(
    sourceSellerId: string,
    targetSellerId: string,
    itemId: string,
    strategies: Strategy[],
  ): Promise<SyncResult>;

  syncAll(
    sourceSellerId: string,
    targetSellerId: string,
    strategies: Strategy[],
    options?: SyncOptions,
  ): Promise<SyncReport>;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProductSyncEngine(input: {
  source: MlClient;
  target: MlClient;
  store?: SyncStore;
}): ProductSyncEngine {
  const { source, target } = input;
  const store = input.store ?? createSyncStore();

  async function syncProduct(
    sourceSellerId: string,
    targetSellerId: string,
    itemId: string,
    strategies: Strategy[],
  ): Promise<SyncResult> {
    let sourceItem: MlItem;
    try {
      sourceItem = await source.getItem(sourceSellerId, itemId);
    } catch (err) {
      return {
        itemId,
        status: "failed",
        sourcePrice: 0,
        targetPrice: 0,
        margin: 0,
        error: `Failed to fetch source item: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const sourcePrice = sourceItem.price;

    // Check differential — skip if unchanged
    const existingState = store.getSyncState(
      itemId,
      sourceSellerId,
      targetSellerId,
    );
    if (existingState && existingState.syncStatus === "synced") {
      if (!store.isOutOfSync(itemId, sourceSellerId, targetSellerId, sourceItem)) {
        return {
          itemId,
          status: "unchanged",
          sourcePrice,
          targetPrice: sourcePrice,
          margin: 0,
        };
      }
    }

    // Apply strategies
    const applied = applyStrategies(sourceItem, strategies);
    if (!applied.applied) {
      return {
        itemId,
        status: "skipped",
        sourcePrice,
        targetPrice: 0,
        margin: 0,
      };
    }

    const newItem = applied.item;
    const targetPrice = newItem.price;

    // Publish to target
    let published: MlWriteSnapshot;
    try {
      published = await target.publishItem(targetSellerId, newItem);
    } catch (err) {
      store.markFailed(itemId, sourceSellerId, targetSellerId);
      return {
        itemId,
        status: "failed",
        sourcePrice,
        targetPrice,
        margin: 0,
        error: `Failed to publish: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Record sync state
    store.markSynced({
      sourceItemId: itemId,
      sourceSellerId,
      targetSellerId,
      targetItemId: published.id,
      sourceItem,
      publishedItem: published,
    });

    const margin = targetPrice > 0
      ? Math.round(((targetPrice - sourcePrice) / sourcePrice) * 100) / 100
      : 0;

    return {
      itemId,
      status: "published",
      sourcePrice,
      targetPrice,
      margin,
    };
  }

  async function syncAll(
    sourceSellerId: string,
    targetSellerId: string,
    strategies: Strategy[],
    options?: SyncOptions,
  ): Promise<SyncReport> {
    const useDifferential = options?.differential !== false;
    const limit = options?.limit;

    const startedAt = new Date().toISOString();

    // 1. Extract: get all source listings
    let sourceListings: MlItem[];

    try {
      const itemsSnapshot = await source.getItems(sourceSellerId);
      // Convert MlcListingSummary[] to MlItem[] — fetch each item individually
      const listingIds = Array.isArray(itemsSnapshot.data)
        ? (itemsSnapshot.data as Array<{ id: string }>).map((l) => l.id)
        : [];

      const items: MlItem[] = [];
      for (const lid of listingIds) {
        try {
          const item = await source.getItem(sourceSellerId, lid);
          items.push(item);
        } catch {
          // Skip items that fail to fetch individually
        }
      }
      sourceListings = items;
    } catch (err) {
      const completedAt = new Date().toISOString();
      return {
        total: 0,
        published: 0,
        skipped: 0,
        failed: 0,
        unchanged: 0,
        results: [],
        startedAt,
        completedAt,
      };
    }

    // 2. Diff: determine which items need processing
    let itemsToProcess: MlItem[];
    let unchangedCount = 0;

    if (useDifferential) {
      const syncedStates = store.listSynced(sourceSellerId, targetSellerId);
      const diff = diffListings(sourceListings, syncedStates);
      itemsToProcess = [...diff.new, ...diff.changed];
      unchangedCount = diff.unchanged.length;
    } else {
      itemsToProcess = sourceListings;
      unchangedCount = 0;
    }

    // 3. Apply limit
    if (limit !== undefined && itemsToProcess.length > limit) {
      itemsToProcess = itemsToProcess.slice(0, limit);
    }

    // 4. Process each item
    const results: SyncResult[] = [];
    let publishedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const item of itemsToProcess) {
      const result = await syncProduct(
        sourceSellerId,
        targetSellerId,
        item.id,
        strategies,
      );
      results.push(result);

      switch (result.status) {
        case "published":
          publishedCount++;
          break;
        case "skipped":
          skippedCount++;
          break;
        case "failed":
          failedCount++;
          break;
        case "unchanged":
          unchangedCount++;
          break;
      }
    }

    const completedAt = new Date().toISOString();

    return {
      total: sourceListings.length,
      published: publishedCount,
      skipped: skippedCount,
      failed: failedCount,
      unchanged: unchangedCount,
      results,
      startedAt,
      completedAt,
    };
  }

  return { syncProduct, syncAll };
}
