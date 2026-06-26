import type { OrderId } from "./order.js";
import type { SellerId } from "./seller.js";

export type ClaimId = string & { readonly __brand: "ClaimId" };

export type ClaimStatus = "open" | "under_review" | "resolved" | "closed";

export type MlClaim = {
  claimId: ClaimId;
  sellerId: SellerId;
  orderId: OrderId;
  type: "buyer_protection" | "item_not_received" | "item_not_as_described";
  status: ClaimStatus;
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
};
