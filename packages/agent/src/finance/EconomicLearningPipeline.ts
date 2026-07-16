import type {
  EconomicOutcome,
  EconomicLearningEvent,
  EconomicLearningEligibility,
  EconomicAttributionAssessment,
  EconomicReinforcementPlan,
  UnitEconomicsSnapshot,
} from "@msl/domain";
import { evaluateEconomicLearningEligibility } from "@msl/domain";
import { computeEconomicSignal as computeSignal } from "@msl/domain";
import type {
  EconomicLearningStore,
  EconomicOutcomeReader as EconomicOutcomeStore,
  GraphEngine,
} from "@msl/memory";
import { EconomicAttributionEvaluator } from "./EconomicAttributionEvaluator.js";
import { EconomicReinforcementPlanner } from "./EconomicReinforcementPlanner.js";
import { CortexEconomicReinforcementBridge } from "./CortexEconomicReinforcementBridge.js";

// ── Public types ──────────────────────────────────────────────────────────

export type PipelineInput = {
  outcome: EconomicOutcome;
  economicStore: EconomicOutcomeStore;
  learningStore: EconomicLearningStore;
  engine?: GraphEngine;
  /** Optional snapshot for eligibility and signal computation */
  snapshot?: UnitEconomicsSnapshot;
};

export type PipelineResult = {
  eligibility?: EconomicLearningEligibility;
  attributions?: EconomicAttributionAssessment[];
  plan?: EconomicReinforcementPlan;
  event?: EconomicLearningEvent;
  status: "processed" | "blocked" | "failed";
  reasonCodes: string[];
};

// ── Pipeline ──────────────────────────────────────────────────────────────

const POLICY_VERSION = "0.1.0";

export class EconomicLearningPipeline {
  private readonly attributionEvaluator = new EconomicAttributionEvaluator();
  private readonly planner = new EconomicReinforcementPlanner();
  private readonly bridge = new CortexEconomicReinforcementBridge();

  /**
   * Process a verified outcome through the full economic reinforcement
   * learning pipeline.
   */
  processVerifiedOutcome(input: PipelineInput): PipelineResult {
    const { outcome, learningStore, engine, snapshot } = input;
    if (learningStore.isAlreadyProcessed(outcome.outcomeId, outcome.sellerId, POLICY_VERSION)) {
      const existingEvents = learningStore.listByOutcome(outcome.outcomeId, outcome.sellerId);
      const latest = existingEvents[0];
      return {
        status: latest ? (latest.status === "failed" ? "failed" : "processed") : "processed",
        reasonCodes: ["already-processed"],
        ...(latest === undefined ? {} : { event: latest }),
      };
    }

    // ── Step 1: Eligibility evaluation ────────────────────────────────────
    const hasAttributionTargets = this.hasAttributionTargets(outcome);
    const eligibility = evaluateEconomicLearningEligibility({
      outcome,
      ...(snapshot === undefined ? {} : { snapshot }),
      hasAttributionTargets,
      alreadyProcessed: false,
    });

    // Persist eligibility for audit
    try {
      learningStore.saveEligibility(eligibility);
    } catch {
      // Best effort — don't block pipeline
    }

    if (!eligibility.eligible) {
      return {
        eligibility,
        status: "blocked",
        reasonCodes: [...eligibility.reasonCodes],
      };
    }

    // ── Step 2: Attribution ───────────────────────────────────────────────
    const attributionInput = {
      outcome,
      sellerId: outcome.sellerId,
    };
    const attrInput = snapshot === undefined ? attributionInput : { ...attributionInput, snapshot };
    const attributions = this.attributionEvaluator.evaluateFastPath(attrInput);

    // Persist attributions
    for (const attr of attributions) {
      try {
        learningStore.saveAttribution(attr);
      } catch {
        // Best effort
      }
    }

    if (attributions.length === 0) {
      return {
        eligibility,
        attributions: [],
        status: "blocked",
        reasonCodes: ["missing-attribution-target"],
      };
    }

    // ── Step 3: Economic signal ───────────────────────────────────────────
    if (!snapshot) {
      return {
        eligibility,
        attributions,
        status: "blocked",
        reasonCodes: ["incomplete-economic-data"],
      };
    }

    let signal;
    try {
      signal = computeSignal({ outcome, snapshot });
    } catch {
      return {
        eligibility,
        attributions,
        status: "blocked",
        reasonCodes: ["incomplete-economic-data"],
      };
    }

    // ── Step 4: Reinforcement plan ────────────────────────────────────────
    const plan = this.planner.createPlan({
      outcome,
      signal,
      attributions,
    });

    try {
      learningStore.savePlan(plan);
    } catch {
      // Best effort
    }

    // ── Step 5: Bridge — apply to Cortex ──────────────────────────────────
    const bridgeResult = this.bridge.applyPlan({
      plan,
      outcome,
      engine,
      isAlreadyProcessed: (key) => learningStore.claimIdempotencyKey(key, outcome.sellerId),
      persistEvent: (event) => {
        try {
          learningStore.insertEvent(event);
        } catch {
          // Best effort
        }
      },
      listEventsByOutcome: (oid, sid) => learningStore.listByOutcome(oid, sid),
      listReversedEvents: (oid, sid) => learningStore.getReversedEvents(oid, sid),
    });

    const finalStatus: "processed" | "failed" = bridgeResult.errorCode ? "failed" : "processed";

    return {
      eligibility,
      attributions,
      plan,
      event: bridgeResult.event,
      status: finalStatus,
      reasonCodes:
        finalStatus === "failed" && bridgeResult.errorCode ? [bridgeResult.errorCode] : [],
    };
  }

  /**
   * Handle disputed or invalidated outcomes — find prior learning events
   * and reverse them via the bridge.
   */
  handleDisputedOutcome(input: PipelineInput): PipelineResult {
    const { outcome, learningStore } = input;

    const bridgeResult = this.bridge.reverseLearning(
      outcome.outcomeId,
      outcome.sellerId,
      (oid, sid) => learningStore.listByOutcome(oid, sid),
      (oid, sid) => learningStore.getReversedEvents(oid, sid),
    );

    // Persist the reversal event
    try {
      learningStore.insertEvent(bridgeResult.event);
    } catch {
      // Best effort
    }

    const reasonCodes: string[] = [];
    if (bridgeResult.errorCode) {
      reasonCodes.push(bridgeResult.errorCode);
    }
    if (outcome.status === "disputed") {
      reasonCodes.push("disputed-evidence");
    }
    if (outcome.status === "invalidated") {
      reasonCodes.push("invalidated-outcome");
    }

    return {
      event: bridgeResult.event,
      status: bridgeResult.applied ? "processed" : "blocked",
      reasonCodes,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private hasAttributionTargets(outcome: EconomicOutcome): boolean {
    return !!(
      outcome.proposalId ||
      outcome.preparedActionId ||
      outcome.executionId ||
      outcome.originatingAgentId ||
      outcome.workSessionId
    );
  }
}
