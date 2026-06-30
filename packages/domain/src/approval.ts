import type { PreparedAction } from "./preparedAction.js";

export type ApprovalId = string;

export type ApprovalRecord = {
  id: ApprovalId;
  actionId: PreparedAction["id"];
  sellerId: PreparedAction["sellerId"];
  approvedBy: "seller";
  approvedAt: Date;
  exactChangeAccepted: PreparedAction["exactChange"];
  riskAccepted: PreparedAction["riskLevel"];
  executionStatus: "not-executed";
};

export type ApprovalDecision =
  | { allowed: true; reason: "approved" }
  | {
      allowed: false;
      reason: "missing-approval" | "expired-action" | "rejected-action" | "approval-mismatch";
    };

export function canExecutePreparedAction(
  action: PreparedAction,
  now: Date,
  approval?: ApprovalRecord,
): ApprovalDecision {
  if (action.approvalStatus === "rejected") {
    return { allowed: false, reason: "rejected-action" };
  }

  if (action.expiresAt.getTime() <= now.getTime()) {
    return { allowed: false, reason: "expired-action" };
  }

  if (!approval || action.approvalStatus !== "approved") {
    return { allowed: false, reason: "missing-approval" };
  }

  if (
    approval.actionId !== action.id ||
    approval.sellerId !== action.sellerId ||
    approval.riskAccepted !== action.riskLevel ||
    !exactChangesMatch(approval.exactChangeAccepted, action.exactChange)
  ) {
    return { allowed: false, reason: "approval-mismatch" };
  }

  return { allowed: true, reason: "approved" };
}

function exactChangesMatch(
  left: PreparedAction["exactChange"],
  right: PreparedAction["exactChange"],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
