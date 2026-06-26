import type { ListingId } from "./listing.js";
import type { SellerId } from "./seller.js";

export type PreparedActionId = string;
export type AuditId = string;

export type WriteActionKind =
  | "price-change"
  | "stock-change"
  | "customer-message"
  | "cancellation"
  | "refund"
  | "listing-edit"
  | "creative-publication"
  | "honey-pot-deploy"
  | "probe-analysis";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ActionTarget =
  | { type: "listing"; listingId: ListingId }
  | { type: "order"; orderId: string }
  | { type: "message"; threadId: string }
  | { type: "creative-asset"; assetId: string };

export type ExactChange = {
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
};

export type PreparedAction = {
  id: PreparedActionId;
  sellerId: SellerId;
  kind: WriteActionKind;
  target: ActionTarget;
  exactChange: ExactChange[];
  rationale: string;
  riskLevel: RiskLevel;
  expiresAt: Date;
  approvalStatus: "pending" | "approved" | "rejected" | "expired";
  auditId?: AuditId;
};

const riskByKind: Record<WriteActionKind, RiskLevel> = {
  "price-change": "medium",
  "stock-change": "medium",
  "customer-message": "medium",
  cancellation: "high",
  refund: "high",
  "listing-edit": "high",
  "creative-publication": "high",
  "honey-pot-deploy": "high",
  "probe-analysis": "high",
};

export function riskLevelForAction(kind: WriteActionKind): RiskLevel {
  return riskByKind[kind];
}

export function requiresApproval(kind: WriteActionKind): true {
  void kind;
  return true;
}

export function createPreparedAction(
  input: Omit<PreparedAction, "approvalStatus" | "riskLevel">,
): PreparedAction {
  return {
    ...input,
    approvalStatus: "pending",
    riskLevel: riskLevelForAction(input.kind),
  };
}
