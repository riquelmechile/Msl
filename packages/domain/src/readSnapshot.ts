import type { CacheFreshness } from "./cacheFreshness.js";
import type { SellerId } from "./seller.js";

export type ReadSnapshotKind =
  | "listing"
  | "listing-prices"
  | "product-ads-insights"
  | "pricing"
  | "order"
  | "claim"
  | "message"
  | "reputation"
  | "question"
  | "category-attributes"
  | "category-technical-specs"
  | "business-signal";

export type MlCapabilitySiteSupport = "MLC-confirmed" | "unknown";

export type ReadSnapshotCompleteness = "complete" | "partial";

export type ReadSnapshotConfidence = "low" | "medium" | "high";

export type ReadSnapshotSource = CacheFreshness["source"];

export type ReadSnapshotSellerScope = {
  sellerId: SellerId;
  site: "MLC";
};

export type ReadSnapshot<TData> = {
  sellerId: SellerId;
  kind: ReadSnapshotKind;
  source: ReadSnapshotSource;
  data: ReadonlyArray<TData> | TData;
  completeness: ReadSnapshotCompleteness;
  freshness: CacheFreshness;
  confidence: ReadSnapshotConfidence;
  siteSupport?: MlCapabilitySiteSupport;
  sellerScope?: ReadSnapshotSellerScope;
};

const MLC_CATEGORY_ID_PATTERN = /^MLC\d+$/;
const MLC_DOMAIN_ID_PATTERN = /^MLC-[A-Z0-9_]+$/;

export function isMlcCategoryId(identifier: string): boolean {
  return MLC_CATEGORY_ID_PATTERN.test(identifier);
}

export function isMlcDomainId(identifier: string): boolean {
  return MLC_DOMAIN_ID_PATTERN.test(identifier);
}

export function isReadSnapshotFresh(snapshot: ReadSnapshot<unknown>): boolean {
  return snapshot.freshness.status === "fresh";
}

export function isReadSnapshotReliable(snapshot: ReadSnapshot<unknown>): boolean {
  return (
    isReadSnapshotFresh(snapshot) &&
    snapshot.completeness === "complete" &&
    snapshot.confidence !== "low"
  );
}
