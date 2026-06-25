export type MarketplaceSite = "MLC";

export type SellerId = string;

export type SellerAccount = {
  id: SellerId;
  site: MarketplaceSite;
  displayName: string;
  connectedAt: Date;
  accessStatus: "connected" | "revoked" | "expired";
};

export type SellerPreference = {
  sellerId: SellerId;
  topic: "margin" | "profit" | "customer-treatment" | "claims" | "reputation" | "daily-priority";
  rule: string;
  learnedFrom: "correction" | "case-review" | "explicit-instruction";
  confidence: "low" | "medium" | "high";
  updatedAt: Date;
};
