import type { Currency, Money } from "./money.js";
import { randomUUID } from "node:crypto";

// ── Cost component type enumeration ────────────────────────────────────────

export const COST_COMPONENT_TYPES = [
  "product_cost",
  "marketplace_fee",
  "shipping",
  "advertising",
  "seller_discount",
  "refund",
  "return",
  "tax",
  "financing",
  "landed_cost",
  "packaging",
  "other",
] as const;

export type CostComponentType = (typeof COST_COMPONENT_TYPES)[number];

// ── Verification & source ──────────────────────────────────────────────────

export type CostVerification = "unverified" | "partially_verified" | "verified" | "disputed";

export type CostDataSource =
  "mercadolibre" | "supplier" | "customs" | "carrier" | "manual" | "derived" | "unknown";

// ── Cost component ─────────────────────────────────────────────────────────

export type EconomicCostComponent = {
  readonly id: string;
  readonly sellerId: string;
  readonly type: CostComponentType;
  readonly amount: Money;
  readonly currency: Currency;
  readonly source: CostDataSource;
  readonly sourceRecordId?: string;
  /** Stable source revision used by the seller-scoped business identity. */
  readonly sourceVersion?: string;
  /** Economic interpretation used by the seller-scoped business identity. */
  readonly economicMeaning?: string;
  /** Nullable for legacy rows whose producing run cannot be reconstructed. */
  readonly ingestionRunId?: string;
  readonly occurredAt: number;
  readonly observedAt: number;
  readonly verification: CostVerification;
  readonly confidence: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

// ── Input type (without id) ────────────────────────────────────────────────

export type EconomicCostComponentInput = Omit<EconomicCostComponent, "id" | "currency">;

// ── Errors ─────────────────────────────────────────────────────────────────

export class CostComponentTypeError extends Error {
  constructor(invalidType: string) {
    super(
      `Invalid cost component type: "${invalidType}". Valid types: ${COST_COMPONENT_TYPES.join(", ")}`,
    );
    this.name = "CostComponentTypeError";
  }
}

export class CostComponentConfidenceError extends Error {
  constructor(confidence: number) {
    super(`Confidence must be between 0 and 1, got ${confidence}`);
    this.name = "CostComponentConfidenceError";
  }
}

export class CostComponentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostComponentValidationError";
  }
}

// ── Guard ──────────────────────────────────────────────────────────────────

function isValidCostType(type: string): type is CostComponentType {
  return (COST_COMPONENT_TYPES as readonly string[]).includes(type);
}

// ── Factory ────────────────────────────────────────────────────────────────

export type CreateEconomicCostComponentResult =
  { success: true; component: EconomicCostComponent } | { success: false; error: Error };

export function createEconomicCostComponent(
  input: EconomicCostComponentInput,
): CreateEconomicCostComponentResult {
  // Validate type
  if (!isValidCostType(input.type)) {
    return { success: false, error: new CostComponentTypeError(input.type) };
  }

  // Validate confidence
  if (input.confidence < 0 || input.confidence > 1) {
    return {
      success: false,
      error: new CostComponentConfidenceError(input.confidence),
    };
  }

  // Validate sellerId
  if (!input.sellerId || input.sellerId.trim().length === 0) {
    return {
      success: false,
      error: new CostComponentValidationError("sellerId must be a non-empty string"),
    };
  }

  const id = `costcomp-${randomUUID()}`;

  return {
    success: true,
    component: {
      ...input,
      id,
      currency: input.amount.currency,
    },
  };
}
