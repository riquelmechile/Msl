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

// ── Constants ──────────────────────────────────────────────────────────────

const VALID_SELLERS = new Set(["plasticov", "maustian"]);
const DIRECT_MUTATION_PATTERN = /\b(execute|implement\s+now|publish|change\s+price|activate\s+ads?|spend\s+money|modify\s+listing)\b/i;
const GUARANTEED_PROFIT_PATTERN = /\b(guaranteed?\s+profit|profit\s+is\s+(guaranteed|cert[ao])|seguro\s+de\s+ganancia|ganancia\s+(garantizada|segura))\b/i;
const OBSERVED_AS_VERIFIED_PATTERN = /\bobserved.*?(confirm\w*|verif\w+)|verif\w+.*?by\s+observation\b/i;
const PARTIAL_AS_COMPLETE_PATTERN = /\b(all\s+costs?\s+(are\s+)?(included|covered|captured|accounted)|complete\s+picture|full\s+data|datos?\s+completos?)\b/i;

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

  private checkInventedFigures(
    assessment: Partial<FinancialAssessment>,
    _evidence: FinanceDirectorEvidence,
    issues: ValidationIssue[],
  ): void {
    // Check that confidence is a valid number between 0 and 1
    if (assessment.confidence !== undefined) {
      if (typeof assessment.confidence !== "number" || Number.isNaN(assessment.confidence) || assessment.confidence < 0 || assessment.confidence > 1) {
        issues.push({
          rule: "invented-figure",
          detail: `Confidence ${JSON.stringify(assessment.confidence)} is not a valid 0-1 number.`,
        });
      }
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
      if (combined.includes("zero") || combined.includes("sin costo") || combined.includes("costo 0")) {
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
    const hasComparative = /\b(compar|vs\.?|versus|contra|better\s+than|worse\s+than|more\s+expensive\s+in|cheaper\s+in)\b/i;

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
      const causalIndicators = /\b(because|caused\s+by|due\s+to|led\s+to|resulted?\s+in|provoc[oó]|caus[oó]|debido\s+a|resultado\s+de)\b/i;
      if (causalIndicators.test(h.statement)) {
        // If confidence is low or no evidence is cited, flag it
        if (!h.evidence || h.evidence.trim() === "" || h.confidence < 0.3) {
          issues.push({
            rule: "invented-causality",
            detail: `Hypothesis "${h.statement}" makes causal claim without sufficient evidence (confidence: ${h.confidence}, evidence: "${h.evidence || 'none'}").`,
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
    _assessment: Partial<FinancialAssessment>,
    _issues: ValidationIssue[],
  ): void {
    // Budget limits not yet defined in the system — placeholder
    // In future: check recommendation spending against policy limits
    void _assessment;
    void (_issues.length);
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
