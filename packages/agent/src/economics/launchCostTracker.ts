import type { WorkforceCostCacheLedgerStore } from "../conversation/workforceCostCacheLedgerStore.js";
import type { ProductCatalogStore } from "@msl/domain";

// ── Cost Event Types ──────────────────────────────────────────────────

export type CostSource = "google_lens" | "deepseek" | "minimax";

export type LaunchCostEvent = {
  launchId: string;
  source: CostSource;
  estimatedCostUsd: number;
  /** What was done (e.g. "vision-recognition", "market-research", "image-generation") */
  operation: string;
  /** Optional metadata for the ledger entry */
  metadata?: Record<string, string>;
  /** When the cost was incurred */
  measuredAt?: string;
};

// ── Cost Event Bus ────────────────────────────────────────────────────

/**
 * Lightweight in-memory cost tracker for product launches.
 *
 * Aggregates costs per launch and optionally records them to the
 * WorkforceCostCacheLedger for global cost monitoring (PR 6 wiring).
 *
 * Stub-safe: works entirely in memory when no ledger or store is provided.
 */
export class LaunchCostTracker {
  /** Per-launch aggregated costs */
  private costsByLaunch = new Map<string, { totalUsd: number; events: LaunchCostEvent[] }>();

  /** Per-source counts for aggregate reporting */
  private countsBySource = new Map<CostSource, number>();

  constructor(
    private readonly options: {
      /** Optional WorkforceCostCacheLedger for recording costs globally */
      ledgerStore?: WorkforceCostCacheLedgerStore;
      /** Optional ProductCatalogStore for persisting cost_total_usd to the launch */
      catalogStore?: ProductCatalogStore;
    } = {},
  ) {}

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Record a cost event for a launch.
   *
   * Updates in-memory aggregation and optionally persists to the ledger
   * and catalog store.
   */
  record(event: LaunchCostEvent): void {
    // ── In-memory aggregation ──
    let entry = this.costsByLaunch.get(event.launchId);
    if (!entry) {
      entry = { totalUsd: 0, events: [] };
      this.costsByLaunch.set(event.launchId, entry);
    }
    entry.totalUsd += event.estimatedCostUsd;
    entry.events.push(event);

    // ── Source counts ──
    const currentCount = this.countsBySource.get(event.source) ?? 0;
    this.countsBySource.set(event.source, currentCount + 1);

    // ── Persist to catalog store ──
    if (this.options.catalogStore) {
      this.persistCostToStore(event.launchId, entry.totalUsd);
    }

    // ── Persist to workforce ledger ──
    if (this.options.ledgerStore) {
      this.persistCostToLedger(event);
    }
  }

  /**
   * Record multiple cost events at once (e.g., after a pipeline stage).
   */
  recordBatch(events: LaunchCostEvent[]): void {
    for (const event of events) {
      this.record(event);
    }
  }

  /**
   * Get the total accumulated cost for a specific launch.
   */
  getTotalCost(launchId: string): number {
    return this.costsByLaunch.get(launchId)?.totalUsd ?? 0;
  }

  /**
   * Get all cost events for a specific launch.
   */
  getEvents(launchId: string): readonly LaunchCostEvent[] {
    return this.costsByLaunch.get(launchId)?.events ?? [];
  }

  /**
   * Get a summary of costs across all launches.
   */
  getSummary(): {
    totalUsd: number;
    bySource: Record<CostSource, { count: number; totalUsd: number }>;
    activeLaunches: number;
  } {
    let totalUsd = 0;
    const bySource: Record<string, { count: number; totalUsd: number }> = {};

    for (const source of ["google_lens", "deepseek", "minimax"] as CostSource[]) {
      bySource[source] = { count: 0, totalUsd: 0 };
    }

    for (const [, entry] of this.costsByLaunch) {
      totalUsd += entry.totalUsd;
      for (const event of entry.events) {
        const bucket = bySource[event.source]!;
        bucket.count += 1;
        bucket.totalUsd += event.estimatedCostUsd;
      }
    }

    return {
      totalUsd: Math.round(totalUsd * 10_000) / 10_000,
      bySource: bySource as Record<CostSource, { count: number; totalUsd: number }>,
      activeLaunches: this.costsByLaunch.size,
    };
  }

  /**
   * Clear costs for a launch (e.g., when launch completes or is rejected).
   * Returns the cleared total for archival.
   */
  clear(launchId: string): number {
    const entry = this.costsByLaunch.get(launchId);
    if (!entry) return 0;
    this.costsByLaunch.delete(launchId);
    return entry.totalUsd;
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Update the cost_total_usd column in the product_launches table.
   * Uses a silent best-effort approach — failures are logged but not thrown.
   */
  private persistCostToStore(launchId: string, totalUsd: number): void {
    try {
      // getLaunch + updateLaunchStatus doesn't support cost updates directly,
      // so we query and re-create with updated cost. This is a soft-upsert.
      const store = this.options.catalogStore!;
      const existing = store.getLaunch(launchId);
      if (!existing) {
        console.warn(
          `[launchCostTracker] Launch "${launchId}" not found in store — skipping cost persist`,
        );
        return;
      }
      // Re-create the launch entry with the updated cost
      const input: Record<string, unknown> = {
        launchId: existing.launchId,
        productId: existing.productId,
        sellerId: existing.sellerId,
        status: existing.status,
        costTotalUsd: totalUsd,
        createdAt: existing.createdAt,
      };
      if (existing.mlItemId !== undefined) input.mlItemId = existing.mlItemId;
      if (existing.listingType !== undefined) input.listingType = existing.listingType;
      if (existing.priceAmount !== undefined) input.priceAmount = existing.priceAmount;
      if (existing.priceCurrency !== undefined) input.priceCurrency = existing.priceCurrency;
      if (existing.title !== undefined) input.title = existing.title;
      if (existing.description !== undefined) input.description = existing.description;
      if (existing.qualityScorePredicted !== undefined)
        input.qualityScorePredicted = existing.qualityScorePredicted;
      if (existing.qualityScoreActual !== undefined)
        input.qualityScoreActual = existing.qualityScoreActual;
      if (existing.completedAt !== undefined) input.completedAt = existing.completedAt;
      store.createLaunch(input as Parameters<ProductCatalogStore["createLaunch"]>[0]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[launchCostTracker] Failed to persist cost for launch "${launchId}": ${errorMessage}`,
      );
    }
  }

  /**
   * Record a cost entry to the WorkforceCostCacheLedger for global monitoring.
   */
  private persistCostToLedger(event: LaunchCostEvent): void {
    try {
      const ledger = this.options.ledgerStore!;
      const providerMap: Record<CostSource, string> = {
        google_lens: "serpapi",
        deepseek: "deepseek",
        minimax: "minimax",
      };
      ledger.insertEntry({
        entryId: `launch-cost-${event.launchId}-${event.source}-${Date.now()}`,
        agentId: "product-launch",
        laneId: "product-launch",
        provider: providerMap[event.source],
        model:
          event.source === "minimax"
            ? "image-01"
            : event.source === "google_lens"
              ? "google-lens"
              : "deepseek-chat",
        operation: event.operation,
        estimatedCostMicros: Math.round(event.estimatedCostUsd * 1_000_000),
        currency: "USD",
        cacheStatus: "unknown",
        metadata: (event.metadata ?? {}) as Record<string, string>,
        measuredAt: event.measuredAt ?? new Date().toISOString(),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[launchCostTracker] Failed to record cost to ledger: ${errorMessage}`);
    }
  }
}

// ── Cost Estimation Helpers ───────────────────────────────────────────

/**
 * Pre-computed per-call cost estimates used by workers to emit cost events.
 */
export const LAUNCH_COST_ESTIMATES = {
  googleLensCall: 0.005,
  deepseekCall: 0.01,
  minimaxImage: 0.015,
} as const;
