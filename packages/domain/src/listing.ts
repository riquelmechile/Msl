import type { SellerId } from "./seller.js";

export type ListingId = string;

export type ListingStatus = "active" | "paused" | "closed" | "under_review";

export type Money = {
  amount: number;
  currency: "CLP";
};

export type Listing = {
  id: ListingId;
  sellerId: SellerId;
  title: string;
  status: ListingStatus;
  price: Money;
  availableQuantity: number;
  supplierSourcingRequired: boolean;
  updatedAt: Date;
};

export type ListingSnapshot = Listing & {
  capturedAt: Date;
};
