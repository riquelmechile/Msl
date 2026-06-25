import type { SellerId } from "./seller.js";

export type SpecializationEvidence = {
  sellerId: SellerId;
  workflowName: string;
  observedExamples: number;
  hasDecisionCriteria: boolean;
  hasOutcomeHistory: boolean;
  hasSafetyBoundaries: boolean;
  learnedFromCorrections: boolean;
};

export type SpecializationReadiness =
  | {
      ready: true;
      scope: string;
      requiredEvidence: [];
    }
  | {
      ready: false;
      requiredEvidence: string[];
    };

export function evaluateSpecializationReadiness(
  evidence: SpecializationEvidence,
): SpecializationReadiness {
  const missing: string[] = [];

  if (evidence.observedExamples < 3) {
    missing.push("at least three observed workflow examples");
  }

  if (!evidence.hasDecisionCriteria) {
    missing.push("seller decision criteria");
  }

  if (!evidence.hasOutcomeHistory) {
    missing.push("observed outcomes");
  }

  if (!evidence.hasSafetyBoundaries) {
    missing.push("approval, audit, and rollback boundaries");
  }

  if (!evidence.learnedFromCorrections) {
    missing.push("seller corrections or validated preferences");
  }

  if (missing.length > 0) {
    return { ready: false, requiredEvidence: missing };
  }

  return {
    ready: true,
    scope: evidence.workflowName,
    requiredEvidence: [],
  };
}
