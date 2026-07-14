import type { FinancialAssessment } from "@msl/domain";
import type { FinanceDirectorEvidence } from "./FinanceDirectorEvidenceAssembler.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type ValidationIssue = {
  rule: string;
  detail: string;
};

export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};

/** Internal representation of a numeric claim extracted from assessment text. */
type NumericClaim = {
  value: number;
  raw: string;
  isPercentage: boolean;
  context: string;
};

// ── Constants ──────────────────────────────────────────────────────────────

const VALID_SELLERS = new Set(["plasticov", "maustian"]);
const DIRECT_MUTATION_PATTERN =
  /\b(execute|implement\s+now|publish|change\s+price|activate\s+ads?|spend\s+money|modify\s+listing)\b/i;
const GUARANTEED_PROFIT_PATTERN =
  /\b(guaranteed?\s+profit|profit\s+is\s+(guaranteed|cert[ao])|seguro\s+de\s+ganancia|ganancia\s+(garantizada|segura))\b/i;
const OBSERVED_AS_VERIFIED_PATTERN =
  /\bobserved.*?(confirm\w*|verif\w+)|verif\w+.*?by\s+observation\b/i;
const PARTIAL_AS_COMPLETE_PATTERN =
  /\b(all\s+costs?\s+(are\s+)?(included|covered|captured|accounted)|complete\s+picture|full\s+data|datos?\s+completos?)\b/i;

// Budget violation patterns
const EXCESSIVE_SPEND_PATTERN =
  /\b(invest|spend|allocate|increase\s+budget\s+by)\s+(?:USD|CLP|\$)?[\d,]{2,}(?:k|K|M|m(?:illion|illones)?|mil)?(?:\s*(?:USD|CLP|dollars|d[oó]lares|pesos))?\b/i;
const BOOST_AD_SPEND_PATTERN = /\bboost\s+ad\s+spend\b/i;
const BUDGET_INCREASE_PERCENT = /\bincrease\s+budget\s+by\s+(\d+)\s*%/i;
const LARGE_AMOUNT_THRESHOLD = 100000;
const BUDGET_PERCENT_THRESHOLD = 50;

function extractNumericAmount(text: string): number | null {
  // Match formatted numbers like "200,000" or "200000"
  const numMatch = text.match(/(?:USD|CLP|\$)?\s*([\d,]{3,})/);
  if (!numMatch || !numMatch[1]) return null;
  const cleaned = numMatch[1].replace(/,/g, "");
  const value = parseInt(cleaned, 10);
  return Number.isNaN(value) ? null : value;
}

function hasCostEvidence(assessment: Partial<FinancialAssessment>): boolean {
  const evidenceIds = assessment.evidenceIds ?? [];
  const missingEvidence = assessment.missingEvidence ?? [];
  // Cost-related evidence kinds that indicate the assessment has actual cost data
  const costKinds = new Set([
    "cost-evidence",
    "unit-economics",
    "product_cost",
    "advertising",
    "landed_cost",
    "shipping",
  ]);
  const evidenceKinds = missingEvidence.filter((me) => costKinds.has(me.kind));
  // If cost evidence is explicitly missing, we lack evidence
  if (evidenceKinds.length > 0) return false;
  // At least one evidenceId suggests data exists
  return evidenceIds.length > 0;
}

// ── Validator ──────────────────────────────────────────────────────────────

export class FinanceDirectorValidator {
  /**
   * Validates a partial FinancialAssessment against the provided evidence.
   * Returns a ValidationResult with `valid: false` if any rule is violated.
   */
  validate(
    assessment: Partial<FinancialAssessment>,
    evidence: FinanceDirectorEvidence,
  ): ValidationResult {
    const issues: ValidationIssue[] = [];

    // Rule 1: Invented figure — any number in assessment not present in evidence
    this.checkInventedFigures(assessment, evidence, issues);

    // Rule 2: Missing→zero treatment
    this.checkMissingToZero(assessment, evidence, issues);

    // Rule 3: Currency mixing — CLP and USD compared directly
    this.checkCurrencyMixing(assessment, evidence, issues);

    // Rule 4: Partial→complete — partial snapshot presented as complete
    this.checkPartialAsComplete(assessment, evidence, issues);

    // Rule 5: Observed→verified — observed outcome presented as verified
    this.checkObservedAsVerified(assessment, evidence, issues);

    // Rule 6: Invented causality — causal claim without supporting evidence
    this.checkInventedCausality(assessment, evidence, issues);

    // Rule 7: Direct mutation recommendation
    this.checkDirectMutation(assessment, issues);

    // Rule 8: Hidden uncertainty — confidence=1.0 when evidence is partial
    this.checkHiddenUncertainty(assessment, evidence, issues);

    // Rule 9: Guaranteed profit
    this.checkGuaranteedProfit(assessment, issues);

    // Rule 10: Missing seller scope
    this.checkMissingSellerScope(assessment, issues);

    // Rule 11: Non-existent evidenceId
    this.checkNonExistentEvidenceIds(assessment, evidence, issues);

    // Rule 12: Budget violation — recommendation exceeding policy limits
    // (placeholder — budget limits not yet defined)
    this.checkBudgetViolation(assessment, issues);

    // Rule 13: Invalid format — output that can't be parsed as FinancialAssessment
    this.checkInvalidFormat(assessment, issues);

    // Rule 14: Invented evidence kind
    this.checkInventedEvidenceKind(assessment, evidence, issues);

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  // ── Private check methods ────────────────────────────────────────────────

  // ── Numeric claim types ──────────────────────────────────────────────

  private readonly NUMERIC_PATTERN = /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/g;

  // ── checkInventedFigures ──────────────────────────────────────────────

  private checkInventedFigures(
    assessment: Partial<FinancialAssessment>,
    evidence: FinanceDirectorEvidence,
    issues: ValidationIssue[],
  ): void {
    // 1. Confidence validation (PRESERVED from existing)
    if (assessment.confidence !== undefined) {
      if (
        typeof assessment.confidence !== "number" ||
        Number.isNaN(assessment.confidence) ||
        assessment.confidence < 0 ||
        assessment.confidence > 1
      ) {
        issues.push({
          rule: "invented-figure",
          detail: `Confidence ${JSON.stringify(assessment.confidence)} is not a valid 0-1 number.`,
        });
      }
    }

    // 2. Extract numeric claims from assessment text
    const text = this.assessmentText(assessment);
    const claims = this.extractNumericClaims(text);
    if (claims.length === 0) return;

    // 3. Collect evidence numeric values for cross-reference
    const evidenceValues = this.collectEvidenceValues(evidence);

    // 4. Analyze each claim
    for (const claim of claims) {
      this.analyzeNumericClaim(claim, evidence, evidenceValues, issues);
    }
  }

  // ── Numeric extraction helpers ───────────────────────────────────────

  private extractNumericClaims(text: string): NumericClaim[] {
    const claims: NumericClaim[] = [];
    let match: RegExpExecArray | null;

    while ((match = this.NUMERIC_PATTERN.exec(text)) !== null) {
      const numStr = match[0].replace(/,/g, "");
      const value = parseFloat(numStr);
      if (Number.isNaN(value)) continue;

      // Check whether a % sign follows immediately (possibly with whitespace)
      const afterMatch = text.slice(match.index + match[0].length);
      const pctMatch = afterMatch.match(/^\s*%/);
      const isPercentage = pctMatch !== null;
      // Build the raw representation including trailing % for precision analysis
      const raw = isPercentage ? match[0] + pctMatch[0] : match[0];

      // Extract surrounding context (~60 chars before/after)
      const start = Math.max(0, match.index - 60);
      const end = Math.min(text.length, match.index + raw.length + 60);
      const context = text.slice(start, end).replace(/\s+/g, " ").trim();

      claims.push({ value, raw, isPercentage, context });
    }
    return claims;
  }

  private collectEvidenceValues(evidence: FinanceDirectorEvidence): number[] {
    const values: number[] = [];

    for (const snap of evidence.snapshots) {
      const numericFields = [
        snap.grossRevenue,
        snap.netProfit,
        snap.netMargin,
        snap.contributionProfit,
        snap.contributionMargin,
        snap.marketplaceFees,
        snap.advertisingCost,
        snap.productCost,
        snap.sellerShippingCost,
        snap.allocatedLandedCost,
        snap.taxes,
        snap.financingCost,
        snap.packagingCost,
        snap.otherCosts,
        snap.sellerFundedDiscounts,
        snap.refunds,
      ];
      for (const v of numericFields) {
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
      }
    }

    if (evidence.profitSummary) {
      const ps = evidence.profitSummary;
      values.push(ps.totalRevenue, ps.totalCosts, ps.netProfit, ps.netMargin);
    }

    // Also collect outcome-related numeric context if present
    for (const outcome of evidence.outcomes) {
      if (typeof outcome.confidence === "number") values.push(outcome.confidence);
      if (typeof outcome.completeness === "number") values.push(outcome.completeness);
    }

    return values;
  }

  // ── Per-claim analysis ────────────────────────────────────────────────

  private analyzeNumericClaim(
    claim: NumericClaim,
    evidence: FinanceDirectorEvidence,
    evidenceValues: number[],
    issues: ValidationIssue[],
  ): void {
    // 1. Detect fabricated metrics (ROAS, CAC, margin %, conversion rate)
    const metric = this.detectMetric(claim.context);
    if (metric !== null && !this.isMetricDerivable(metric, evidence)) {
      issues.push({
        rule: "invented-figure",
        detail: `Fabricated metric: "${metric}" = ${claim.raw} claimed but not derivable from available evidence.`,
      });
      return; // Already flagged — skip further checks for this claim
    }

    // 2. Check suspicious precision (> 2 decimal places)
    const decimals = this.countDecimalPlaces(claim.raw);
    if (decimals > 2) {
      issues.push({
        rule: "invented-figure",
        detail: `Suspicious precision: "${claim.raw}" has ${decimals} decimal places — unrealistic for integer-currency evidence. Context: "${claim.context}"`,
      });
      // Continue checking — a claim can be both precise AND unsubstantiated
    }

    // 3. Check currency mismatch BEFORE value cross-reference
    //    (currency check also validates evidence linkage)
    const hasUsd = /\bUSD\b/i.test(claim.context);
    const hasClp = /\bCLP\b/i.test(claim.context);
    const evidenceCurrency = evidence.sellerCurrency;

    if (hasUsd && evidenceCurrency === "CLP") {
      issues.push({
        rule: "invented-figure",
        detail: `Currency mismatch: claim "${claim.context}" references USD but evidence currency is ${evidenceCurrency}.`,
      });
      return; // Currency mismatch is decisive
    }
    if (hasClp && evidenceCurrency === "USD") {
      issues.push({
        rule: "invented-figure",
        detail: `Currency mismatch: claim "${claim.context}" references CLP but evidence currency is ${evidenceCurrency}.`,
      });
      return;
    }

    // 4. Cross-reference value against evidence
    const found = this.numberInEvidence(claim.value, evidenceValues, claim.isPercentage);
    if (!found) {
      if (hasUsd || hasClp) {
        issues.push({
          rule: "invented-figure",
          detail: `Undocumented amount: ${claim.raw} in "${claim.context}" not found in evidence.`,
        });
      } else {
        issues.push({
          rule: "invented-figure",
          detail: `Unsubstantiated claim: numeric value ${claim.raw} in "${claim.context}" has no supporting evidence.`,
        });
      }
    }
  }

  // ── Metric detection ──────────────────────────────────────────────────

  private detectMetric(context: string): string | null {
    if (/\bROAS\b/i.test(context)) return "ROAS";
    if (/\bCAC\b/i.test(context)) return "CAC";
    if (/\b(?:profit\s+)?margin\b/i.test(context)) return "margin";
    if (/\bconversion\s+rate\b/i.test(context)) return "conversion rate";
    if (/\bCPC\b/i.test(context)) return "CPC";
    if (/\bCTR\b/i.test(context)) return "CTR";
    return null;
  }

  private isMetricDerivable(metric: string, evidence: FinanceDirectorEvidence): boolean {
    // Check if raw data exists in evidence to derive the metric
    for (const snap of evidence.snapshots) {
      switch (metric) {
        case "ROAS":
          // ROAS = grossRevenue / advertisingCost — need both non-zero
          if (snap.grossRevenue > 0 && snap.advertisingCost > 0) return true;
          break;
        case "CAC":
          // CAC = advertisingCost / customerCount — need customer data not in standard evidence
          return false;
        case "margin":
          if (snap.grossRevenue > 0) return true;
          break;
        case "conversion rate":
        case "CPC":
        case "CTR":
          // These require click/impression data not in standard snapshots
          return false;
      }
    }

    // Fallback: profit summary provides margin data but not ROAS/CAC breakdowns
    if (evidence.profitSummary) {
      if (metric === "margin") return true;
    }

    return false;
  }

  // ── Precision helpers ─────────────────────────────────────────────────

  private countDecimalPlaces(raw: string): number {
    const cleaned = raw.replace(/%/g, "").replace(/,/g, "").trim();
    const dotIdx = cleaned.indexOf(".");
    if (dotIdx === -1) return 0;
    return cleaned.length - dotIdx - 1;
  }

  private numberInEvidence(
    value: number,
    evidenceValues: number[],
    isPercentage: boolean,
  ): boolean {
    // Normalise percentages to fraction form (0–1) for evidence comparison.
    // Evidence stores margins as fractions (e.g. netMargin 0.5 = 50%).
    const searchValue = isPercentage ? value / 100 : value;
    const tolerance = isPercentage ? 0.015 : Math.max(2, Math.abs(searchValue) * 0.02);
    return evidenceValues.some((ev) => Math.abs(ev - searchValue) <= tolerance);
  }

  private flagUnsubstantiatedClaim(
    claim: NumericClaim,
    evidence: FinanceDirectorEvidence,
    issues: ValidationIssue[],
  ): void {
    const hasUsd = /\bUSD\b/i.test(claim.context);
    const hasClp = /\bCLP\b/i.test(claim.context);
    const evidenceCurrency = evidence.sellerCurrency;

    if (hasUsd && evidenceCurrency !== "USD") {
      issues.push({
        rule: "invented-figure",
        detail: `Currency mismatch: claim "${claim.context}" references USD but evidence currency is ${evidenceCurrency}.`,
      });
    } else if (hasClp && evidenceCurrency !== "CLP") {
      issues.push({
        rule: "invented-figure",
        detail: `Currency mismatch: claim "${claim.context}" references CLP but evidence currency is ${evidenceCurrency}.`,
      });
    } else if (hasUsd || hasClp) {
      issues.push({
        rule: "invented-figure",
        detail: `Undocumented amount: ${claim.raw} in "${claim.context}" not found in evidence.`,
      });
    } else {
      issues.push({
        rule: "invented-figure",
        detail: `Unsubstantiated claim: numeric value ${claim.raw} in "${claim.context}" has no supporting evidence.`,
      });
    }
  }

  private checkMissingToZero(
    assessment: Partial<FinancialAssessment>,
    evidence: FinanceDirectorEvidence,
    issues: ValidationIssue[],
  ): void {
    // Check recommendations for zero-cost assumptions
    const recs = assessment.recommendations ?? [];
    const missingInputs = new Set(evidence.missingInputs);

    // Look for recommendations or hypotheses that assume costs are zero
    for (const h of assessment.hypotheses ?? []) {
      const combined = `${h.statement} ${h.evidence}`;
      if (
        combined.includes("zero") ||
        combined.includes("sin costo") ||
        combined.includes("costo 0")
      ) {
        // Only flag if there are actually missing inputs that could affect cost
        if (missingInputs.size > 0) {
          issues.push({
            rule: "missing-to-zero",
            detail: `Hypothesis "${h.statement}" implies zero cost but missing inputs exist: ${[...missingInputs].join(", ")}`,
          });
        }
      }
    }

    // Check summary text
    const summary = assessment.summary ?? "";
    if ((summary.includes("zero") || summary.includes("sin costo")) && missingInputs.size > 0) {
      issues.push({
        rule: "missing-to-zero",
        detail: "Summary mentions zero cost but evidence has missing inputs.",
      });
    }

    void recs;
  }

  private checkCurrencyMixing(
    assessment: Partial<FinancialAssessment>,
    evidence: FinanceDirectorEvidence,
    issues: ValidationIssue[],
  ): void {
    const text = this.assessmentText(assessment);

    // Check if text references both CLP and USD simultaneously in a comparative context
    const hasCLP = /\bCLP\b/i.test(text);
    const hasUSD = /\bUSD\b/i.test(text);
    const hasComparative =
      /\b(compar|vs\.?|versus|contra|better\s+than|worse\s+than|more\s+expensive\s+in|cheaper\s+in)\b/i;

    if (hasCLP && hasUSD && hasComparative) {
      issues.push({
        rule: "currency-mixing",
        detail: "Assessment compares CLP and USD values directly.",
      });
    }

    void evidence;
  }

  private checkPartialAsComplete(
    assessment: Partial<FinancialAssessment>,
    evidence: FinanceDirectorEvidence,
    issues: ValidationIssue[],
  ): void {
    const summary = assessment.summary ?? "";
    if (PARTIAL_AS_COMPLETE_PATTERN.test(summary)) {
      if (evidence.missingInputs.length > 0) {
        issues.push({
          rule: "partial-as-complete",
          detail: `Summary claims completeness but ${evidence.missingInputs.length} inputs are missing: ${evidence.missingInputs.slice(0, 5).join(", ")}`,
        });
      }
    }
  }

  private checkObservedAsVerified(
    assessment: Partial<FinancialAssessment>,
    _evidence: FinanceDirectorEvidence,
    issues: ValidationIssue[],
  ): void {
    const text = this.assessmentText(assessment);
    if (OBSERVED_AS_VERIFIED_PATTERN.test(text)) {
      issues.push({
        rule: "observed-as-verified",
        detail: "Assessment treats an observed outcome as verified without verification timestamp.",
      });
    }
  }

  private checkInventedCausality(
    assessment: Partial<FinancialAssessment>,
    _evidence: FinanceDirectorEvidence,
    issues: ValidationIssue[],
  ): void {
    for (const h of assessment.hypotheses ?? []) {
      const causalIndicators =
        /\b(because|caused\s+by|due\s+to|led\s+to|resulted?\s+in|provoc[oó]|caus[oó]|debido\s+a|resultado\s+de)\b/i;
      if (causalIndicators.test(h.statement)) {
        // If confidence is low or no evidence is cited, flag it
        if (!h.evidence || h.evidence.trim() === "" || h.confidence < 0.3) {
          issues.push({
            rule: "invented-causality",
            detail: `Hypothesis "${h.statement}" makes causal claim without sufficient evidence (confidence: ${h.confidence}, evidence: "${h.evidence || "none"}").`,
          });
        }
      }
    }
  }

  private checkDirectMutation(
    assessment: Partial<FinancialAssessment>,
    issues: ValidationIssue[],
  ): void {
    for (const r of assessment.recommendations ?? []) {
      if (DIRECT_MUTATION_PATTERN.test(r.action)) {
        issues.push({
          rule: "direct-mutation",
          detail: `Recommendation "${r.action}" contains direct mutation language ("execute", "publish", etc.).`,
        });
      }
    }
  }

  private checkHiddenUncertainty(
    assessment: Partial<FinancialAssessment>,
    evidence: FinanceDirectorEvidence,
    issues: ValidationIssue[],
  ): void {
    if (assessment.confidence === 1.0) {
      if (evidence.missingInputs.length > 0) {
        issues.push({
          rule: "hidden-uncertainty",
          detail: `Confidence is 1.0 but ${evidence.missingInputs.length} evidence inputs are missing. Confidence degraded to partially uncertain.`,
        });
      }
    }
  }

  private checkGuaranteedProfit(
    assessment: Partial<FinancialAssessment>,
    issues: ValidationIssue[],
  ): void {
    const summary = assessment.summary ?? "";
    if (GUARANTEED_PROFIT_PATTERN.test(summary)) {
      issues.push({
        rule: "guaranteed-profit",
        detail: "Assessment claims guaranteed or certain profit.",
      });
    }

    for (const h of assessment.hypotheses ?? []) {
      if (GUARANTEED_PROFIT_PATTERN.test(h.statement)) {
        issues.push({
          rule: "guaranteed-profit",
          detail: `Hypothesis "${h.statement}" claims guaranteed profit.`,
        });
      }
    }
  }

  private checkMissingSellerScope(
    assessment: Partial<FinancialAssessment>,
    issues: ValidationIssue[],
  ): void {
    // Check that sellerId is present in the assessment
    if (!assessment.sellerId) {
      issues.push({
        rule: "missing-seller-scope",
        detail: "Assessment has no sellerId. Every claim must include seller scope.",
      });
    }

    // Check summary text for claims without seller context
    const summary = assessment.summary ?? "";
    const facts = assessment.verifiedFacts ?? [];

    // If seller is in valid set, verify it appears
    if (assessment.sellerId && !VALID_SELLERS.has(assessment.sellerId)) {
      // Unknown seller — allow but note as potential issue if confidence is high
      if ((assessment.confidence ?? 0) > 0.7) {
        issues.push({
          rule: "missing-seller-scope",
          detail: `Seller "${assessment.sellerId}" is not a recognized account. Plasticov and Maustian are the expected sellers.`,
        });
      }
    }

    void summary;
    void facts;
  }

  private checkNonExistentEvidenceIds(
    assessment: Partial<FinancialAssessment>,
    evidence: FinanceDirectorEvidence,
    issues: ValidationIssue[],
  ): void {
    const validSnapshotIds = new Set(evidence.snapshots.map((s) => s.snapshotId));
    const validOutcomeIds = new Set(evidence.outcomes.map((o) => o.outcomeId));

    for (const id of assessment.evidenceIds ?? []) {
      if (!validSnapshotIds.has(id) && !validOutcomeIds.has(id) && id !== "none") {
        issues.push({
          rule: "non-existent-evidenceId",
          detail: `Evidence ID "${id}" referenced in assessment does not exist in provided evidence.`,
        });
      }
    }
  }

  private checkBudgetViolation(
    assessment: Partial<FinancialAssessment>,
    issues: ValidationIssue[],
  ): void {
    const costEvidenceAvailable = hasCostEvidence(assessment);
    const text = this.assessmentText(assessment);

    // Check for large spending recommendations without cost evidence
    if (EXCESSIVE_SPEND_PATTERN.test(text)) {
      const amount = extractNumericAmount(text);
      if (amount !== null && amount >= LARGE_AMOUNT_THRESHOLD) {
        if (!costEvidenceAvailable) {
          issues.push({
            rule: "budget-violation",
            detail: `Recommendation suggests spending ${amount.toLocaleString()} without corresponding cost evidence in evidence bag.`,
          });
        }
      }
    }

    // Check for "boost ad spend" without cost evidence
    if (BOOST_AD_SPEND_PATTERN.test(text) && !costEvidenceAvailable) {
      issues.push({
        rule: "budget-violation",
        detail: "Recommendation suggests boosting ad spend without cost evidence.",
      });
    }

    // Check for budget increase recommendations exceeding percentage threshold
    const budgetPctMatch = text.match(BUDGET_INCREASE_PERCENT);
    if (budgetPctMatch && budgetPctMatch[1]) {
      const pct = parseInt(budgetPctMatch[1], 10);
      if (pct >= BUDGET_PERCENT_THRESHOLD && !costEvidenceAvailable) {
        issues.push({
          rule: "budget-violation",
          detail: `Recommendation suggests increasing budget by ${pct}% without cost evidence.`,
        });
      }
    }
  }

  private checkInvalidFormat(
    assessment: Partial<FinancialAssessment>,
    issues: ValidationIssue[],
  ): void {
    // Check required fields are present
    if (!assessment.assessmentType) {
      issues.push({
        rule: "invalid-format",
        detail: "Assessment missing required field: assessmentType.",
      });
    }
    if (assessment.summary === undefined || assessment.summary === null) {
      issues.push({
        rule: "invalid-format",
        detail: "Assessment missing required field: summary.",
      });
    }
  }

  private checkInventedEvidenceKind(
    assessment: Partial<FinancialAssessment>,
    evidence: FinanceDirectorEvidence,
    issues: ValidationIssue[],
  ): void {
    // Check that referenced evidence kinds exist in known kinds
    const knownKinds = new Set<string>([
      "unit-economics",
      "economic-outcome",
      "profit-summary",
      "cost-evidence",
      "product-ads-profitability",
      "account-brain",
      "product_cost",
      "marketplace_fee",
      "shipping",
      "advertising",
      "seller_discount",
      "refund",
      "return",
      "tax",
      "financing",
      "landed_cost",
      "packaging",
      "other",
      ...evidence.missingInputs,
    ]);

    for (const me of assessment.missingEvidence ?? []) {
      if (!knownKinds.has(me.kind)) {
        issues.push({
          rule: "invented-evidence-kind",
          detail: `Evidence kind "${me.kind}" is not in the known evidence kinds.`,
        });
      }
    }

    for (const req of assessment.requestsForEvidence ?? []) {
      if (!knownKinds.has(req.kind)) {
        issues.push({
          rule: "invented-evidence-kind",
          detail: `Evidence request kind "${req.kind}" is not in the known evidence kinds.`,
        });
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private assessmentText(assessment: Partial<FinancialAssessment>): string {
    const parts: string[] = [];
    if (assessment.summary) parts.push(assessment.summary);
    for (const f of assessment.verifiedFacts ?? []) parts.push(f);
    for (const h of assessment.hypotheses ?? []) {
      parts.push(h.statement, h.evidence);
    }
    for (const r of assessment.recommendations ?? []) {
      parts.push(r.action, r.rationale);
    }
    return parts.join("\n");
  }
}
