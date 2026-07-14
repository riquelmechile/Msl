import { computeUnitEconomics as compute } from "./economicCalculation.js";
import type { Currency } from "./money.js";
import type { CostComponentType, EconomicCostComponent } from "./economicCost.js";

// ── Calculation status ─────────────────────────────────────────────────────

export type CalculationStatus = "complete" | "partial" | "unverifiable" | "disputed";

// ── Unit economics snapshot ────────────────────────────────────────────────

export type MissingCostLabel = CostComponentType;

export type UnitEconomicsSnapshot = {
  readonly snapshotId: string;
  readonly sellerId: string;
  /** Nullable for legacy rows whose producing run cannot be reconstructed. */
  readonly ingestionRunId?: string;
  readonly accountId?: string;
  readonly channel?: string;
  readonly orderId?: string;
  readonly itemId?: string;
  readonly variationId?: string;
  readonly sku?: string;
  readonly product?: string;
  readonly period?: { readonly start: number; readonly end: number };
  readonly currency: Currency;
  readonly sourceVersion?: string;
  readonly economicAlgorithmVersion?: string;
  readonly economicChecksum?: string;
  readonly grossRevenue: number; // amountMinor
  readonly sellerFundedDiscounts: number;
  readonly refunds: number;
  readonly marketplaceFees: number;
  readonly sellerShippingCost: number;
  readonly advertisingCost: number;
  readonly productCost: number;
  readonly allocatedLandedCost: number;
  readonly taxes: number;
  readonly financingCost: number;
  readonly packagingCost: number;
  readonly otherCosts: number;
  readonly contributionProfit: number;
  readonly netProfit: number;
  readonly contributionMargin: number;
  readonly netMargin: number;
  readonly missingInputs: readonly MissingCostLabel[];
  readonly calculationStatus: CalculationStatus;
  readonly calculatedAt: number;
};

// ── Input type for computeUnitEconomics ────────────────────────────────────

export type UnitEconomicsInput = {
  readonly sellerId: string;
  readonly accountId?: string;
  readonly channel?: string;
  readonly orderId?: string;
  readonly itemId?: string;
  readonly variationId?: string;
  readonly sourceVersion?: string;
  readonly economicAlgorithmVersion?: string;
  readonly sku?: string;
  readonly product?: string;
  readonly period?: { readonly start: number; readonly end: number };
  readonly grossRevenue: number; // amountMinor — validated Money
  readonly currency: Currency;
  readonly costComponents: readonly EconomicCostComponent[];
};

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a UnitEconomicsSnapshot by running the calculation engine
 * against the provided cost components.
 */
export function createUnitEconomicsSnapshot(input: UnitEconomicsInput): UnitEconomicsSnapshot {
  return compute(input);
}
