import type { ListingId } from "./listing.js";
import type { SellerId } from "./seller.js";

export type PreparedActionId = string;
export type AuditId = string;

export const WRITE_ACTION_KINDS = [
  "price-change",
  "stock-change",
  "customer-message",
  "cancellation",
  "refund",
  "listing-edit",
  "creative-publication",
  "honey-pot-deploy",
  "probe-analysis",
] as const;

export type WriteActionKind = (typeof WRITE_ACTION_KINDS)[number];

export type RiskLevel = "low" | "medium" | "high" | "critical";

export const ACTION_TARGET_FIELD_BY_TYPE = {
  listing: "listingId",
  order: "orderId",
  message: "threadId",
  "creative-asset": "assetId",
} as const;

type ActionTargetFieldByType = typeof ACTION_TARGET_FIELD_BY_TYPE;

export type ActionTarget = {
  [TargetType in keyof ActionTargetFieldByType]: { type: TargetType } & Record<
    ActionTargetFieldByType[TargetType],
    TargetType extends "listing" ? ListingId : string
  >;
}[keyof ActionTargetFieldByType];

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
