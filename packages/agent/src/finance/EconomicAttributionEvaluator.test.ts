import { describe, expect, it } from "vitest";
import { createEconomicOutcome, transitionOutcome } from "@msl/domain";
import type { EconomicOutcome } from "@msl/domain";
import { EconomicAttributionEvaluator } from "./EconomicAttributionEvaluator.js";
import type { AttributionInput } from "./EconomicAttributionEvaluator.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeVerifiedOutcome(overrides: Partial<EconomicOutcome> = {}): EconomicOutcome {
  const base = createEconomicOutcome({
    sellerId: "plasticov",
  });
  const observed = transitionOutcome(base, "observing");
  const verified = transitionOutcome(observed, "observed");
  return { ...verified, ...overrides, evidenceIds: overrides.evidenceIds ?? ["ev-1", "ev-2"] };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("EconomicAttributionEvaluator", () => {
  const evaluator = new EconomicAttributionEvaluator();

  // ── 1. matching executionId → contributory strength ────────────────────

  it("matching executionId produces contributory strength", () => {
    const outcome = makeVerifiedOutcome({
      executionId: "exec-42",
    });

    const input: AttributionInput = {
      outcome,
      executionId: "exec-42",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.strength).toBe("contributory");
    expect(result[0]!.targetType).toBe("action");
    expect(result[0]!.targetId).toBe("exec-42");
    expect(result[0]!.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result[0]!.confidence).toBeLessThanOrEqual(1);
  });

  // ── 2. matching proposalId only → associated ──────────────────────────

  it("matching proposalId only produces associated strength", () => {
    const outcome = makeVerifiedOutcome({
      proposalId: "prop-7",
    });

    const input: AttributionInput = {
      outcome,
      proposalId: "prop-7",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.strength).toBe("associated");
    expect(result[0]!.targetType).toBe("proposal");
    expect(result[0]!.targetId).toBe("prop-7");
  });

  // ── 3. matching originatingAgentId → associated ───────────────────────

  it("matching originatingAgentId produces associated strength", () => {
    const outcome = makeVerifiedOutcome({
      originatingAgentId: "agent-finance-director",
    });

    const input: AttributionInput = {
      outcome,
      originatingAgentId: "agent-finance-director",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.strength).toBe("associated");
    expect(result[0]!.targetType).toBe("agent");
    expect(result[0]!.targetId).toBe("agent-finance-director");
  });

  // ── 4. matching workSessionId → associated ────────────────────────────

  it("matching workSessionId produces associated strength", () => {
    const outcome = makeVerifiedOutcome({
      workSessionId: "session-2025-07",
    });

    const input: AttributionInput = {
      outcome,
      workSessionId: "session-2025-07",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.strength).toBe("associated");
    expect(result[0]!.targetType).toBe("session");
    expect(result[0]!.targetId).toBe("session-2025-07");
  });

  // ── 5. matching correlationId → associated ────────────────────────────

  it("matching correlationId produces associated strength", () => {
    const outcome = makeVerifiedOutcome({
      correlationId: "corr-abc",
    });

    const input: AttributionInput = {
      outcome,
      correlationId: "corr-abc",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.strength).toBe("associated");
    expect(result[0]!.targetType).toBe("action");
    expect(result[0]!.targetId).toBe("corr-abc");
  });

  // ── 6. multiple matches → one assessment per match ────────────────────

  it("multiple matches produce one assessment per match", () => {
    const outcome = makeVerifiedOutcome({
      executionId: "exec-99",
      proposalId: "prop-99",
      originatingAgentId: "agent-99",
    });

    const input: AttributionInput = {
      outcome,
      executionId: "exec-99",
      proposalId: "prop-99",
      originatingAgentId: "agent-99",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    expect(result.length).toBeGreaterThanOrEqual(3);

    // Should have assessments for execution, proposal, and agent
    const targetTypes = result.map((a) => a.targetType);
    expect(targetTypes).toContain("action");
    expect(targetTypes).toContain("proposal");
    expect(targetTypes).toContain("agent");
  });

  // ── 7. no matches → empty array ───────────────────────────────────────

  it("no matches returns empty array when no observation window", () => {
    const outcome = makeVerifiedOutcome({
      executionId: "exec-1",
      proposalId: "prop-2",
    });

    const input: AttributionInput = {
      outcome,
      // Different IDs — no match
      executionId: "exec-different",
      proposalId: "prop-different",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    // No matches + no observation window → empty
    // Actually, we check: outcome.executionId IS NOT equal to input.executionId,
    // because input.executionId overrides. So no match.
    // But we also check outcome IDs when input is not provided...
    // Wait, in the implementation, we derive IDs with ?? outcome.X
    // So if input.executionId is "exec-different", inExecutionId = "exec-different"
    // And outcome.executionId IS "exec-1", so "exec-different" !== "exec-1" → no match
    expect(result).toHaveLength(0);
  });

  it("no matches with observation window produces none-strength assessment", () => {
    const outcome = makeVerifiedOutcome({
      executionId: "exec-1",
      observationWindow: { start: Date.now() - 86400000, end: Date.now() },
    });

    const input: AttributionInput = {
      outcome,
      executionId: "exec-different",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.strength).toBe("none");
    expect(result[0]!.confidence).toBe(0.1);
  });

  // ── 8. cross-seller → rejects ─────────────────────────────────────────

  it("cross-seller mismatch returns empty array", () => {
    const outcome = makeVerifiedOutcome({
      sellerId: "plasticov",
      executionId: "exec-5",
    });

    const input: AttributionInput = {
      outcome,
      executionId: "exec-5",
      sellerId: "maustian", // different seller!
    };

    const result = evaluator.evaluateFastPath(input);
    expect(result).toHaveLength(0);
  });

  // ── 9. factory data from createEconomicOutcome ────────────────────────

  it("works with createEconomicOutcome factory data", () => {
    const outcome = createEconomicOutcome({
      sellerId: "plasticov",
      executionId: "exec-factory",
      proposalId: "prop-factory",
    });

    // Transition to observed so we have a meaningful outcome
    const observed = transitionOutcome(outcome, "observing");
    const verified = transitionOutcome(observed, "observed");

    const input: AttributionInput = {
      outcome: verified,
      executionId: "exec-factory",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.targetId).toBe("exec-factory");
    expect(result[0]!.sellerId).toBe("plasticov");
    expect(result[0]!.outcomeId).toBe(outcome.outcomeId);
  });

  // ── 10. strength is never "causal" from fast path ─────────────────────

  it("strength is never causal from fast path", () => {
    const outcome = makeVerifiedOutcome({
      executionId: "exec-causal",
    });

    const input: AttributionInput = {
      outcome,
      executionId: "exec-causal",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    for (const assessment of result) {
      expect(assessment.strength).not.toBe("causal");
    }
  });

  // ── 11. strength is never "experiment-supported" without baseline ──────

  it("strength is never experiment-supported from fast path", () => {
    const outcome = makeVerifiedOutcome({
      executionId: "exec-exp",
    });

    const input: AttributionInput = {
      outcome,
      executionId: "exec-exp",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    for (const assessment of result) {
      expect(assessment.strength).not.toBe("experiment-supported");
    }
  });

  // ── 12. confidence is never > 1 or < 0 ────────────────────────────────

  it("confidence is always in valid range [0, 1]", () => {
    const outcome = makeVerifiedOutcome({
      executionId: "exec-conf",
      proposalId: "prop-conf",
      originatingAgentId: "agent-conf",
      workSessionId: "sess-conf",
      correlationId: "corr-conf",
    });

    const input: AttributionInput = {
      outcome,
      executionId: "exec-conf",
      proposalId: "prop-conf",
      originatingAgentId: "agent-conf",
      workSessionId: "sess-conf",
      correlationId: "corr-conf",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    expect(result.length).toBeGreaterThan(0);

    for (const assessment of result) {
      expect(assessment.confidence).toBeGreaterThanOrEqual(0);
      expect(assessment.confidence).toBeLessThanOrEqual(1);
    }
  });

  // ── Additional: evidence IDs are captured ─────────────────────────────

  it("captures supporting evidence IDs from outcome", () => {
    const outcome = makeVerifiedOutcome({
      executionId: "exec-evid",
      evidenceIds: ["ev-alpha", "ev-beta"],
    });

    const input: AttributionInput = {
      outcome,
      executionId: "exec-evid",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.supportingEvidenceIds).toContain("ev-alpha");
    expect(result[0]!.supportingEvidenceIds).toContain("ev-beta");
  });

  // ── Additional: attributions have unique IDs ──────────────────────────

  it("each assessment has a unique attributionId", () => {
    const outcome = makeVerifiedOutcome({
      executionId: "exec-uniq",
      proposalId: "prop-uniq",
      originatingAgentId: "agent-uniq",
    });

    const input: AttributionInput = {
      outcome,
      executionId: "exec-uniq",
      proposalId: "prop-uniq",
      originatingAgentId: "agent-uniq",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    const ids = result.map((a) => a.attributionId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  // ── Additional: no mutation flag is always true ───────────────────────

  it("every assessment has noMutationExecuted: true", () => {
    const outcome = makeVerifiedOutcome({
      executionId: "exec-nomut",
    });

    const input: AttributionInput = {
      outcome,
      executionId: "exec-nomut",
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    for (const assessment of result) {
      expect(assessment.noMutationExecuted).toBe(true);
    }
  });

  // ── Additional: input IDs override outcome IDs ────────────────────────

  it("input IDs take precedence over outcome IDs", () => {
    const outcome = makeVerifiedOutcome({
      executionId: "exec-outcome-level",
    });

    const input: AttributionInput = {
      outcome,
      executionId: "exec-input-level", // overrides outcome's ID
      sellerId: "plasticov",
    };

    const result = evaluator.evaluateFastPath(input);
    // outcome has executionId "exec-outcome-level" but input says "exec-input-level"
    // No match because outcome.executionId !== input.executionId
    expect(result).toHaveLength(0);
  });
});
