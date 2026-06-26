import { randomUUID } from "node:crypto";
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

export type ConcurrentSyncOptions = SyncOptions & {
  /** Max concurrent syncProduct calls (default: 5) */
  concurrency?: number;
};

export type SyncJob = {
  jobId: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  progress?: { done: number; total: number };
  error?: string;
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

  syncAllConcurrent(
    sourceSellerId: string,
    targetSellerId: string,
    strategies: Strategy[],
    options?: ConcurrentSyncOptions,
  ): Promise<SyncReport>;

  syncAllBackground(
    sourceSellerId: string,
    targetSellerId: string,
    strategies: Strategy[],
    options?: ConcurrentSyncOptions,
  ): { jobId: string; getStatus: () => SyncJob };
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
    } catch {
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

  function buildReport(
    results: SyncResult[],
    total: number,
    unchangedCount: number,
    startedAt: string,
  ): SyncReport {
    let publishedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const r of results) {
      switch (r.status) {
        case "published":
          publishedCount++;
          break;
        case "skipped":
          skippedCount++;
          break;
        case "failed":
          failedCount++;
          break;
      }
    }

    return {
      total,
      published: publishedCount,
      skipped: skippedCount,
      failed: failedCount,
      unchanged: unchangedCount + results.filter((r) => r.status === "unchanged").length,
      results,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  async function syncAllConcurrent(
    sourceSellerId: string,
    targetSellerId: string,
    strategies: Strategy[],
    options?: ConcurrentSyncOptions,
  ): Promise<SyncReport> {
    const concurrency = options?.concurrency ?? 5;
    const limit = options?.limit;
    const startedAt = new Date().toISOString();

    // Resolve item IDs — either from a snapshot or individually fetched
    const itemsSnapshot = await source.getItems(sourceSellerId);
    const listingIds = Array.isArray(itemsSnapshot.data)
      ? (itemsSnapshot.data as Array<{ id: string }>).map((l) => l.id)
      : [];

    if (listingIds.length === 0) {
      return { total: 0, published: 0, skipped: 0, failed: 0, unchanged: 0, results: [], startedAt, completedAt: new Date().toISOString() };
    }

    const total = listingIds.length;
    const idsToProcess = limit !== undefined && listingIds.length > limit
      ? listingIds.slice(0, limit)
      : listingIds;

    const results: SyncResult[] = [];

    // Process in chunks
    for (let i = 0; i < idsToProcess.length; i += concurrency) {
      const chunk = idsToProcess.slice(i, i + concurrency);
      const chunkResults = await Promise.allSettled(
        chunk.map((id) =>
          syncProduct(sourceSellerId, targetSellerId, id, strategies),
        ),
      );
      for (const r of chunkResults) {
        results.push(
          r.status === "fulfilled"
            ? r.value
            : {
                itemId: "unknown",
                status: "failed" as const,
                sourcePrice: 0,
                targetPrice: 0,
                margin: 0,
                error: String(r.reason),
              },
        );
      }
    }

    return buildReport(results, total, 0, startedAt);
  }

  function syncAllBackground(
    sourceSellerId: string,
    targetSellerId: string,
    strategies: Strategy[],
    options?: ConcurrentSyncOptions,
  ): { jobId: string; getStatus: () => SyncJob } {
    const jobId = randomUUID();
    const job: SyncJob = {
      jobId,
      status: "running",
      startedAt: new Date().toISOString(),
      progress: { done: 0, total: 0 },
    };

    // Fire and forget — do NOT await
    syncAllConcurrent(sourceSellerId, targetSellerId, strategies, options)
      .then((report) => {
        job.status = "done";
        job.progress = { done: report.results.length, total: report.total };
      })
      .catch((err: unknown) => {
        job.status = "failed";
        job.error = String(err);
      });

    return {
      jobId,
      getStatus: () => ({ ...job }),
    };
  }

  return { syncProduct, syncAll, syncAllConcurrent, syncAllBackground };
}
