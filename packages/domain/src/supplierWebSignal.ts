export type SupplierWebSignalKind =
  | "new-supplier-product"
  | "stock-gap"
  | "supplier-price-change"
  | "supplier-stock-restored"
  | "supplier-stock-out"
  | "publish-opportunity";

export type SupplierWebRecommendedAction =
  | "prepare-product-page"
  | "prepare-storefront-candidate"
  | "review-storefront-availability"
  | "prepare-availability-pause"
  | "prepare-price-review"
  | "prepare-reactivation-review"
  | "request-creative-assets"
  | "collect-more-evidence";

export type SupplierWebSignalPayload = {
  type: "supplier-web-signal";
  signalKind: SupplierWebSignalKind;
  supplierId: string;
  supplierItemId: string;
  affectedSellerIds?: string[];
  evidenceIds: string[];
  recommendedAction: SupplierWebRecommendedAction;
  severity: "info" | "warning" | "critical";
  capturedAt: string;
  noMutationExecuted: true;
};

export function isValidSupplierWebSignal(value: unknown): value is SupplierWebSignalPayload {
  if (typeof value !== "object" || value === null) return false;

  const v = value as Record<string, unknown>;

  if (v.type !== "supplier-web-signal") return false;

  const validKinds: SupplierWebSignalKind[] = [
    "new-supplier-product",
    "stock-gap",
    "supplier-price-change",
    "supplier-stock-restored",
    "supplier-stock-out",
    "publish-opportunity",
  ];
  if (
    typeof v.signalKind !== "string" ||
    !validKinds.includes(v.signalKind as SupplierWebSignalKind)
  ) {
    return false;
  }

  if (typeof v.supplierId !== "string" || v.supplierId.length === 0) return false;
  if (typeof v.supplierItemId !== "string" || v.supplierItemId.length === 0) return false;

  if (v.affectedSellerIds !== undefined && !Array.isArray(v.affectedSellerIds)) return false;
  if (
    v.affectedSellerIds !== undefined &&
    (v.affectedSellerIds as unknown[]).some((s) => typeof s !== "string")
  ) {
    return false;
  }

  if (!Array.isArray(v.evidenceIds)) return false;
  if ((v.evidenceIds as unknown[]).some((e) => typeof e !== "string")) return false;

  const validActions: SupplierWebRecommendedAction[] = [
    "prepare-product-page",
    "prepare-storefront-candidate",
    "review-storefront-availability",
    "prepare-availability-pause",
    "prepare-price-review",
    "prepare-reactivation-review",
    "request-creative-assets",
    "collect-more-evidence",
  ];
  if (
    typeof v.recommendedAction !== "string" ||
    !validActions.includes(v.recommendedAction as SupplierWebRecommendedAction)
  ) {
    return false;
  }

  const validSeverities = ["info", "warning", "critical"];
  if (typeof v.severity !== "string" || !validSeverities.includes(v.severity)) return false;

  if (typeof v.capturedAt !== "string" || v.capturedAt.length === 0) return false;

  if (v.noMutationExecuted !== true) return false;

  return true;
}
