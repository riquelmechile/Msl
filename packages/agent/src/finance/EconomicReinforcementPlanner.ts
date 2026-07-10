import type {
  EconomicReinforcementPlan,
  EconomicAttributionAssessment,
  EconomicSignal,
  EconomicOutcome,
  ReinforcementTarget,
  NodeAdjustment,
  LessonCandidate,
  BlockedTarget,
  AttributionStrength,
} from "@msl/domain";
import { createEconomicReinforcementPlan } from "@msl/domain";

// ── Input type ──────────────────────────────────────────────────────────────

export type PlannerInput = {
  outcome: EconomicOutcome;
  signal: EconomicSignal;
  attributions: EconomicAttributionAssessment[];
  // Cortex context for targeting
  activatedNodeIds?: string[];
  activatedEdgeIds?: string[];
  // Finance Director assessment if available
  assessmentIds?: string[];
};

// ── Policy configuration ────────────────────────────────────────────────────

export type ReinforcementPolicyConfig = {
  readonly reinforcementPolicyVersion: string;
  readonly attributionPolicyVersion: string;
  readonly signalPolicyVersion: string;
  /** Global magnitude cap */
  readonly maxMagnitude: number;
  /** Per-strength magnitude caps */
  readonly strengthCaps: Record<AttributionStrength, number>;
  /** Minimum outcomes for semantic/procedural lessons */
  readonly minOutcomesForGlobalLesson: number;
};

const DEFAULT_POLICY_CONFIG: ReinforcementPolicyConfig = {
  reinforcementPolicyVersion: "0.1.0",
  attributionPolicyVersion: "0.1.0",
  signalPolicyVersion: "0.1.0",
  maxMagnitude: 0.3,
  strengthCaps: {
    none: 0,
    associated: 0,
    contributory: 0.1,
    "experiment-supported": 0.2,
    causal: 0.3,
  },
  minOutcomesForGlobalLesson: 3,
};

// ── Planner ─────────────────────────────────────────────────────────────────

export class EconomicReinforcementPlanner {
  private config: ReinforcementPolicyConfig;

  constructor(config?: Partial<ReinforcementPolicyConfig>) {
    const strengthCaps = config?.strengthCaps
      ? { ...DEFAULT_POLICY_CONFIG.strengthCaps, ...config.strengthCaps }
      : DEFAULT_POLICY_CONFIG.strengthCaps;
    this.config = { ...DEFAULT_POLICY_CONFIG, ...config, strengthCaps };
  }

  /**
   * Creates a reinforcement plan from an outcome, signal, and attributions.
   *
   * Guarantees:
   *  - Every plan has `noExternalMutationExecuted: true`
   *  - Deltas are clamped per strength cap and global maxMagnitude
   *  - "none" strength → no adjustments, blocked targets
   *  - Lessons are always episodic (advisory, never overwrite CEO policy)
   *  - Policy versions are stamped on every plan
   *  - Deterministic given the same inputs
   */
  createPlan(input: PlannerInput): EconomicReinforcementPlan {
    const { outcome, signal, attributions, activatedNodeIds, activatedEdgeIds } = input;

    const targetNodes: ReinforcementTarget[] = [];
    const targetEdges: ReinforcementTarget[] = [];
    const proposedAdjustments: NodeAdjustment[] = [];
    const lessonCandidates: LessonCandidate[] = [];
    const blockedTargets: BlockedTarget[] = [];
    const reasonCodes: string[] = [];

    // ── Aggregate attribution strength ─────────────────────────────────────
    const effectiveStrength = computeEffectiveStrength(attributions);
    const effectiveConfidence = computeEffectiveConfidence(attributions);

    // ── Per-strength plan generation ───────────────────────────────────────
    switch (effectiveStrength) {
      case "none": {
        // No adjustments, no targets, blocked targets for any matched nodes
        reasonCodes.push("no-attribution");
        if (activatedNodeIds && activatedNodeIds.length > 0) {
          for (const nodeId of activatedNodeIds) {
            blockedTargets.push({
              targetId: nodeId,
              reason: `Attribution strength is "none" — no economic link established.`,
            });
          }
        }
        // Record outcome as a factual node for future learning
        targetNodes.push({
          nodeId: outcome.outcomeId,
          reason: "Factual outcome record (strength: none)",
        });
        break;
      }

      case "associated": {
        reasonCodes.push("associated-attribution");
        // Episodic lesson only, no edge adjustments
        const lesson = this.buildLesson({
          outcome,
          signal,
          strength: "associated",
        });
        lessonCandidates.push(lesson);

        // Outcome node as target
        targetNodes.push({
          nodeId: outcome.outcomeId,
          reason: "Associated economic outcome",
        });
        break;
      }

      case "contributory":
      case "experiment-supported":
      case "causal": {
        reasonCodes.push(`${effectiveStrength}-attribution`);

        // Compute delta based on strength
        const delta = this.computeDelta(signal, effectiveStrength);
        reasonCodes.push(
          `delta-${delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral"}`,
        );

        // Apply adjustments to activated nodes
        if (activatedNodeIds && activatedNodeIds.length > 0) {
          for (const nodeId of activatedNodeIds) {
            targetNodes.push({
              nodeId,
              reason: `Economic outcome ${outcome.outcomeId} attributed as ${effectiveStrength}`,
            });

            if (Math.abs(delta) > 0) {
              proposedAdjustments.push({
                nodeId,
                delta,
                reason: `Reinforcement from ${effectiveStrength} attribution (signal: ${signal.direction}, magnitude: ${signal.magnitude})`,
                targetType: "node",
              });
            }
          }
        } else {
          // No activated nodes — target the outcome itself
          targetNodes.push({
            nodeId: outcome.outcomeId,
            reason: `Economic outcome attributed as ${effectiveStrength} (no cortex context)`,
          });
        }

        // Edge adjustments if edge IDs are provided
        if (activatedEdgeIds && activatedEdgeIds.length > 0 && Math.abs(delta) > 0) {
          for (const edgeId of activatedEdgeIds) {
            proposedAdjustments.push({
              nodeId: edgeId,
              delta,
              reason: `Edge reinforcement from ${effectiveStrength} attribution`,
              targetType: "edge",
            });
          }
        }

        // Always create episodic lesson
        const lesson = this.buildLesson({
          outcome,
          signal,
          strength: effectiveStrength,
        });
        lessonCandidates.push(lesson);
        break;
      }
    }

    // ── Signal-based reason codes ──────────────────────────────────────────
    if (signal.direction === "positive") {
      reasonCodes.push("positive-reinforcement");
    } else if (signal.direction === "negative") {
      reasonCodes.push("negative-reinforcement");
    } else {
      reasonCodes.push("neutral-reinforcement");
    }

    // ── Build plan ─────────────────────────────────────────────────────────
    return createEconomicReinforcementPlan({
      outcomeId: outcome.outcomeId,
      sellerId: outcome.sellerId,
      economicSignal: signal,
      attributionStrength: effectiveStrength,
      confidence: effectiveConfidence,
      targetNodes,
      targetEdges,
      proposedAdjustments,
      lessonCandidates,
      blockedTargets,
      reasonCodes,
      status: "proposed",
      reinforcementPolicyVersion: this.config.reinforcementPolicyVersion,
      attributionPolicyVersion: this.config.attributionPolicyVersion,
      signalPolicyVersion: this.config.signalPolicyVersion,
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Compute the reinforcement delta from the signal and attribution strength.
   *
   * Rules:
   *  - Associated → delta = 0 (no adjustment)
   *  - Contributory → delta = signal.magnitude * 0.1 * direction, capped at 0.1
   *  - Experiment-supported → delta = signal.magnitude * 0.2 * direction, capped at 0.2
   *  - Causal → delta = signal.magnitude * 0.3 * direction, capped at maxMagnitude (0.3)
   *  - None → delta = 0
   *
   * All deltas are additionally clamped by the global maxMagnitude and per-strength cap.
   */
  private computeDelta(signal: EconomicSignal, strength: AttributionStrength): number {
    if (strength === "none" || strength === "associated") {
      return 0;
    }

    if (signal.direction === "neutral") {
      return 0;
    }

    const directionSign = signal.direction === "positive" ? 1 : -1;

    let multiplier: number;
    switch (strength) {
      case "contributory":
        multiplier = 0.1;
        break;
      case "experiment-supported":
        multiplier = 0.2;
        break;
      case "causal":
        multiplier = 0.3;
        break;
      default:
        multiplier = 0;
    }

    const rawDelta = signal.magnitude * multiplier * directionSign;

    // Clamp by per-strength cap
    const strengthCap = this.config.strengthCaps[strength];
    const strengthClamped = clamp(rawDelta, -strengthCap, strengthCap);

    // Clamp by global maxMagnitude
    return clamp(strengthClamped, -this.config.maxMagnitude, this.config.maxMagnitude);
  }

  /**
   * Build an episodic lesson candidate from an outcome and signal.
   */
  private buildLesson(params: {
    outcome: EconomicOutcome;
    signal: EconomicSignal;
    strength: AttributionStrength;
  }): LessonCandidate {
    const { outcome, signal, strength } = params;

    const content = buildLessonContent(outcome, signal, strength);
    const confidence = Math.min(signal.confidence, outcome.confidence);

    return {
      content,
      type: "episodic",
      confidence,
      scope: `seller:${outcome.sellerId}`,
      expiryDays: 90,
      supportingOutcomeIds: [outcome.outcomeId],
    };
  }
}

// ── Aggregation helpers ─────────────────────────────────────────────────────

/**
 * Compute the effective attribution strength from a set of assessments.
 * Takes the maximum strength across all matching assessments.
 */
function computeEffectiveStrength(
  attributions: EconomicAttributionAssessment[],
): AttributionStrength {
  if (attributions.length === 0) return "none";

  const strengthRank: Record<AttributionStrength, number> = {
    none: 0,
    associated: 1,
    contributory: 2,
    "experiment-supported": 3,
    causal: 4,
  };

  let maxRank = 0;
  let maxStrength: AttributionStrength = "none";

  for (const att of attributions) {
    const rank = strengthRank[att.strength];
    if (rank > maxRank) {
      maxRank = rank;
      maxStrength = att.strength;
    }
  }

  return maxStrength;
}

/**
 * Compute effective confidence from attribution assessments.
 * Takes the average confidence across all non-"none" assessments,
 * or 0 if no assessments.
 */
function computeEffectiveConfidence(
  attributions: EconomicAttributionAssessment[],
): number {
  const valid = attributions.filter((a) => a.strength !== "none");
  if (valid.length === 0) return 0;

  const sum = valid.reduce((acc, a) => acc + a.confidence, 0);
  return Math.round((sum / valid.length) * 100) / 100;
}

// ── Lesson content builder ──────────────────────────────────────────────────

function buildLessonContent(
  outcome: EconomicOutcome,
  signal: EconomicSignal,
  strength: AttributionStrength,
): string {
  const direction = signal.direction;
  const magnitude = signal.magnitude;

  switch (strength) {
    case "none":
      return `Outcome ${outcome.outcomeId} had no economic attribution. Recorded for future analysis.`;
    case "associated":
      return `Outcome ${outcome.outcomeId} is associated with economic activity (${direction}, magnitude ${magnitude.toFixed(2)}). Causal link not established.`;
    case "contributory":
      return `Outcome ${outcome.outcomeId} contributed to economic impact (${direction}, magnitude ${magnitude.toFixed(2)}). Review for reinforcement.`;
    case "experiment-supported":
      return `Outcome ${outcome.outcomeId} shows experiment-supported economic impact (${direction}, magnitude ${magnitude.toFixed(2)}). Higher confidence in causal link.`;
    case "causal":
      return `Outcome ${outcome.outcomeId} has causal economic impact (${direction}, magnitude ${magnitude.toFixed(2)}). Strong reinforcement candidate.`;
  }
}

// ── Utility ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, value));
}
