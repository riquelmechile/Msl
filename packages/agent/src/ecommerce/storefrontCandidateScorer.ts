import type { StorefrontCandidate, StorefrontCandidateScore } from "@msl/domain";

// ── Public types ─────────────────────────────────────────────────────

/**
 * Simplified channel-comparison input consumed by the scorer.
 *
 * Callers pass the result of `AccountBrainService.compareAccountAssets`
 * (or a subset) so the scorer can account for channel fit without importing
 * the full AccountBrain layer.
 */
export type ChannelComparisonInput = {
  /** Seller ID that AccountBrain recommends for this opportunity. */
  recommendedSellerId: string | null;
  /** Confidence of the recommendation. */
  confidence: "high" | "medium" | "low";
};

// ── Pure scorer ──────────────────────────────────────────────────────

/**
 * Deterministic, pure-function candidate scorer.
 *
 * Evaluates a {@link StorefrontCandidate} against stock, margin, evidence
 * freshness, guardrail-blocked reasons, and an optional channel-comparison
 * signal from AccountBrain.  Produces a 0–100 score with explicit blockers,
 * warnings, strengths, and a recommended action.
 *
 * **Blocking rules** (action = `"do-not-publish"`):
 * - Stock `"out-of-stock"` or `"unknown"` with no quantity.
 * - Missing or ≤0 margin.
 * - Any `blockedReasons` present from upstream guardrails.
 *
 * **Degraded rules**:
 * - Stale / unknown evidence → `"collect-more-evidence"`.
 * - Incomplete evidence (likely missing images / creative assets) →
 *   `"request-creative-assets"`.
 *
 * @param candidate — The storefront candidate to score.
 * @param channelComparison — Optional AccountBrain channel recommendation.
 * @returns A {@link StorefrontCandidateScore} with score, confidence,
 *   blockers, warnings, strengths, missingEvidence, and recommendedAction.
 */
export function scoreCandidate(
  candidate: StorefrontCandidate,
  channelComparison?: ChannelComparisonInput,
): StorefrontCandidateScore {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const strengths: string[] = [];

  let score = 50;
  let hasBlockingCondition = false;

  // ── Stock scoring ──────────────────────────────────────────────

  switch (candidate.stock.status) {
    case "out-of-stock": {
      blockers.push("Out of stock — cannot publish");
      score -= 40;
      hasBlockingCondition = true;
      break;
    }
    case "low-stock": {
      warnings.push("Low stock — review before publishing");
      score -= 10;
      break;
    }
    case "in-stock": {
      strengths.push("Stock available");
      score += 15;
      break;
    }
    case "unknown": {
      warnings.push("Stock status unknown — verify before publishing");
      score -= 15;
      break;
    }
  }

  // ── Margin scoring ─────────────────────────────────────────────

  if (!candidate.margin || candidate.margin.value === undefined) {
    blockers.push("No margin data — cannot publish");
    score -= 30;
    hasBlockingCondition = true;
  } else if (candidate.margin.value <= 0) {
    blockers.push("Non-positive margin — cannot publish");
    score -= 30;
    hasBlockingCondition = true;
  } else {
    strengths.push("Positive margin confirmed");
    score += 10;
  }

  // ── Evidence freshness ─────────────────────────────────────────

  const missingEvidence: string[] = [];

  if (candidate.evidenceState.stockFreshness !== "fresh") {
    missingEvidence.push("stock-evidence");
    warnings.push("Stock evidence is stale or unknown");
    score -= 10;
  }

  if (candidate.evidenceState.marginFreshness !== "fresh") {
    missingEvidence.push("margin-evidence");
    warnings.push("Margin evidence is stale or unknown");
    score -= 10;
  }

  if (candidate.evidenceState.supplierFreshness !== "fresh") {
    missingEvidence.push("supplier-evidence");
    warnings.push("Supplier evidence is stale");
    score -= 5;
  }

  if (candidate.evidenceState.completeness !== "complete") {
    missingEvidence.push("evidence-completeness");
    warnings.push("Evidence is incomplete — potential missing images or media assets");
    score -= 5;
  }

  // ── Guardrail-blocked reasons ──────────────────────────────────

  if (candidate.blockedReasons.length > 0) {
    for (const reason of candidate.blockedReasons) {
      blockers.push(reason);
    }
    score -= 20;
    hasBlockingCondition = true;
  }

  // ── Reputation / risk ──────────────────────────────────────────

  if (candidate.redactedReasons.length > 0) {
    warnings.push("Reputation or risk issues flagged");
    score -= 15;
  }

  // ── AccountBrain channel fit ───────────────────────────────────

  if (channelComparison) {
    const isRecommended =
      channelComparison.recommendedSellerId !== null &&
      (candidate.provenance.accountId === channelComparison.recommendedSellerId ||
        candidate.provenance.supplierId === channelComparison.recommendedSellerId);

    if (isRecommended) {
      strengths.push(`Channel fit: recommended seller ${channelComparison.recommendedSellerId}`);
      score += 10;
    }
  }

  // ── Recommended action ─────────────────────────────────────────

  let recommendedAction: string;

  if (hasBlockingCondition) {
    recommendedAction = "do-not-publish";
  } else if (
    missingEvidence.some(
      (e) => e === "stock-evidence" || e === "margin-evidence" || e === "supplier-evidence",
    )
  ) {
    recommendedAction = "collect-more-evidence";
  } else if (missingEvidence.includes("evidence-completeness")) {
    recommendedAction = "request-creative-assets";
  } else if (score >= 70) {
    recommendedAction = "prepare-storefront-projection";
  } else if (warnings.length > 0) {
    recommendedAction = "review-storefront-availability";
  } else {
    recommendedAction = "prepare-storefront-projection";
  }

  // ── Clamp + confidence ─────────────────────────────────────────

  score = Math.max(0, Math.min(100, score));

  const confidence = hasBlockingCondition
    ? "low"
    : missingEvidence.length === 0 && warnings.length === 0
      ? "high"
      : "medium";

  return {
    score,
    confidence,
    blockers,
    warnings,
    strengths,
    missingEvidence,
    recommendedAction,
  };
}
