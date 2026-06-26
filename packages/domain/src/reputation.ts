import type { SellerId } from "./seller.js";

export type ReputationLevel =
  | "green"
  | "light_green"
  | "yellow"
  | "orange"
  | "red";

export type SellerReputation = {
  sellerId: SellerId;
  level: ReputationLevel;
  powerSellerStatus: "none" | "silver" | "gold" | "platinum";
  transactions: {
    total: number;
    completed: number;
    cancelled: number;
  };
  metrics: {
    claimsRate: number; // 0-1
    delayedHandlingRate: number;
    salesCompletionRate: number;
    customerServiceRate: number;
  };
};
