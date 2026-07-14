import crypto from "node:crypto";
import type {
  AssessmentType,
  FinancialAssessment,
  FinancialRisk,
  MissingEvidence,
  Recommendation,
  Hypothesis,
  Opportunity,
} from "@msl/domain";
import type { FinanceDirectorEvidence } from "./FinanceDirectorEvidenceAssembler.js";

// ── Fallback ──────────────────────────────────────────────────────────────

export class FinanceDirectorFallback {
  /**
   * Builds a conservative, deterministic FinancialAssessment from available
   * evidence. Used when DeepSeek is unavailable or returns invalid output.
   *
   * Never invents data. Only reports what is directly observable in evidence.
   */
  buildFallbackAssessment(
    evidence: FinanceDirectorEvidence,
    objective: string,
    sellerId: string,
    assessmentType: AssessmentType,
  ): FinancialAssessment {
    const now = Date.now();

    // Extract facts directly from evidence (no inference)
    const verifiedFacts: string[] = [];

    // Snapshot facts
    for (const s of evidence.snapshots) {
      const missing = s.missingInputs.length > 0 ? ` missing=[${s.missingInputs.join(", ")}]` : "";
      verifiedFacts.push(
        `Snapshot ${s.snapshotId}: seller=${s.sellerId}, revenue=${s.grossRevenue} ${evidence.sellerCurrency}, ` +
          `netProfit=${s.netProfit}, margin=${(s.netMargin * 100).toFixed(1)}%, status=${s.calculationStatus}${missing}`,
      );
    }

    // Outcome facts
    for (const o of evidence.outcomes) {
      verifiedFacts.push(
        `Outcome ${o.outcomeId}: status=${o.status}, seller=${o.sellerId}, created=${new Date(o.createdAt).toISOString()}`,
      );
    }

    // Profit facts
    if (evidence.profitSummary) {
      verifiedFacts.push(
        `Profit: totalRevenue=${evidence.profitSummary.totalRevenue}, totalCosts=${evidence.profitSummary.totalCosts}, netProfit=${evidence.profitSummary.netProfit}, netMargin=${evidence.profitSummary.netMargin}`,
      );
    } else {
      verifiedFacts.push("No profit summary available.");
    }

    // Missing evidence as facts
    for (const m of evidence.missingInputs) {
      verifiedFacts.push(`Missing input: ${m}`);
    }

    // Build risks from missing inputs
    const risks: FinancialRisk[] = [];
    if (evidence.missingInputs.length > 0) {
      risks.push({
        description: `${evidence.missingInputs.length} cost inputs are missing: ${evidence.missingInputs.join(", ")}. Profitability cannot be accurately assessed.`,
        severity: evidence.missingInputs.length >= 5 ? "high" : "medium",
        probability: 0.7,
      });
    }
    if (evidence.snapshots.length === 0) {
      risks.push({
        description:
          "No unit economics snapshots available. Revenue and cost analysis is impossible.",
        severity: "critical",
        probability: 1.0,
      });
    }
    if (evidence.outcomes.length === 0 && assessmentType !== "account-health") {
      risks.push({
        description: `No economic outcomes available for assessment type "${assessmentType}".`,
        severity: "medium",
        probability: 0.5,
      });
    }

    // Confidence: based on data completeness
    const totalExpectedEvidence = 15; // from lane contract
    const availableKinds = new Set<string>();
    for (const s of evidence.snapshots) {
      if (s.productCost !== 0) availableKinds.add("product_cost");
      if (s.marketplaceFees !== 0) availableKinds.add("marketplace_fee");
      if (s.sellerShippingCost !== 0) availableKinds.add("shipping");
      if (s.advertisingCost !== 0) availableKinds.add("advertising");
      if (s.sellerFundedDiscounts !== 0) availableKinds.add("seller_discount");
      if (s.refunds !== 0) availableKinds.add("refund");
      if (s.taxes !== 0) availableKinds.add("tax");
      if (s.financingCost !== 0) availableKinds.add("financing");
      if (s.allocatedLandedCost !== 0) availableKinds.add("landed_cost");
      if (s.packagingCost !== 0) availableKinds.add("packaging");
      if (s.otherCosts !== 0) availableKinds.add("other");
    }
    availableKinds.add("profit-summary");
    if (evidence.outcomes.length > 0) availableKinds.add("economic-outcome");
    for (const m of evidence.missingInputs) availableKinds.add(m);

    const confidence = Math.min(1.0, Math.max(0.1, availableKinds.size / totalExpectedEvidence));

    // Missing evidence list
    const missingEvidence: MissingEvidence[] = evidence.missingInputs.map((m) => ({
      kind: m,
      reason: "Missing from evidence store.",
      targetAgent: "cost-supplier",
      priority: "high" as const,
    }));

    // No recommendations — fallback never recommends
    const recommendations: Recommendation[] = [];

    const summary =
      `[FALLBACK] Financial assessment for ${sellerId} (${assessmentType}): ` +
      `${evidence.snapshots.length} snapshots, ${evidence.outcomes.length} outcomes, ` +
      `${evidence.missingInputs.length} missing inputs. ` +
      `${evidence.profitSummary ? `Net profit: ${evidence.profitSummary.netProfit} ${evidence.sellerCurrency}. ` : "No profit data available. "}` +
      `Confidence: ${(confidence * 100).toFixed(0)}% based on ${availableKinds.size}/${totalExpectedEvidence} evidence kinds.`;

    const backupId = `fallback-${now}-${crypto.randomUUID().slice(0, 8)}`;

    return Object.freeze({
      assessmentId: backupId,
      sellerId,
      objective,
      assessmentType,
      // omit accountId — not relevant in fallback
      generatedAt: now,
      currencies: [evidence.sellerCurrency],
      evidenceIds: [
        ...evidence.snapshots.map((s) => s.snapshotId),
        ...evidence.outcomes.map((o) => o.outcomeId),
      ],
      outcomeIds: evidence.outcomes.map((o) => o.outcomeId),
      snapshotIds: evidence.snapshots.map((s) => s.snapshotId),
      summary,
      verifiedFacts: Object.freeze(verifiedFacts),
      hypotheses: Object.freeze([] as Hypothesis[]),
      risks: Object.freeze(risks),
      opportunities: Object.freeze([] as Opportunity[]),
      missingEvidence: Object.freeze(missingEvidence),
      confidence,
      uncertaintyReasons:
        evidence.missingInputs.length > 0
          ? [`${evidence.missingInputs.length} evidence inputs are missing.`]
          : [],
      recommendations: Object.freeze(recommendations),
      requestsForEvidence: Object.freeze([]),
      modelUsed: "none",
      fallbackUsed: true,
      promptBlockHashes: {},
      noMutationExecuted: true as const,
    });
  }
}
