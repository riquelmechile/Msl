// Inter-agent evidence request/response domain types.
// Shared payload contracts for the multi-agent evidence pipeline.

import type { SellerId } from "./seller.js";

// ---------------------------------------------------------------------------
// Enums / unions
// ---------------------------------------------------------------------------

export type EvidenceKind =
  | "cost-margin"
  | "supplier-stock"
  | "market-demand"
  | "market-competition"
  | "creative-assets"
  | "account-channel-fit"
  | "supplier-freshness"
  | "listing-performance"
  | "claim-support"
  | "unknown";

export type EvidenceTargetAgentId =
  | "cost-supplier"
  | "market-catalog"
  | "creative-assets"
  | "account-brain"
  | "supplier-manager"
  | "owned-ecommerce"
  | "operations-manager";

export type EvidenceStatus =
  "queued" | "claimed" | "answered" | "failed" | "expired" | "duplicate" | "unsupported";

export type Priority = "low" | "medium" | "high" | "critical";

export type ConfidenceLevel = "low" | "medium" | "high";

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/** A rich evidence question dispatched to a specialized responder agent. */
export type EvidenceRequestPayload = {
  type: "evidence-request";
  requestId: string;
  correlationId: string;
  /** The agent or component that created this request (e.g. "planner", "advisor"). */
  sourceAgentId: string;
  targetAgentId: EvidenceTargetAgentId;
  sellerId?: SellerId;
  candidateId?: string;
  projectionId?: string;
  supplierId?: string;
  supplierItemId?: string;
  productName?: string;
  category?: string;
  kind: EvidenceKind;
  question: string;
  reason?: string;
  priority: Priority;
  /** Lifecycle status — present when reconstructed from the store. */
  status?: EvidenceStatus;
  evidenceIds: string[];
  createdAt: string;
  expiresAt?: string;
  /** Stable key for deduplication (sha256(candidateId + kind + window)). */
  dedupeKey: string;
  /** Every evidence payload MUST carry noMutationExecuted: true (spec req). */
  noMutationExecuted: true;
};

/** A structured answer returned by a responder agent after inspecting its domain. */
export type EvidenceResponsePayload = {
  type: "evidence-response";
  responseId: string;
  requestId: string;
  correlationId: string;
  sourceAgentId: EvidenceTargetAgentId;
  /** The agent that originally requested this evidence (e.g. "planner"). */
  targetAgentId: string;
  sellerId?: SellerId;
  candidateId?: string;
  status: EvidenceStatus;
  answer?: string;
  /** Arbitrary structured evidence keyed by source domain. */
  structuredEvidence: Readonly<Record<string, unknown>>;
  evidenceIds: string[];
  confidence: ConfidenceLevel;
  /** Known gaps that lowered the confidence. */
  blockers: string[];
  /** Non-blocking warnings. */
  warnings: string[];
  createdAt: string;
  noMutationExecuted: true;
};

// ---------------------------------------------------------------------------
// Link & summary types
// ---------------------------------------------------------------------------

export type EvidenceLinkedEntityType = "candidate" | "projection" | "proposal";

/** Associates a request with a concrete business entity. */
export type EvidenceLink = {
  requestId: string;
  linkedEntityType: EvidenceLinkedEntityType;
  linkedEntityId: string;
};

/** Roll-up of evidence responses for a single candidate. */
export type EvidenceSummary = {
  candidateId: string;
  totalRequests: number;
  answeredCount: number;
  pendingCount: number;
  failedCount: number;
  responses: EvidenceResponsePayload[];
  overallConfidence: ConfidenceLevel | null;
  blockers: string[];
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Validation (lightweight — no zod dependency)
// ---------------------------------------------------------------------------

const VALID_PRIORITIES: ReadonlySet<string> = new Set(["low", "medium", "high", "critical"]);
const VALID_CONFIDENCE: ReadonlySet<string> = new Set(["low", "medium", "high"]);

export function validateEvidenceRequestPayload(
  payload: unknown,
): payload is EvidenceRequestPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    p.type === "evidence-request" &&
    typeof p.requestId === "string" &&
    p.requestId.length > 0 &&
    typeof p.correlationId === "string" &&
    p.correlationId.length > 0 &&
    typeof p.sourceAgentId === "string" &&
    typeof p.targetAgentId === "string" &&
    typeof p.kind === "string" &&
    typeof p.question === "string" &&
    typeof p.priority === "string" &&
    VALID_PRIORITIES.has(p.priority) &&
    typeof p.dedupeKey === "string" &&
    p.dedupeKey.length > 0 &&
    typeof p.createdAt === "string" &&
    Array.isArray(p.evidenceIds) &&
    p.evidenceIds.every((id) => typeof id === "string") &&
    p.noMutationExecuted === true
  );
}

export function validateEvidenceResponsePayload(
  payload: unknown,
): payload is EvidenceResponsePayload {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    p.type === "evidence-response" &&
    typeof p.responseId === "string" &&
    p.responseId.length > 0 &&
    typeof p.requestId === "string" &&
    typeof p.correlationId === "string" &&
    typeof p.sourceAgentId === "string" &&
    typeof p.status === "string" &&
    typeof p.confidence === "string" &&
    VALID_CONFIDENCE.has(p.confidence) &&
    Array.isArray(p.evidenceIds) &&
    p.evidenceIds.every((id) => typeof id === "string") &&
    Array.isArray(p.blockers) &&
    p.blockers.every((b) => typeof b === "string") &&
    Array.isArray(p.warnings) &&
    p.warnings.every((w) => typeof w === "string") &&
    typeof p.createdAt === "string" &&
    p.noMutationExecuted === true
  );
}
