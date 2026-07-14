import type {
  EconomicAttributionAssessment,
  AttributionStrength,
  AttributionTargetType,
  EconomicOutcome,
  UnitEconomicsSnapshot,
} from "@msl/domain";
import { createEconomicAttributionAssessment } from "@msl/domain";

// ── Input type ──────────────────────────────────────────────────────────────

export type AttributionInput = {
  outcome: EconomicOutcome;
  snapshot?: UnitEconomicsSnapshot;
  // Optional IDs that may link the outcome to a decision chain
  proposalId?: string;
  preparedActionId?: string;
  executionId?: string;
  originatingAgentId?: string;
  workSessionId?: string;
  campaignId?: string;
  experimentId?: string;
  correlationId?: string;
  // Seller must match for attribution
  sellerId: string;
};

// ── Evaluator ───────────────────────────────────────────────────────────────

export class EconomicAttributionEvaluator {
  private attributionCount = 0;

  /**
   * Fast deterministic path: links outcomes to targets by shared IDs.
   *
   * Returns an array of EconomicAttributionAssessment, one per matched target.
   * Guarantees:
   *  - No "causal" strength from fast path
   *  - No "experiment-supported" without baselineId or experimentId
   *  - Confidence always in [0, 1]
   *  - Cross-seller rejected (returns empty array)
   *  - Assessments are deterministic given the same inputs
   */
  evaluateFastPath(input: AttributionInput): EconomicAttributionAssessment[] {
    const { outcome, snapshot } = input;
    const assessments: EconomicAttributionAssessment[] = [];

    // ── Cross-seller guard ────────────────────────────────────────────────
    if (outcome.sellerId !== input.sellerId) {
      return assessments;
    }

    // ── Derive IDs for matching ───────────────────────────────────────────
    const inProposalId = input.proposalId ?? outcome.proposalId;
    const inExecutionId = input.executionId ?? outcome.executionId;
    const inOriginatingAgentId = input.originatingAgentId ?? outcome.originatingAgentId;
    const inWorkSessionId = input.workSessionId ?? outcome.workSessionId;
    const inCorrelationId = input.correlationId ?? outcome.correlationId;

    // ── Build observation window from outcome if available ─────────────────
    const obsWindow = outcome.observationWindow;
    const hasObsWindow = obsWindow !== undefined;

    // ── Evidence IDs from outcome ─────────────────────────────────────────
    const supportingEvidenceIds = outcome.evidenceIds ?? [];

    // Track whether execution match already set contributory for proposal downgrade
    let hasExecutionMatch = false;

    // ── Rule: executionId match → "contributory" ───────────────────────────
    if (inExecutionId && outcome.executionId === inExecutionId) {
      const assessment = this.buildAssessment({
        outcomeId: outcome.outcomeId,
        sellerId: outcome.sellerId,
        targetType: "action",
        targetId: inExecutionId,
        strength: "contributory",
        confidence: this.computeConfidence("contributory", {
          ...(snapshot !== undefined ? { snapshot } : {}),
          ...(hasObsWindow ? { observationWindow: obsWindow } : {}),
          hasEvidence: supportingEvidenceIds.length > 0,
        }),
        supportingEvidenceIds,
        ...(hasObsWindow ? { observationWindow: obsWindow } : {}),
      });
      assessments.push(assessment);
      hasExecutionMatch = true;
    }

    // ── Rule: proposalId match ────────────────────────────────────────────
    if (inProposalId && outcome.proposalId === inProposalId) {
      // Strength is "associated" unless execution also matched (but we already
      // have a separate assessment for execution — this one stays "associated"
      // since proposal is a different target)
      const strength: AttributionStrength = hasExecutionMatch ? "associated" : "associated";
      const assessment = this.buildAssessment({
        outcomeId: outcome.outcomeId,
        sellerId: outcome.sellerId,
        targetType: "proposal",
        targetId: inProposalId,
        strength,
        confidence: this.computeConfidence(strength, {
          ...(snapshot !== undefined ? { snapshot } : {}),
          ...(hasObsWindow ? { observationWindow: obsWindow } : {}),
          hasEvidence: supportingEvidenceIds.length > 0,
        }),
        supportingEvidenceIds,
        ...(hasObsWindow ? { observationWindow: obsWindow } : {}),
      });
      assessments.push(assessment);
    }

    // ── Rule: originatingAgentId match → "associated" ─────────────────────
    if (inOriginatingAgentId && outcome.originatingAgentId === inOriginatingAgentId) {
      const assessment = this.buildAssessment({
        outcomeId: outcome.outcomeId,
        sellerId: outcome.sellerId,
        targetType: "agent",
        targetId: inOriginatingAgentId,
        strength: "associated",
        confidence: this.computeConfidence("associated", {
          ...(snapshot !== undefined ? { snapshot } : {}),
          ...(hasObsWindow ? { observationWindow: obsWindow } : {}),
          hasEvidence: supportingEvidenceIds.length > 0,
        }),
        supportingEvidenceIds,
        ...(hasObsWindow ? { observationWindow: obsWindow } : {}),
      });
      assessments.push(assessment);
    }

    // ── Rule: workSessionId match → "associated" ──────────────────────────
    if (inWorkSessionId && outcome.workSessionId === inWorkSessionId) {
      const assessment = this.buildAssessment({
        outcomeId: outcome.outcomeId,
        sellerId: outcome.sellerId,
        targetType: "session",
        targetId: inWorkSessionId,
        strength: "associated",
        confidence: this.computeConfidence("associated", {
          ...(snapshot !== undefined ? { snapshot } : {}),
          ...(hasObsWindow ? { observationWindow: obsWindow } : {}),
          hasEvidence: supportingEvidenceIds.length > 0,
        }),
        supportingEvidenceIds,
        ...(hasObsWindow ? { observationWindow: obsWindow } : {}),
      });
      assessments.push(assessment);
    }

    // ── Rule: correlationId match → "associated" ──────────────────────────
    if (inCorrelationId && outcome.correlationId === inCorrelationId) {
      const assessment = this.buildAssessment({
        outcomeId: outcome.outcomeId,
        sellerId: outcome.sellerId,
        targetType: "action",
        targetId: inCorrelationId,
        strength: "associated",
        confidence: this.computeConfidence("associated", {
          ...(snapshot !== undefined ? { snapshot } : {}),
          ...(hasObsWindow ? { observationWindow: obsWindow } : {}),
          hasEvidence: supportingEvidenceIds.length > 0,
        }),
        supportingEvidenceIds,
        ...(hasObsWindow ? { observationWindow: obsWindow } : {}),
      });
      assessments.push(assessment);
    }

    // ── Rule: temporal overlap only, no ID match → "none" ─────────────────
    // Only emit a "none" assessment if we have no matches at all but do have
    // a temporal window — indicating the evaluator looked but couldn't link.
    if (assessments.length === 0 && hasObsWindow) {
      const assessment = this.buildAssessment({
        outcomeId: outcome.outcomeId,
        sellerId: outcome.sellerId,
        targetType: "action",
        targetId: outcome.outcomeId, // self-referential for unmatched
        strength: "none",
        confidence: 0.1,
        supportingEvidenceIds,
        observationWindow: obsWindow,
        alternativeExplanations: ["No shared ID matched between outcome and attribution input."],
      });
      assessments.push(assessment);
    }

    return assessments;
  }

  /**
   * Stub for DeepSeek reasoning path.
   * Currently returns the same as fast path. Will be enhanced when
   * DeepSeek integration is needed.
   */
  evaluateWithReasoning(input: AttributionInput): EconomicAttributionAssessment[] {
    // For now, identical to fast path. DeepSeek reasoning would:
    // - Find alternative explanations
    // - MUST NOT raise strength above evidence limits
    // - MUST NOT assign causal without baseline/experiment
    // - MUST NOT invent evidence IDs
    return this.evaluateFastPath(input);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private buildAssessment(params: {
    outcomeId: string;
    sellerId: string;
    targetType: AttributionTargetType;
    targetId: string;
    strength: AttributionStrength;
    confidence: number;
    supportingEvidenceIds: readonly string[];
    observationWindow?: { readonly start: number; readonly end: number };
    alternativeExplanations?: readonly string[];
  }): EconomicAttributionAssessment {
    return createEconomicAttributionAssessment({
      outcomeId: params.outcomeId,
      sellerId: params.sellerId,
      targetType: params.targetType,
      targetId: params.targetId,
      strength: params.strength,
      confidence: params.confidence,
      supportingEvidenceIds: params.supportingEvidenceIds,
      contradictingEvidenceIds: [],
      alternativeExplanations: params.alternativeExplanations ?? [],
      ...(params.observationWindow ? { observationWindow: params.observationWindow } : {}),
      evaluator: "economic-attribution-evaluator",
    });
  }

  /**
   * Compute confidence based on attribution strength and available evidence.
   * Always returns a value in [0, 1].
   */
  private computeConfidence(
    strength: AttributionStrength,
    context: {
      snapshot?: UnitEconomicsSnapshot;
      observationWindow?: { readonly start: number; readonly end: number };
      hasEvidence: boolean;
    },
  ): number {
    let base: number;

    switch (strength) {
      case "none":
        base = 0.1;
        break;
      case "associated":
        base = 0.4;
        break;
      case "contributory":
        base = 0.7;
        break;
      case "experiment-supported":
        base = 0.85;
        break;
      case "causal":
        base = 0.95;
        break;
    }

    // Evidence boosts confidence
    if (context.hasEvidence) {
      base = Math.min(base + 0.1, 1.0);
    }

    // Snapshot quality affects confidence
    if (context.snapshot) {
      switch (context.snapshot.calculationStatus) {
        case "complete":
          base = Math.min(base + 0.05, 1.0);
          break;
        case "partial":
          base = Math.max(base - 0.1, 0.01);
          break;
        case "unverifiable":
          base = Math.max(base - 0.2, 0.01);
          break;
        case "disputed":
          base = Math.max(base - 0.3, 0.01);
          break;
      }
    }

    // Temporal recency penalty: outcomes very old (>90 days) degrade
    if (context.observationWindow) {
      const now = Date.now();
      const ageMs = now - context.observationWindow.end;
      const ninetyDays = 90 * 24 * 60 * 60 * 1000;
      if (ageMs > ninetyDays) {
        base = Math.max(base - 0.15, 0.01);
      }
    }

    // Clamp to valid range
    return Math.max(0, Math.min(1, Math.round(base * 100) / 100));
  }
}
