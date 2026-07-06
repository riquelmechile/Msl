import type { PreparedAction } from "./preparedAction.js";
import type {
  OwnedEcommerceExecutionOperation,
  OwnedEcommerceExecutionTarget,
  StorefrontProjectionId,
  StorefrontProjectionVersion,
} from "./ownedEcommerce.js";

export type ApprovalId = string;

export type ApprovalRecord = {
  id: ApprovalId;
  actionId: PreparedAction["id"];
  sellerId: PreparedAction["sellerId"];
  approvedBy: "seller";
  approvedAt: Date;
  exactChangeAccepted: PreparedAction["exactChange"];
  riskAccepted: PreparedAction["riskLevel"];
  executionStatus: "not-executed" | "executed";
  ownedEcommerceBinding?: OwnedEcommerceExecutionApprovalBinding;
};

export type OwnedEcommerceExecutionApprovalBinding = {
  actionId: PreparedAction["id"];
  projectionId: StorefrontProjectionId;
  projectionVersion: StorefrontProjectionVersion;
  target: OwnedEcommerceExecutionTarget;
  operation: OwnedEcommerceExecutionOperation;
  approver: "seller";
  risk: PreparedAction["riskLevel"];
  rationale: string;
  expiresAt: Date;
};

export type ApprovalDecision =
  | { allowed: true; reason: "approved" }
  | {
      allowed: false;
      reason: "missing-approval" | "expired-action" | "rejected-action" | "approval-mismatch";
    };

export type OwnedEcommerceExecutionApprovalDecision =
  | { allowed: true; reason: "approved" }
  | {
      allowed: false;
      reason:
        | "missing-approval"
        | "expired-approval"
        | "expired-action"
        | "rejected-action"
        | "approval-mismatch";
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

export function canExecuteOwnedEcommerceAction(
  input: {
    action: PreparedAction;
    projectionId: StorefrontProjectionId;
    projectionVersion: StorefrontProjectionVersion;
    target: OwnedEcommerceExecutionTarget;
    operation: OwnedEcommerceExecutionOperation;
  },
  now: Date,
  approval?: ApprovalRecord,
): OwnedEcommerceExecutionApprovalDecision {
  const genericDecision = canExecutePreparedAction(input.action, now, approval);
  if (!genericDecision.allowed) {
    return genericDecision;
  }

  const binding = approval?.ownedEcommerceBinding;
  if (!binding) {
    return { allowed: false, reason: "approval-mismatch" };
  }

  const bindingExpiryMs = binding.expiresAt.getTime();
  if (!Number.isFinite(bindingExpiryMs) || bindingExpiryMs <= now.getTime()) {
    return { allowed: false, reason: "expired-approval" };
  }

  if (
    binding.actionId !== input.action.id ||
    binding.projectionId !== input.projectionId ||
    binding.projectionVersion !== input.projectionVersion ||
    binding.operation !== input.operation ||
    binding.approver !== approval.approvedBy ||
    binding.risk !== input.action.riskLevel ||
    binding.rationale !== input.action.rationale ||
    !targetsMatch(binding.target, input.target)
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

function targetsMatch(
  left: OwnedEcommerceExecutionTarget,
  right: OwnedEcommerceExecutionTarget,
): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "storefront-projection") {
    return right.type === "storefront-projection" && left.projectionId === right.projectionId;
  }
  return (
    right.type === "ecommerce-catalog-item" &&
    left.itemRef === right.itemRef &&
    left.projectionId === right.projectionId
  );
}
