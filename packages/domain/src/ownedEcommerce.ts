import type { ApprovalRecord } from "./approval.js";
import type { PreparedAction } from "./preparedAction.js";

export type OwnedEcommerceCandidateId = string;
export type StorefrontProjectionId = string;
export type StorefrontProjectionVersion = string;
export type EvidenceId = string;

export type OwnedEcommerceExecutionOperation = "publish" | "checkout-activation";

export type OwnedEcommerceExecutionTarget =
  | { type: "storefront-projection"; projectionId: StorefrontProjectionId }
  | { type: "ecommerce-catalog-item"; itemRef: string; projectionId?: StorefrontProjectionId };

export type OwnedEcommerceExecutionGateReason =
  | "missing-approval"
  | "expired-approval"
  | "approval-binding-mismatch"
  | "missing-projection-revision"
  | "stale-readiness"
  | "blocked-projection"
  | "unsafe-claim"
  | "missing-credentials"
  | "duplicate-idempotency-key"
  | "missing-audit-storage"
  | "missing-rollback-evidence";

export type OwnedEcommerceExecutionRequest = {
  operation: OwnedEcommerceExecutionOperation;
  projectionId: StorefrontProjectionId;
  projectionVersion: StorefrontProjectionVersion;
  actionId: string;
  approvalId: string;
  idempotencyKey: string;
};

export type OwnedEcommerceRollbackRef = {
  ref: string;
  projectionId: StorefrontProjectionId;
  projectionVersion: StorefrontProjectionVersion;
  operation: OwnedEcommerceExecutionOperation;
  redactedSummary: string;
  createdAt: string;
};

export type OwnedEcommerceExecutionAuditSummary = {
  auditId: string;
  projectionId: StorefrontProjectionId;
  projectionVersion: StorefrontProjectionVersion;
  actionId: string;
  approvalId: string;
  operation: OwnedEcommerceExecutionOperation;
  status: "started" | "executed" | "blocked" | "duplicate" | "failed";
  approver: "seller";
  risk: string;
  rationale: string;
  reasonCodes: OwnedEcommerceExecutionGateReason[];
  rollbackRef?: string;
  createdAt: string;
};

export type OwnedEcommerceExecutionResult =
  | { status: "executed"; auditId: string; rollbackRef: string; publicUrl?: string }
  | {
      status: "blocked" | "duplicate";
      reasonCodes: OwnedEcommerceExecutionGateReason[];
      auditId?: string;
    };

export type CandidateSourceKind =
  | "plasticov"
  | "maustian"
  | "supplier-mirror"
  | "future-supplier"
  | "read-model"
  | "cortex";

export type CandidateProvenance = {
  source: CandidateSourceKind;
  sourceId: string;
  accountId?: string;
  supplierId?: string;
  snapshotIds: string[];
  cortexNodeIds?: string[];
  evidenceIds: EvidenceId[];
};

export type EvidenceFreshness = "fresh" | "stale" | "unknown";
export type EvidenceCompleteness = "complete" | "partial" | "missing";

export type CandidateEvidenceState = {
  stockFreshness: EvidenceFreshness;
  marginFreshness: EvidenceFreshness;
  supplierFreshness: EvidenceFreshness;
  completeness: EvidenceCompleteness;
  evidenceIds: EvidenceId[];
};

export type StockAuthority =
  | "stock-authoritative"
  | "supplier-reported"
  | "read-model-estimate"
  | "unknown";

export type StorefrontCandidate = {
  id: OwnedEcommerceCandidateId;
  rank?: number;
  itemRef: string;
  title: string;
  provenance: CandidateProvenance;
  evidenceIds: EvidenceId[];
  evidenceState: CandidateEvidenceState;
  stock: {
    status: "in-stock" | "low-stock" | "out-of-stock" | "unknown";
    authority: StockAuthority;
    quantity?: number;
    evidenceId?: EvidenceId;
  };
  margin?: {
    value: number;
    currency: string;
    evidenceId: EvidenceId;
  };
  blockedReasons: GuardrailCode[];
  redactedReasons: string[];
  createdAt: string;
};

export type MedusaCatalogProjection = {
  collectionHandle: string;
  products: Array<{
    handle: string;
    title: string;
    description: string;
    categoryId?: string;
    variants: Array<{
      sku: string;
      title: string;
      price: number;
      currency: string;
      inventoryQuantity?: number;
      evidenceIds: EvidenceId[];
    }>;
    evidenceIds: EvidenceId[];
  }>;
};

export type EvidenceClaim = {
  id: string;
  text: string;
  claimType: "availability" | "price" | "origin" | "delivery" | "benefit" | "superiority";
  evidenceIds: EvidenceId[];
  status: "allowed" | "rewritten" | "blocked";
  redactedReason?: string;
};

export type OptimizedMedia = {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  hash: string;
  priority: boolean;
  evidenceIds: EvidenceId[];
};

export const OWNED_ECOMMERCE_GUARDRAIL_CODES = [
  "stale-stock-evidence",
  "stale-margin-evidence",
  "stale-supplier-evidence",
  "unknown-stock-evidence",
  "unknown-margin-evidence",
  "unknown-supplier-evidence",
  "incomplete-evidence",
  "unsupported-risky-claim",
  "secret-detected",
  "checkout-approval-required",
  "publish-approval-required",
  "price-approval-required",
  "stock-approval-required",
  "missing-readiness-check",
] as const;

export type GuardrailCode = (typeof OWNED_ECOMMERCE_GUARDRAIL_CODES)[number];

export type GuardrailSeverity = "block" | "approval-required" | "warning";

export type GuardrailResult = {
  passed: boolean;
  severity: GuardrailSeverity;
  code: GuardrailCode;
  evidenceIds: EvidenceId[];
  redactedMessage: string;
};

export type ProjectionReadiness = {
  status: "ready" | "blocked" | "approval-required";
  checks: GuardrailResult[];
  generatedAt: string;
};

export type StorefrontProjection = {
  id: StorefrontProjectionId;
  projectionVersion: StorefrontProjectionVersion;
  candidateIds: OwnedEcommerceCandidateId[];
  status: "preview" | "approved" | "published";
  catalog: MedusaCatalogProjection;
  content: {
    seoTitle: string;
    geoCopy: string;
    claims: EvidenceClaim[];
    schemaMetadata: Readonly<Record<string, unknown>>;
  };
  media: OptimizedMedia[];
  readiness: ProjectionReadiness;
  evidenceIds: EvidenceId[];
  generatedAt: string;
};

export type EcommerceAdapterPreviewResult = { previewRef: string };
export type EcommerceAdapterPublishResult = { publicUrl: string };

export type EcommerceAdapter = {
  buildPreview(input: StorefrontProjection): Promise<EcommerceAdapterPreviewResult>;
  publish(
    input: StorefrontProjection,
    approval: ApprovalRecord,
  ): Promise<EcommerceAdapterPublishResult>;
};

export type OwnedEcommercePreparedAction = PreparedAction & {
  kind:
    | "owned-ecommerce-publish"
    | "owned-ecommerce-checkout-activation"
    | "owned-ecommerce-price-change"
    | "owned-ecommerce-stock-change";
  target: OwnedEcommerceExecutionTarget;
};

export function guardrailsForCandidateEvidence(
  evidence: CandidateEvidenceState,
): GuardrailResult[] {
  const checks: GuardrailResult[] = [];
  if (evidence.stockFreshness !== "fresh") {
    checks.push({
      passed: false,
      severity: "block",
      code:
        evidence.stockFreshness === "unknown" ? "unknown-stock-evidence" : "stale-stock-evidence",
      evidenceIds: evidence.evidenceIds,
      redactedMessage:
        evidence.stockFreshness === "unknown"
          ? "Stock evidence is unavailable."
          : "Stock evidence is stale.",
    });
  }
  if (evidence.marginFreshness !== "fresh") {
    checks.push({
      passed: false,
      severity: "block",
      code:
        evidence.marginFreshness === "unknown"
          ? "unknown-margin-evidence"
          : "stale-margin-evidence",
      evidenceIds: evidence.evidenceIds,
      redactedMessage:
        evidence.marginFreshness === "unknown"
          ? "Margin evidence is unavailable."
          : "Margin evidence is stale.",
    });
  }
  if (evidence.supplierFreshness !== "fresh") {
    checks.push({
      passed: false,
      severity: "block",
      code:
        evidence.supplierFreshness === "unknown"
          ? "unknown-supplier-evidence"
          : "stale-supplier-evidence",
      evidenceIds: evidence.evidenceIds,
      redactedMessage:
        evidence.supplierFreshness === "unknown"
          ? "Supplier evidence is unavailable."
          : "Supplier evidence is stale.",
    });
  }
  if (evidence.completeness !== "complete") {
    checks.push({
      passed: false,
      severity: "block",
      code: "incomplete-evidence",
      evidenceIds: evidence.evidenceIds,
      redactedMessage: "Required storefront evidence is incomplete.",
    });
  }
  return checks;
}

export function summarizeProjectionReadiness(
  checks: GuardrailResult[],
): ProjectionReadiness["status"] {
  if (checks.some((check) => !check.passed && check.severity === "block")) return "blocked";
  if (checks.some((check) => !check.passed && check.severity === "approval-required")) {
    return "approval-required";
  }
  return "ready";
}

export function isOwnedEcommerceGuardrailCode(code: string): code is GuardrailCode {
  return (OWNED_ECOMMERCE_GUARDRAIL_CODES as readonly string[]).includes(code);
}
