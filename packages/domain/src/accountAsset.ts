import type { MarketplaceSite, SellerId } from "./seller.js";

// ── Account Strategic Types ───────────────────────────────────────────

/** Seller account as a strategic asset with capabilities, health, risk, and profit goals. */
export type AccountAsset = {
  sellerId: SellerId;
  name: string;
  marketplace: MarketplaceSite;
  capabilities: AccountCapability[];
  profitGoal: number;
  riskLevel: AccountRiskLevel;
  status: AccountAssetStatus;
  createdAt: string;
  updatedAt: string;
};

export type AccountAssetStatus = "active" | "paused" | "archived";

// ── Capabilities ──────────────────────────────────────────────────────

/** A named capability the account supports (listings, pricing, messaging, etc.). */
export type AccountCapability = {
  kind: string;
  status: AccountCapabilityStatus;
  health?: AccountHealthSnapshot;
};

export type AccountCapabilityStatus = "active" | "degraded" | "missing";

// ── Health ────────────────────────────────────────────────────────────

/** Point-in-time snapshot of account operational health. */
export type AccountHealthSnapshot = {
  /** Overall health status. */
  status: "healthy" | "degraded" | "at-risk" | "critical";
  /** MercadoLibre reputation level, if known. */
  reputation?: string;
  /** Recent sales velocity indicator. */
  salesVelocity?: number;
  /** Most recent margin profile. */
  marginProfile?: number;
  /** Current risk classification at this snapshot. */
  riskLevel?: AccountRiskLevel;
  /** ISO timestamp of when this snapshot was recorded. */
  recordedAt: string;
};

// ── Strategy ──────────────────────────────────────────────────────────

/** Account-level strategic directive set by the CEO for a specific seller. */
export type AccountStrategy = {
  /** Goal the strategy targets, e.g. "maximizar margen". */
  goal: string;
  /** Human-readable approach description. */
  approach: string;
  /** Optional guardrails or constraints. */
  constraints?: string;
  /** ISO timestamp of when the strategy was activated. */
  activeSince: string;
};

// ── Risk ──────────────────────────────────────────────────────────────

/** Risk severity levels for accounts and actions. */
export type AccountRiskLevel = "low" | "medium" | "high" | "critical";

/** A detected risk event for a specific account. */
export type AccountRisk = {
  /** What the risk is. */
  risk: string;
  /** How severe — uses the same level taxonomy. */
  severity: AccountRiskLevel;
  /** Remediation plan, if known. */
  mitigation?: string;
  /** ISO timestamp of detection. */
  detectedAt: string;
};

// ── Opportunities ────────────────────────────────────────────────────

/** A detected business opportunity for a specific account. */
export type AccountOpportunity = {
  /** What the opportunity is. */
  opportunity: string;
  /** Estimated impact description or monetary range. */
  estimatedImpact: string;
  /** Confidence 0-1 in the opportunity assessment. */
  confidence?: number;
  /** ISO timestamp of detection. */
  detectedAt: string;
};

// ── Memory Scope ──────────────────────────────────────────────────────

/**
 * Defines the visibility boundary for strategic memory artifacts.
 *
 * - `{ kind: "global" }`  → visible to all accounts (seller_id = NULL).
 * - `{ kind: "account"; sellerId; accountId? }` → visible only to the specified account.
 */
export type MemoryScope =
  { kind: "global" } | { kind: "account"; sellerId: SellerId; accountId?: string };
