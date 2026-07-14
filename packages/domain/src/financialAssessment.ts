import type { Currency } from "./money.js";

export const ASSESSMENT_TYPES = [
  "account-health",
  "order-profitability",
  "product-profitability",
  "ads-profitability",
  "proposal-review",
  "outcome-review",
  "missing-cost-review",
  "cross-account-comparison",
  "cash-risk-indicator",
] as const;

export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

export type Hypothesis = {
  statement: string;
  confidence: number;
  evidence: string;
};

export type FinancialRisk = {
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  probability: number;
};

export type Opportunity = {
  description: string;
  estimatedImpact: string;
};

export type MissingEvidence = {
  kind: string;
  reason: string;
  targetAgent: string;
  priority: "low" | "medium" | "high";
};

export type Recommendation = {
  action: string;
  rationale: string;
  urgency: "investigate" | "monitor" | "request_evidence" | "prepare_proposal" | "escalate";
};

export type EvidenceRequest = {
  kind: string;
  targetAgent: string;
  reason: string;
  priority: "low" | "medium" | "high";
  ttl: number;
};

export type FinancialComparison = {
  accountA: string;
  accountB: string;
  metric: string;
  finding: string;
};

export type FinancialAssessment = {
  readonly assessmentId: string;
  readonly sellerId: string;
  readonly accountId?: string;
  readonly objective: string;
  readonly assessmentType: AssessmentType;
  readonly generatedAt: number;
  readonly evidenceWindow?: { readonly start: number; readonly end: number };
  readonly currencies: readonly Currency[];
  readonly evidenceIds: readonly string[];
  readonly outcomeIds: readonly string[];
  readonly snapshotIds: readonly string[];
  readonly summary: string;
  readonly verifiedFacts: readonly string[];
  readonly hypotheses: readonly Hypothesis[];
  readonly risks: readonly FinancialRisk[];
  readonly opportunities: readonly Opportunity[];
  readonly missingEvidence: readonly MissingEvidence[];
  readonly comparisons?: readonly FinancialComparison[];
  readonly expectedImpact?: string;
  readonly confidence: number;
  readonly uncertaintyReasons: readonly string[];
  readonly recommendations: readonly Recommendation[];
  readonly requestsForEvidence: readonly EvidenceRequest[];
  readonly escalationRecommendation?: string;
  readonly modelUsed: string;
  readonly fallbackUsed: boolean;
  readonly promptBlockHashes: {
    readonly blockA?: string;
    readonly blockB?: string;
    readonly blockC?: string;
    readonly blockD?: string;
  };
  readonly workSessionId?: string;
  readonly correlationId?: string;
  readonly noMutationExecuted: true;
};
