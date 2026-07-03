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
  "product-ads-action",
  "honey-pot-deploy",
  "probe-analysis",
  "supplier-mirror-publish-proposal",
  "supplier-mirror-price-proposal",
  "supplier-mirror-pause-listing",
] as const;

export type WriteActionKind = (typeof WRITE_ACTION_KINDS)[number];

export type RiskLevel = "low" | "medium" | "high" | "critical";

export const ACTION_TARGET_FIELD_BY_TYPE = {
  listing: "listingId",
  order: "orderId",
  message: "threadId",
  "creative-asset": "assetId",
  "product-ads-campaign": "campaignId",
  "product-ads-ad": "adId",
} as const;

type ActionTargetFieldByType = typeof ACTION_TARGET_FIELD_BY_TYPE;

type BaseActionTarget = {
  [TargetType in keyof ActionTargetFieldByType]: { type: TargetType } & Record<
    ActionTargetFieldByType[TargetType],
    TargetType extends "listing" ? ListingId : string
  >;
}[keyof ActionTargetFieldByType];

export type ActionTarget =
  | Exclude<BaseActionTarget, { type: "product-ads-ad" }>
  | { type: "product-ads-ad"; adId?: string; itemId?: string };

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
  "product-ads-action": "high",
  "honey-pot-deploy": "high",
  "probe-analysis": "high",
  "supplier-mirror-publish-proposal": "high",
  "supplier-mirror-price-proposal": "medium",
  "supplier-mirror-pause-listing": "high",
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
