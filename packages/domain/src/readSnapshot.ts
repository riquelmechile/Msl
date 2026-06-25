import type { CacheFreshness } from "./cacheFreshness.js";
import type { SellerId } from "./seller.js";

export type ReadSnapshotKind = "listing" | "order" | "message" | "reputation";

export type ReadSnapshotCompleteness = "complete" | "partial";

export type ReadSnapshotConfidence = "low" | "medium" | "high";

export type ReadSnapshotSource = CacheFreshness["source"];

export type ReadSnapshot<TData> = {
  sellerId: SellerId;
  kind: ReadSnapshotKind;
  source: ReadSnapshotSource;
  data: ReadonlyArray<TData> | TData;
  completeness: ReadSnapshotCompleteness;
  freshness: CacheFreshness;
  confidence: ReadSnapshotConfidence;
};

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
