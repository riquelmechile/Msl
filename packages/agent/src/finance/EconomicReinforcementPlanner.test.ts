import { describe, expect, it } from "vitest";
import { createEconomicOutcome, transitionOutcome } from "@msl/domain";
import type {
  EconomicOutcome,
  EconomicSignal,
  EconomicAttributionAssessment,
  AttributionStrength,
} from "@msl/domain";
import { EconomicReinforcementPlanner } from "./EconomicReinforcementPlanner.js";
import type { PlannerInput } from "./EconomicReinforcementPlanner.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeVerifiedOutcome(overrides: Partial<EconomicOutcome> = {}): EconomicOutcome {
  const base = createEconomicOutcome({
    sellerId: "plasticov",
  });
  const observed = transitionOutcome(base, "observing");
  const verified = transitionOutcome(observed, "observed");
  return { ...verified, ...overrides };
}

function makeSignal(overrides: Partial<EconomicSignal> = {}): EconomicSignal {
  return {
    direction: "positive",
    magnitude: 0.5,
    confidence: 0.8,
    reasonCodes: ["positive-net-profit", "calc-complete"],
    sourceValues: {
      netProfit: 50000,
      grossRevenue: 100000,
      contributionProfit: 50000,
      netMargin: 0.5,
      contributionMargin: 0.5,
    },
    ...overrides,
  };
}

function makeAttribution(
  strength: AttributionStrength,
  overrides: Partial<EconomicAttributionAssessment> = {},
): EconomicAttributionAssessment {
  return {
    attributionId: `attr-${Math.random().toString(36).slice(2, 6)}`,
    outcomeId: "outcome-1",
    sellerId: "plasticov",
    targetType: "action",
    targetId: "exec-1",
    strength,
    confidence: strength === "none" ? 0.1 : strength === "associated" ? 0.4 : strength === "contributory" ? 0.7 : 0.85,
    supportingEvidenceIds: ["ev-1"],
    contradictingEvidenceIds: [],
    alternativeExplanations: [],
    evaluator: "test",
    createdAt: Date.now(),
    noMutationExecuted: true as const,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("EconomicReinforcementPlanner", () => {
  // ── 1. strength "none" → no adjustments ────────────────────────────────

  it('strength "none" produces no adjustments', () => {
    const planner = new EconomicReinforcementPlanner();
    const outcome = makeVerifiedOutcome();
    const signal = makeSignal();

    const input: PlannerInput = {
      outcome,
      signal,
      attributions: [makeAttribution("none")],
      activatedNodeIds: ["node-1"],
    };

    const plan = planner.createPlan(input);

    expect(plan.proposedAdjustments).toHaveLength(0);
    expect(plan.blockedTargets.length).toBeGreaterThanOrEqual(1);
    expect(plan.attributionStrength).toBe("none");
    expect(plan.noExternalMutationExecuted).toBe(true);
  });

  // ── 2. strength "associated" → episodic lesson only, no edges ──────────

  it('strength "associated" produces episodic lesson only, no edge adjustments', () => {
    const planner = new EconomicReinforcementPlanner();
    const outcome = makeVerifiedOutcome();
    const signal = makeSignal();

    const input: PlannerInput = {
      outcome,
      signal,
      attributions: [makeAttribution("associated")],
    };

    const plan = planner.createPlan(input);

    expect(plan.lessonCandidates.length).toBeGreaterThanOrEqual(1);
    expect(plan.lessonCandidates[0]!.type).toBe("episodic");
    expect(plan.proposedAdjustments).toHaveLength(0);
    expect(plan.targetEdges).toHaveLength(0);
    expect(plan.noExternalMutationExecuted).toBe(true);
  });

  // ── 3. strength "contributory" → moderate delta ────────────────────────

  it('strength "contributory" produces moderate delta', () => {
    const planner = new EconomicReinforcementPlanner();
    const outcome = makeVerifiedOutcome();
    const signal = makeSignal({ magnitude: 0.5, direction: "positive" });

    const input: PlannerInput = {
      outcome,
      signal,
      attributions: [makeAttribution("contributory")],
      activatedNodeIds: ["node-1"],
    };

    const plan = planner.createPlan(input);

    expect(plan.proposedAdjustments.length).toBeGreaterThanOrEqual(1);
    const adj = plan.proposedAdjustments[0]!;
    // delta = 0.5 * 0.1 * 1 = 0.05
    expect(adj.delta).toBeGreaterThan(0);
    expect(adj.delta).toBeLessThanOrEqual(0.1);
    expect(adj.targetType).toBe("node");
    expect(plan.attributionStrength).toBe("contributory");
  });

  // ── 4. strength "experiment-supported" → larger delta ─────────────────

  it('strength "experiment-supported" produces larger delta', () => {
    const planner = new EconomicReinforcementPlanner();
    const outcome = makeVerifiedOutcome();
    const signal = makeSignal({ magnitude: 0.8, direction: "positive" });

    const input: PlannerInput = {
      outcome,
      signal,
      attributions: [makeAttribution("experiment-supported")],
      activatedNodeIds: ["node-1"],
    };

    const plan = planner.createPlan(input);

    expect(plan.proposedAdjustments.length).toBeGreaterThanOrEqual(1);
    const adj = plan.proposedAdjustments[0]!;
    // delta = 0.8 * 0.2 * 1 = 0.16
    expect(adj.delta).toBeGreaterThan(0);
    expect(adj.delta).toBeLessThanOrEqual(0.2);
    expect(plan.attributionStrength).toBe("experiment-supported");
  });

  // ── 5. strength "causal" → max delta but capped ───────────────────────

  it('strength "causal" produces max delta but capped at maxMagnitude', () => {
    const planner = new EconomicReinforcementPlanner();
    const outcome = makeVerifiedOutcome();
    const signal = makeSignal({ magnitude: 1.0, direction: "positive" });

    const input: PlannerInput = {
      outcome,
      signal,
      attributions: [makeAttribution("causal")],
      activatedNodeIds: ["node-1"],
    };

    const plan = planner.createPlan(input);

    expect(plan.proposedAdjustments.length).toBeGreaterThanOrEqual(1);
    const adj = plan.proposedAdjustments[0]!;
    // delta = 1.0 * 0.3 * 1 = 0.3, but capped at maxMagnitude (0.3)
    expect(adj.delta).toBeCloseTo(0.3);
    expect(plan.attributionStrength).toBe("causal");
  });

  // ── 6. negative signal → negative delta ────────────────────────────────

  it("negative signal produces negative delta", () => {
    const planner = new EconomicReinforcementPlanner();
    const outcome = makeVerifiedOutcome();
    const signal = makeSignal({ magnitude: 0.5, direction: "negative" });

    const input: PlannerInput = {
      outcome,
      signal,
      attributions: [makeAttribution("contributory")],
      activatedNodeIds: ["node-1"],
    };

    const plan = planner.createPlan(input);

    expect(plan.proposedAdjustments.length).toBeGreaterThanOrEqual(1);
    const adj = plan.proposedAdjustments[0]!;
    expect(adj.delta).toBeLessThan(0);
  });

  // ── 7. neutral signal → no adjustments ────────────────────────────────

  it("neutral signal produces no adjustments even for contributory", () => {
    const planner = new EconomicReinforcementPlanner();
    const outcome = makeVerifiedOutcome();
    const signal = makeSignal({ direction: "neutral" });

    const input: PlannerInput = {
      outcome,
      signal,
      attributions: [makeAttribution("contributory")],
      activatedNodeIds: ["node-1"],
    };

    const plan = planner.createPlan(input);

    expect(plan.proposedAdjustments).toHaveLength(0);
  });

  // ── 8. magnitude cap enforced ─────────────────────────────────────────

  it("magnitude cap enforced — delta never exceeds config.maxMagnitude", () => {
    const planner = new EconomicReinforcementPlanner({ maxMagnitude: 0.15 });
    const outcome = makeVerifiedOutcome();
    const signal = makeSignal({ magnitude: 1.0, direction: "positive" });

    const input: PlannerInput = {
      outcome,
      signal,
      attributions: [makeAttribution("causal")],
      activatedNodeIds: ["node-1"],
    };

    const plan = planner.createPlan(input);

    for (const adj of plan.proposedAdjustments) {
      expect(Math.abs(adj.delta)).toBeLessThanOrEqual(0.15);
    }
  });

  // ── 9. plan has noExternalMutationExecuted: true ──────────────────────

  it("every plan has noExternalMutationExecuted: true", () => {
    const planner = new EconomicReinforcementPlanner();
    const outcome = makeVerifiedOutcome();

    const strengths: AttributionStrength[] = [
      "none",
      "associated",
      "contributory",
      "experiment-supported",
      "causal",
    ];

    for (const strength of strengths) {
      const input: PlannerInput = {
        outcome,
        signal: makeSignal(),
        attributions: [makeAttribution(strength)],
      };

      const plan = planner.createPlan(input);
      expect(
        plan.noExternalMutationExecuted,
        `expected noExternalMutationExecuted=true for strength=${strength}`,
      ).toBe(true);
    }
  });

  // ── 10. policy versions stamped ───────────────────────────────────────

  it("policy versions are stamped on every plan", () => {
    const planner = new EconomicReinforcementPlanner({
      reinforcementPolicyVersion: "2.0.0",
      attributionPolicyVersion: "1.5.0",
      signalPolicyVersion: "3.1.0",
    });
    const outcome = makeVerifiedOutcome();

    const input: PlannerInput = {
      outcome,
      signal: makeSignal(),
      attributions: [makeAttribution("contributory")],
    };

    const plan = planner.createPlan(input);

    expect(plan.reinforcementPolicyVersion).toBe("2.0.0");
    expect(plan.attributionPolicyVersion).toBe("1.5.0");
    expect(plan.signalPolicyVersion).toBe("3.1.0");
  });

  // ── Additional: edge adjustments when edge IDs provided ────────────────

  it("edge adjustments are created when activatedEdgeIds provided", () => {
    const planner = new EconomicReinforcementPlanner();
    const outcome = makeVerifiedOutcome();
    const signal = makeSignal({ direction: "positive", magnitude: 0.8 });

    const input: PlannerInput = {
      outcome,
      signal,
      attributions: [makeAttribution("contributory")],
      activatedNodeIds: [],
      activatedEdgeIds: ["edge-1", "edge-2"],
    };

    const plan = planner.createPlan(input);

    const edgeAdjustments = plan.proposedAdjustments.filter(
      (a) => a.targetType === "edge",
    );
    expect(edgeAdjustments).toHaveLength(2);
    for (const adj of edgeAdjustments) {
      expect(adj.targetType).toBe("edge");
    }
  });

  // ── Additional: lesson confidence bounded ──────────────────────────────

  it("lesson confidence is always in [0, 1]", () => {
    const planner = new EconomicReinforcementPlanner();
    const outcome = makeVerifiedOutcome();
    const signal = makeSignal({
      confidence: 1.5, // unrealistic, but should be clamped
    });

    const input: PlannerInput = {
      outcome,
      signal,
      attributions: [makeAttribution("associated")],
    };

    const plan = planner.createPlan(input);

    for (const lesson of plan.lessonCandidates) {
      expect(lesson.confidence).toBeGreaterThanOrEqual(0);
      expect(lesson.confidence).toBeLessThanOrEqual(1);
    }
  });

  // ── Additional: lesson scope is seller-scoped ──────────────────────────

  it("lesson scope is seller-scoped", () => {
    const planner = new EconomicReinforcementPlanner();
    const outcome = makeVerifiedOutcome({ sellerId: "plasticov" });
    const signal = makeSignal();

    const input: PlannerInput = {
      outcome,
      signal,
      attributions: [makeAttribution("contributory")],
    };

    const plan = planner.createPlan(input);

    for (const lesson of plan.lessonCandidates) {
      expect(lesson.scope).toContain("seller:");
    }
  });

  // ── Additional: multiple attributions aggregate strength correctly ─────

  it("aggregates the highest strength from multiple attributions", () => {
    const planner = new EconomicReinforcementPlanner();
    const outcome = makeVerifiedOutcome();
    const signal = makeSignal({ direction: "positive", magnitude: 0.5 });

    const input: PlannerInput = {
      outcome,
      signal,
      attributions: [
        makeAttribution("associated"),
        makeAttribution("contributory"),
        makeAttribution("none"),
      ],
      activatedNodeIds: ["node-1"],
    };

    const plan = planner.createPlan(input);
    // contributory is highest among these
    expect(plan.attributionStrength).toBe("contributory");
    expect(plan.proposedAdjustments.length).toBeGreaterThanOrEqual(1);
  });

  // ── Additional: plan status is always "proposed" ───────────────────────

  it("plan status is always proposed", () => {
    const planner = new EconomicReinforcementPlanner();
    const outcome = makeVerifiedOutcome();

    const strengths: AttributionStrength[] = ["none", "associated", "contributory", "causal"];

    for (const strength of strengths) {
      const input: PlannerInput = {
        outcome,
        signal: makeSignal(),
        attributions: [makeAttribution(strength)],
      };

      const plan = planner.createPlan(input);
      expect(plan.status).toBe("proposed");
    }
  });
});
