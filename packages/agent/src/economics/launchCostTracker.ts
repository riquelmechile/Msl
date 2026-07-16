import type { WorkforceCostCacheLedgerStore } from "../conversation/workforceCostCacheLedgerStore.js";
import type { ProductCatalogStore } from "@msl/domain";

// ── Cost Event Types ──────────────────────────────────────────────────

export type CostSource = "google_lens" | "deepseek" | "minimax";

export type LaunchCostEvent = {
  /** Stable retry key. Defaults to launch/source/operation when omitted. */
  eventKey?: string;
  launchId: string;
  sellerId?: string;
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
      /** Maximum accumulated external API cost for one launch. */
      maxLaunchUsd?: number;
    } = {},
  ) {}

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Record a cost event for a launch.
   *
   * Updates in-memory aggregation and optionally persists to the ledger
   * and catalog store.
   */
  canAfford(
    launchId: string,
    sellerId: string,
    estimatedCostUsd: number,
  ): { allowed: boolean; reason?: string } {
    const total = this.persistedTotal(launchId, sellerId);
    const max = this.options.maxLaunchUsd ?? 0.25;
    return total + estimatedCostUsd <= max
      ? { allowed: true }
      : {
          allowed: false,
          reason: `Launch cost budget exceeded ($${max.toFixed(2)} USD limit)`,
        };
  }

  record(event: LaunchCostEvent): { recorded: boolean; totalUsd: number } {
    const eventKey = event.eventKey ?? `${event.launchId}:${event.source}:${event.operation}`;
    const existingEntry = this.costsByLaunch.get(event.launchId);
    if (existingEntry?.events.some((item) => item.eventKey === eventKey)) {
      return { recorded: false, totalUsd: existingEntry.totalUsd };
    }

    if (this.options.catalogStore && event.sellerId) {
      const persisted = this.options.catalogStore.recordLaunchCost({
        eventKey,
        launchId: event.launchId,
        sellerId: event.sellerId,
        source: event.source,
        operation: event.operation,
        amountUsd: event.estimatedCostUsd,
        measuredAt: event.measuredAt ?? new Date().toISOString(),
      });
      if (!persisted.recorded) return persisted;
    }

    // ── In-memory aggregation ──
    let entry = this.costsByLaunch.get(event.launchId);
    if (!entry) {
      entry = { totalUsd: 0, events: [] };
      this.costsByLaunch.set(event.launchId, entry);
    }
    entry.totalUsd =
      this.options.catalogStore && event.sellerId
        ? this.persistedTotal(event.launchId, event.sellerId)
        : entry.totalUsd + event.estimatedCostUsd;
    entry.events.push({ ...event, eventKey });

    // ── Source counts ──
    const currentCount = this.countsBySource.get(event.source) ?? 0;
    this.countsBySource.set(event.source, currentCount + 1);

    // ── Persist to workforce ledger ──
    if (this.options.ledgerStore) {
      this.persistCostToLedger(event);
    }
    return { recorded: true, totalUsd: entry.totalUsd };
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
    return (
      this.options.catalogStore?.getLaunch(launchId)?.costTotalUsd ??
      this.costsByLaunch.get(launchId)?.totalUsd ??
      0
    );
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
      bySource: bySource,
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
  private persistedTotal(launchId: string, sellerId: string): number {
    return (
      this.options.catalogStore?.getLaunchForSeller(launchId, sellerId)?.costTotalUsd ??
      this.costsByLaunch.get(launchId)?.totalUsd ??
      0
    );
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
        entryId:
          event.eventKey ?? `launch-cost-${event.launchId}-${event.source}-${event.operation}`,
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
        metadata: event.metadata ?? {},
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
