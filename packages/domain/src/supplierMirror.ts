import type { SellerId } from "./seller.js";

export type SupplierId = string;
export type SupplierItemId = string;
export type SupplierEvidenceId = string;
export type SupplierMirrorLedgerId = string;
export type SupplierMirrorPolicyId = string;

export type SupplierSourceType =
  | "mercadolibre-api"
  | "mercadolibre-scraper-fallback"
  | "xkp-enrichment"
  | "whatsapp-manual"
  | "unsupported";

export type SupplierMirrorConfidence = "low" | "medium" | "high";
export type SupplierMirrorFreshness = "fresh" | "stale";
export type SupplierMirrorAuthority =
  | "stock-authoritative"
  | "catalog-enrichment"
  | "fallback-evidence";

export type SupplierRegistryEntry = {
  id: SupplierId;
  name: string;
  enabled: boolean;
  primarySource: SupplierSourceType;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
};

export type SupplierItemSnapshot = {
  supplierId: SupplierId;
  supplierItemId: SupplierItemId;
  mlItemId?: string;
  title: string;
  sku?: string;
  categoryId?: string;
  price?: number;
  currency?: string;
  snapshot: Readonly<Record<string, unknown>>;
  source: SupplierSourceType;
  confidence: SupplierMirrorConfidence;
  freshness: SupplierMirrorFreshness;
  evidenceId: SupplierEvidenceId;
  capturedAt: string;
};

export type StockObservationStatus = "in-stock" | "low-stock" | "out-of-stock" | "unknown";

export type SupplierStockObservation = {
  id: string;
  supplierId: SupplierId;
  supplierItemId: SupplierItemId;
  source: SupplierSourceType;
  authority: SupplierMirrorAuthority;
  quantity: number | null;
  status: StockObservationStatus;
  confidence: SupplierMirrorConfidence;
  evidenceId: SupplierEvidenceId;
  capturedAt: string;
};

export type SupplierTargetMappingState = "proposed" | "approved" | "paused" | "rejected";

export type SupplierTargetPolicyReference = {
  scopeType: SupplierTargetPolicyScopeType;
  scopeId: string;
  supplierId: SupplierId;
};

export type SupplierTargetMapping = {
  supplierId: SupplierId;
  supplierItemId: SupplierItemId;
  targetSellerId: SellerId;
  targetItemId: string;
  policyRef: SupplierTargetPolicyReference;
  state: SupplierTargetMappingState;
  approvedAt?: string;
  evidenceIds: readonly SupplierEvidenceId[];
};

export type SupplierTargetPolicyScopeType = "supplier" | "category" | "item";

export type SupplierPricingPolicy =
  | { kind: "multiplier"; multiplier: 2 | 3 | 4 }
  | { kind: "fixed-uplift-clp"; amount: number }
  | { kind: "learned"; policyId: SupplierMirrorPolicyId };

export type SupplierTargetPolicy = {
  scopeType: SupplierTargetPolicyScopeType;
  scopeId: string;
  supplierId: SupplierId;
  targetSellerIds: readonly SellerId[];
  lowStockThreshold: number;
  autoPauseAllowed: boolean;
  pricingPolicy?: SupplierPricingPolicy;
};

export type SupplierMirrorLedgerActionType =
  | "publish-proposal"
  | "price-proposal"
  | "pause-listing"
  | "skip"
  | "defer";

export type SupplierMirrorLedgerStatus = "planned" | "executed" | "skipped" | "deferred" | "failed";

export type SupplierMirrorLedgerRecord = {
  id: SupplierMirrorLedgerId;
  actionType: SupplierMirrorLedgerActionType;
  idempotencyKey: string;
  status: SupplierMirrorLedgerStatus;
  reason: string;
  supplierId: SupplierId;
  supplierItemId?: SupplierItemId;
  targetSellerId?: SellerId;
  targetItemId?: string;
  evidenceIds: readonly SupplierEvidenceId[];
  before: Readonly<Record<string, unknown>> | null;
  after: Readonly<Record<string, unknown>> | null;
  createdAt: string;
};

export type SupplierMirrorNotificationEventType =
  | "stock-break-confirmed"
  | "pause-deferred"
  | "verification-inconclusive";

export type SupplierMirrorNotificationEvent = {
  id: string;
  type: SupplierMirrorNotificationEventType;
  status: "pending" | "recorded";
  supplierId: SupplierId;
  supplierItemId?: SupplierItemId;
  targetSellerId?: SellerId;
  targetItemId?: string;
  reason: string;
  evidenceIds: readonly SupplierEvidenceId[];
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
};

export type SupplierNotificationPreference = {
  scopeType: SupplierTargetPolicyScopeType;
  scopeId: string;
  preference: Readonly<Record<string, unknown>>;
};

export type SupplierLearnedFallbackPolicy = {
  id: SupplierMirrorPolicyId;
  policyType: "pricing" | "targeting" | "stock" | "notification" | "error-outcome";
  scope: Readonly<Record<string, unknown>>;
  decision: Readonly<Record<string, unknown>>;
  confidence: SupplierMirrorConfidence;
  evidenceIds: readonly SupplierEvidenceId[];
  status: "proposed" | "active" | "rejected";
};
