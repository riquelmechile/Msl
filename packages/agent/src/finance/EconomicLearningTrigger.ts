import type { EconomicOutcome, EconomicLearningEvent } from "@msl/domain";
import type { EconomicLearningStore, EconomicOutcomeStore, GraphEngine } from "@msl/memory";
import type { UnitEconomicsSnapshot } from "@msl/domain";
import { EconomicLearningPipeline } from "./EconomicLearningPipeline.js";

export type TriggerInput = {
  outcome: EconomicOutcome;
  economicStore: EconomicOutcomeStore;
  learningStore: EconomicLearningStore;
  engine?: GraphEngine;
  snapshot?: UnitEconomicsSnapshot;
};

export type TriggerResult = {
  outcomeId: string;
  sellerId: string;
  triggered: boolean;
  status: "processed" | "blocked" | "failed";
  event?: EconomicLearningEvent;
  reason?: string;
};

export class EconomicLearningTrigger {
  private readonly pipeline = new EconomicLearningPipeline();
  private readonly processedOutcomes = new Map<string, number>(); // outcomeId+sellerId → timestamp

  /**
   * Trigger the learning pipeline for an outcome transition.
   * Deduplicates by outcomeId + sellerId within a cooldown window.
   */
  onOutcomeTransition(input: TriggerInput): TriggerResult {
    const { outcome } = input;
    const dedupKey = `${outcome.outcomeId}:${outcome.sellerId}`;

    // Deduplication: same outcome + seller within cooldown
    const lastProcessed = this.processedOutcomes.get(dedupKey);
    if (lastProcessed && Date.now() - lastProcessed < 300_000) { // 5 min cooldown
      return {
        outcomeId: outcome.outcomeId,
        sellerId: outcome.sellerId,
        triggered: false,
        status: "blocked",
        reason: "deduplicated",
      };
    }

    try {
      if (outcome.status === "verified") {
        const result = this.pipeline.processVerifiedOutcome(input);
        this.processedOutcomes.set(dedupKey, Date.now());
        const base: TriggerResult = {
          outcomeId: outcome.outcomeId,
          sellerId: outcome.sellerId,
          triggered: true,
          status: result.status,
        };
        if (result.event !== undefined) base.event = result.event;
        return base;
      }

      if (outcome.status === "disputed" || outcome.status === "invalidated") {
        const result = this.pipeline.handleDisputedOutcome(input);
        this.processedOutcomes.set(dedupKey, Date.now());
        const base: TriggerResult = {
          outcomeId: outcome.outcomeId,
          sellerId: outcome.sellerId,
          triggered: true,
          status: result.status,
        };
        if (result.event !== undefined) base.event = result.event;
        return base;
      }

      return {
        outcomeId: outcome.outcomeId,
        sellerId: outcome.sellerId,
        triggered: false,
        status: "blocked",
        reason: `outcome-status-${outcome.status}`,
      };
    } catch (err) {
      return {
        outcomeId: outcome.outcomeId,
        sellerId: outcome.sellerId,
        triggered: true,
        status: "failed",
        reason: err instanceof Error ? err.message : "unknown-error",
      };
    }
  }

  /** Clean up dedup entries older than cooldown to prevent unbounded growth */
  pruneDedupCache(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, timestamp] of this.processedOutcomes) {
      if (now - timestamp > 600_000) { // 10 min
        this.processedOutcomes.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
}
