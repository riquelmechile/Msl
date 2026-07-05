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
  "owned-ecommerce-publish",
  "owned-ecommerce-checkout-activation",
  "owned-ecommerce-price-change",
  "owned-ecommerce-stock-change",
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
  "storefront-projection": "projectionId",
  "ecommerce-catalog-item": "itemRef",
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
  "owned-ecommerce-publish": "high",
  "owned-ecommerce-checkout-activation": "critical",
  "owned-ecommerce-price-change": "high",
  "owned-ecommerce-stock-change": "high",
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
  assertPreparedActionTarget(input.kind, input.target);

  return {
    ...input,
    approvalStatus: "pending",
    riskLevel: riskLevelForAction(input.kind),
  };
}

export function assertPreparedActionTarget(kind: WriteActionKind, target: ActionTarget): void {
  if (kind === "owned-ecommerce-publish" && target.type !== "storefront-projection") {
    throw new Error(`Invalid target ${target.type} for ${kind}: expected storefront-projection`);
  }

  if (kind === "owned-ecommerce-checkout-activation" && target.type !== "storefront-projection") {
    throw new Error(`Invalid target ${target.type} for ${kind}: expected storefront-projection`);
  }

  if (kind === "owned-ecommerce-price-change" && target.type !== "ecommerce-catalog-item") {
    throw new Error(`Invalid target ${target.type} for ${kind}: expected ecommerce-catalog-item`);
  }

  if (kind === "owned-ecommerce-stock-change" && target.type !== "ecommerce-catalog-item") {
    throw new Error(`Invalid target ${target.type} for ${kind}: expected ecommerce-catalog-item`);
  }
}
