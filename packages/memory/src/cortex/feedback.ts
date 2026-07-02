export type DelegationFeedbackKind = "approval" | "rejection" | "correction" | "pruning";

export type DelegationFeedbackBase = {
  proposalId: string;
  sellerId: string;
  reasoningEdgeIds: ReadonlyArray<number>;
  evidenceIds: ReadonlyArray<string>;
  observedAt: string;
};

export type DelegationApprovalFeedback = DelegationFeedbackBase & {
  kind: "approval";
  approvedScope: string;
  outcome: "positive" | "neutral" | "pending";
};

export type DelegationRejectionFeedback = DelegationFeedbackBase & {
  kind: "rejection";
  reason: string;
};

export type DelegationCorrectionFeedback = DelegationFeedbackBase & {
  kind: "correction";
  correction: string;
  lesson: string;
};

export type DelegationPruningFeedback = DelegationFeedbackBase & {
  kind: "pruning";
  pruningReason: "weak-outcomes" | "seller-corrected" | "stale-pattern";
  threshold: number;
};

export type DelegationFeedback =
  | DelegationApprovalFeedback
  | DelegationRejectionFeedback
  | DelegationCorrectionFeedback
  | DelegationPruningFeedback;

export type CortexFeedbackAction = "reinforce" | "penalize" | "create-corrective-lesson" | "prune";

export type CortexFeedbackDecision = {
  action: CortexFeedbackAction;
  proposalId: string;
  reasoningEdgeIds: ReadonlyArray<number>;
  evidenceIds: ReadonlyArray<string>;
};

export function decideCortexFeedbackAction(feedback: DelegationFeedback): CortexFeedbackDecision {
  const actionByKind: Record<DelegationFeedbackKind, CortexFeedbackAction> = {
    approval:
      feedback.kind === "approval" && feedback.outcome === "positive" ? "reinforce" : "penalize",
    rejection: "penalize",
    correction: "create-corrective-lesson",
    pruning: "prune",
  };

  return {
    action: actionByKind[feedback.kind],
    proposalId: feedback.proposalId,
    reasoningEdgeIds: feedback.reasoningEdgeIds,
    evidenceIds: feedback.evidenceIds,
  };
}

export type CortexSnapshotStorageRequest = {
  kind: "distilled-lesson" | "full-catalog-snapshot";
  sellerId: string;
  payload: Readonly<Record<string, unknown>>;
};

export function canStoreInCortex(request: CortexSnapshotStorageRequest): boolean {
  return request.kind !== "full-catalog-snapshot";
}
