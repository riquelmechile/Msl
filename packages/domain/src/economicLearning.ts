import type { Currency } from "./money.js";
import type { EconomicOutcomeStatus } from "./economicOutcome.js";

// ── Block reason enumeration ────────────────────────────────────────────────

export const ECONOMIC_LEARNING_BLOCK_REASONS = [
  "outcome-not-verified",
  "incomplete-economic-data",
  "disputed-evidence",
  "invalidated-outcome",
  "missing-observed-impact",
  "currency-conflict",
  "missing-attribution-target",
  "stale-evidence",
  "already-processed",
  "seller-scope-mismatch",
] as const;

export type BlockReason = (typeof ECONOMIC_LEARNING_BLOCK_REASONS)[number];

// ── Eligibility result ──────────────────────────────────────────────────────

export type EconomicLearningEligibility = {
  readonly outcomeId: string;
  readonly sellerId: string;
  readonly eligible: boolean;
  readonly reasonCodes: readonly BlockReason[];
  readonly outcomeStatus: EconomicOutcomeStatus;
  readonly completeness: number;
  readonly confidence: number;
  readonly evidenceQuality: number;
  readonly hasVerifiedEconomicImpact: boolean;
  readonly hasAttributionTargets: boolean;
  readonly currencies: readonly Currency[];
  readonly evaluatedAt: number;
};

export type EconomicLearningEligibilityInput = Omit<
  EconomicLearningEligibility,
  "evaluatedAt"
>;

// ── Attribution ─────────────────────────────────────────────────────────────

export const ATTRIBUTION_STRENGTHS = [
  "none",
  "associated",
  "contributory",
  "experiment-supported",
  "causal",
] as const;

export type AttributionStrength = (typeof ATTRIBUTION_STRENGTHS)[number];

export const ATTRIBUTION_TARGET_TYPES = [
  "agent",
  "proposal",
  "action",
  "session",
  "campaign",
  "experiment",
  "cortex-constellation",
] as const;

export type AttributionTargetType = (typeof ATTRIBUTION_TARGET_TYPES)[number];

export type EconomicAttributionAssessment = {
  readonly attributionId: string;
  readonly outcomeId: string;
  readonly sellerId: string;
  readonly targetType: AttributionTargetType;
  readonly targetId: string;
  readonly strength: AttributionStrength;
  readonly confidence: number;
  readonly supportingEvidenceIds: readonly string[];
  readonly contradictingEvidenceIds: readonly string[];
  readonly alternativeExplanations: readonly string[];
  readonly baselineId?: string;
  readonly experimentId?: string;
  readonly observationWindow?: { readonly start: number; readonly end: number };
  readonly evaluator: string;
  readonly createdAt: number;
  readonly noMutationExecuted: true;
};

export type EconomicAttributionAssessmentInput = Omit<
  EconomicAttributionAssessment,
  "attributionId" | "createdAt" | "noMutationExecuted"
>;

// ── Economic signal ─────────────────────────────────────────────────────────

export type EconomicSignal = {
  readonly direction: "positive" | "neutral" | "negative";
  readonly magnitude: number; // 0..1
  readonly confidence: number; // 0..1
  readonly reasonCodes: readonly string[];
  readonly sourceValues: Record<string, number>;
};

// ── Plan statuses ───────────────────────────────────────────────────────────

export const PLAN_STATUSES = [
  "proposed",
  "validated",
  "applied",
  "rejected",
  "reversed",
  "failed",
] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

// ── Reinforcement targets / adjustments ─────────────────────────────────────

export type ReinforcementTarget = {
  readonly nodeId: string;
  readonly reason: string;
};

export type NodeAdjustment = {
  readonly nodeId: string;
  readonly delta: number;
  readonly reason: string;
  readonly targetType: "node" | "edge";
};

export type BlockedTarget = {
  readonly targetId: string;
  readonly reason: string;
};

export type LessonCandidate = {
  readonly content: string;
  readonly type: "episodic" | "semantic" | "procedural" | "economic";
  readonly confidence: number;
  readonly scope: string;
  readonly expiryDays?: number;
  readonly supportingOutcomeIds: readonly string[];
};

// ── Reinforcement plan ──────────────────────────────────────────────────────

export type EconomicReinforcementPlan = {
  readonly planId: string;
  readonly outcomeId: string;
  readonly sellerId: string;
  readonly economicSignal: EconomicSignal;
  readonly attributionStrength: AttributionStrength;
  readonly confidence: number;
  readonly targetNodes: readonly ReinforcementTarget[];
  readonly targetEdges: readonly ReinforcementTarget[];
  readonly proposedAdjustments: readonly NodeAdjustment[];
  readonly lessonCandidates: readonly LessonCandidate[];
  readonly blockedTargets: readonly BlockedTarget[];
  readonly reasonCodes: readonly string[];
  readonly createdAt: number;
  readonly status: PlanStatus;
  readonly reinforcementPolicyVersion: string;
  readonly attributionPolicyVersion: string;
  readonly signalPolicyVersion: string;
  readonly noExternalMutationExecuted: true;
};

export type EconomicReinforcementPlanInput = Omit<
  EconomicReinforcementPlan,
  "planId" | "createdAt" | "noExternalMutationExecuted"
>;

// ── Learning event statuses ─────────────────────────────────────────────────

export const LEARNING_EVENT_STATUSES = [
  "processed",
  "failed",
  "retryable",
  "reversed",
] as const;

export type LearningEventStatus = (typeof LEARNING_EVENT_STATUSES)[number];

// ── Applied adjustment record ───────────────────────────────────────────────

export type AppliedAdjustment = {
  readonly nodeId: string;
  readonly delta: number;
  readonly targetType: "node" | "edge";
  readonly beforeValue: number;
  readonly afterValue: number;
};

// ── Learning event (audit record) ───────────────────────────────────────────

export type EconomicLearningEvent = {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly outcomeId: string;
  readonly sellerId: string;
  readonly planId: string;
  readonly attributionId: string;
  readonly targetNodeIds: readonly string[];
  readonly targetEdgeIds: readonly string[];
  readonly adjustments: readonly AppliedAdjustment[];
  readonly lessonsCreated: readonly string[];
  readonly beforeStateHash: string;
  readonly afterStateHash: string;
  readonly appliedAt: number;
  readonly reversedAt?: number;
  readonly status: LearningEventStatus;
  readonly errorCode?: string;
  readonly metadata: Record<string, unknown>; // bounded, no secrets
  readonly reinforcementPolicyVersion: string;
};

export type EconomicLearningEventInput = Omit<
  EconomicLearningEvent,
  "eventId" | "appliedAt"
>;

// ── Factories ───────────────────────────────────────────────────────────────

let eligibilityCounter = 0;
export function createEconomicLearningEligibility(
  input: EconomicLearningEligibilityInput,
): EconomicLearningEligibility {
  return {
    ...input,
    evaluatedAt: Date.now(),
  };
}
// Note: eligibilityCounter is reserved for idempotent re-evaluation tracking.

let attributionCounter = 0;
export function createEconomicAttributionAssessment(
  input: EconomicAttributionAssessmentInput,
): EconomicAttributionAssessment {
  attributionCounter++;
  return {
    ...input,
    attributionId: `attr-${attributionCounter}`,
    createdAt: Date.now(),
    noMutationExecuted: true as const,
  };
}

let planCounter = 0;
export function createEconomicReinforcementPlan(
  input: EconomicReinforcementPlanInput,
): EconomicReinforcementPlan {
  planCounter++;
  return {
    ...input,
    planId: `plan-${planCounter}`,
    createdAt: Date.now(),
    noExternalMutationExecuted: true as const,
  };
}

let eventCounter = 0;
export function createEconomicLearningEvent(
  input: EconomicLearningEventInput,
): EconomicLearningEvent {
  eventCounter++;
  return {
    ...input,
    eventId: `event-${eventCounter}`,
    appliedAt: Date.now(),
  };
}
