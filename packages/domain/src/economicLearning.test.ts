import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_STRENGTHS,
  createEconomicAttributionAssessment,
  createEconomicLearningEligibility,
  createEconomicLearningEvent,
  createEconomicReinforcementPlan,
  ECONOMIC_LEARNING_BLOCK_REASONS,
  type EconomicSignal,
} from "./economicLearning.js";

describe("ECONOMIC_LEARNING_BLOCK_REASONS", () => {
  it("has exactly 10 block reasons", () => {
    expect(ECONOMIC_LEARNING_BLOCK_REASONS).toHaveLength(10);
  });

  it("includes all expected block reasons", () => {
    expect(ECONOMIC_LEARNING_BLOCK_REASONS).toContain("outcome-not-verified");
    expect(ECONOMIC_LEARNING_BLOCK_REASONS).toContain("incomplete-economic-data");
    expect(ECONOMIC_LEARNING_BLOCK_REASONS).toContain("disputed-evidence");
    expect(ECONOMIC_LEARNING_BLOCK_REASONS).toContain("missing-observed-impact");
    expect(ECONOMIC_LEARNING_BLOCK_REASONS).toContain("currency-conflict");
    expect(ECONOMIC_LEARNING_BLOCK_REASONS).toContain("missing-attribution-target");
    expect(ECONOMIC_LEARNING_BLOCK_REASONS).toContain("already-processed");
    expect(ECONOMIC_LEARNING_BLOCK_REASONS).toContain("seller-scope-mismatch");
  });
});

describe("ATTRIBUTION_STRENGTHS", () => {
  it("has exactly 5 levels", () => {
    expect(ATTRIBUTION_STRENGTHS).toHaveLength(5);
  });

  it("includes none through causal", () => {
    expect(ATTRIBUTION_STRENGTHS).toContain("none");
    expect(ATTRIBUTION_STRENGTHS).toContain("associated");
    expect(ATTRIBUTION_STRENGTHS).toContain("contributory");
    expect(ATTRIBUTION_STRENGTHS).toContain("experiment-supported");
    expect(ATTRIBUTION_STRENGTHS).toContain("causal");
  });
});

describe("createEconomicLearningEligibility", () => {
  it("creates an eligibility with evaluatedAt set", () => {
    const eligibility = createEconomicLearningEligibility({
      outcomeId: "outcome-1",
      sellerId: "seller-1",
      eligible: true,
      reasonCodes: [],
      outcomeStatus: "verified",
      completeness: 0.9,
      confidence: 0.8,
      evidenceQuality: 1.0,
      hasVerifiedEconomicImpact: true,
      hasAttributionTargets: true,
      currencies: ["CLP"],
    });

    expect(eligibility.outcomeId).toBe("outcome-1");
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.reasonCodes).toEqual([]);
    expect(eligibility.evaluatedAt).toBeGreaterThan(0);
  });

  it("creates a blocked eligibility", () => {
    const eligibility = createEconomicLearningEligibility({
      outcomeId: "outcome-2",
      sellerId: "seller-2",
      eligible: false,
      reasonCodes: ["outcome-not-verified", "missing-observed-impact"],
      outcomeStatus: "pending",
      completeness: 0.3,
      confidence: 0.1,
      evidenceQuality: 0,
      hasVerifiedEconomicImpact: false,
      hasAttributionTargets: false,
      currencies: [],
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasonCodes).toHaveLength(2);
    expect(eligibility.outcomeStatus).toBe("pending");
  });
});

describe("createEconomicAttributionAssessment", () => {
  it("creates an assessment with auto-generated attributionId and timestamps", () => {
    const assessment = createEconomicAttributionAssessment({
      outcomeId: "outcome-1",
      sellerId: "seller-1",
      targetType: "agent",
      targetId: "agent-1",
      strength: "contributory",
      confidence: 0.85,
      supportingEvidenceIds: ["ev-1"],
      contradictingEvidenceIds: [],
      alternativeExplanations: [],
      evaluator: "cortex-v3",
    });

    expect(assessment.attributionId).toMatch(/^attr-\d+$/);
    expect(assessment.outcomeId).toBe("outcome-1");
    expect(assessment.sellerId).toBe("seller-1");
    expect(assessment.strength).toBe("contributory");
    expect(assessment.noMutationExecuted).toBe(true);
    expect(assessment.createdAt).toBeGreaterThan(0);
  });

  it("produces incrementing attribution IDs", () => {
    const a1 = createEconomicAttributionAssessment({
      outcomeId: "o-1",
      sellerId: "s-1",
      targetType: "proposal",
      targetId: "p-1",
      strength: "associated",
      confidence: 0.7,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      alternativeExplanations: [],
      evaluator: "eval",
    });
    const a2 = createEconomicAttributionAssessment({
      outcomeId: "o-2",
      sellerId: "s-2",
      targetType: "campaign",
      targetId: "c-1",
      strength: "causal",
      confidence: 0.95,
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      alternativeExplanations: [],
      evaluator: "eval",
    });

    expect(a1.attributionId).not.toBe(a2.attributionId);
    const num1 = parseInt(a1.attributionId.replace("attr-", ""), 10);
    const num2 = parseInt(a2.attributionId.replace("attr-", ""), 10);
    expect(num2).toBeGreaterThan(num1);
  });
});

describe("createEconomicReinforcementPlan", () => {
  it("creates a plan with auto-generated planId and default status", () => {
    const signal: EconomicSignal = {
      direction: "positive",
      magnitude: 0.8,
      confidence: 0.9,
      reasonCodes: ["positive-net-profit"],
      sourceValues: { netProfit: 50000 },
    };

    const plan = createEconomicReinforcementPlan({
      outcomeId: "outcome-1",
      sellerId: "seller-1",
      economicSignal: signal,
      attributionStrength: "contributory",
      confidence: 0.85,
      targetNodes: [],
      targetEdges: [],
      proposedAdjustments: [],
      lessonCandidates: [],
      blockedTargets: [],
      reasonCodes: [],
      status: "proposed",
      reinforcementPolicyVersion: "1.0.0",
      attributionPolicyVersion: "1.0.0",
      signalPolicyVersion: "1.0.0",
    });

    expect(plan.planId).toMatch(/^plan-\d+$/);
    expect(plan.status).toBe("proposed");
    expect(plan.economicSignal.direction).toBe("positive");
    expect(plan.noExternalMutationExecuted).toBe(true);
    expect(plan.createdAt).toBeGreaterThan(0);
  });

  it("preserves all provided fields", () => {
    const plan = createEconomicReinforcementPlan({
      outcomeId: "outcome-2",
      sellerId: "seller-2",
      economicSignal: {
        direction: "negative",
        magnitude: 0.3,
        confidence: 0.5,
        reasonCodes: ["negative-net-profit"],
        sourceValues: {},
      },
      attributionStrength: "none",
      confidence: 0.4,
      targetNodes: [{ nodeId: "n-1", reason: "test" }],
      targetEdges: [],
      proposedAdjustments: [{ nodeId: "n-1", delta: -0.1, reason: "reduce", targetType: "node" }],
      lessonCandidates: [],
      blockedTargets: [{ targetId: "t-1", reason: "scope mismatch" }],
      reasonCodes: ["low-confidence"],
      status: "proposed",
      reinforcementPolicyVersion: "2.0.0",
      attributionPolicyVersion: "2.0.0",
      signalPolicyVersion: "2.0.0",
    });

    expect(plan.targetNodes).toHaveLength(1);
    expect(plan.targetNodes[0]!.nodeId).toBe("n-1");
    expect(plan.blockedTargets).toHaveLength(1);
    expect(plan.proposedAdjustments).toHaveLength(1);
    expect(plan.status).toBe("proposed");
  });
});

describe("createEconomicLearningEvent", () => {
  it("creates an event with auto-generated eventId and appliedAt", () => {
    const event = createEconomicLearningEvent({
      idempotencyKey: "idem-1",
      outcomeId: "outcome-1",
      sellerId: "seller-1",
      planId: "plan-1",
      attributionId: "attr-1",
      targetNodeIds: [],
      targetEdgeIds: [],
      adjustments: [],
      lessonsCreated: [],
      beforeStateHash: "hash-before",
      afterStateHash: "hash-after",
      status: "processed",
      metadata: {},
      reinforcementPolicyVersion: "1.0.0",
    });

    expect(event.eventId).toMatch(/^event-\d+$/);
    expect(event.idempotencyKey).toBe("idem-1");
    expect(event.status).toBe("processed");
    expect(event.appliedAt).toBeGreaterThan(0);
    expect(event.beforeStateHash).toBe("hash-before");
    expect(event.afterStateHash).toBe("hash-after");
  });

  it("creates event with adjustments and lesson tracking", () => {
    const event = createEconomicLearningEvent({
      idempotencyKey: "idem-2",
      outcomeId: "outcome-2",
      sellerId: "seller-2",
      planId: "plan-2",
      attributionId: "attr-2",
      targetNodeIds: ["n-1", "n-2"],
      targetEdgeIds: ["e-1"],
      adjustments: [
        { nodeId: "n-1", delta: 0.05, targetType: "node", beforeValue: 0.5, afterValue: 0.55 },
        { nodeId: "e-1", delta: -0.1, targetType: "edge", beforeValue: 0.8, afterValue: 0.7 },
      ],
      lessonsCreated: ["lesson-1", "lesson-2"],
      beforeStateHash: "abc",
      afterStateHash: "def",
      status: "processed",
      metadata: { source: "test" },
      reinforcementPolicyVersion: "1.0.0",
    });

    expect(event.adjustments).toHaveLength(2);
    expect(event.adjustments[0]!.nodeId).toBe("n-1");
    expect(event.adjustments[0]!.beforeValue).toBe(0.5);
    expect(event.adjustments[0]!.afterValue).toBe(0.55);
    expect(event.lessonsCreated).toEqual(["lesson-1", "lesson-2"]);
  });
});
