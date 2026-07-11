// ── Coverage dimension ──────────────────────────────────────────────────────

export const COVERAGE_DIMENSIONS = [
  "revenue",
  "marketplace_fee",
  "shipping",
  "seller_discount",
  "refund_return",
  "advertising",
  "product_cost",
  "landed_cost",
  "currency_consistency",
  "evidence_current",
  "evidence_disputed",
  "reconciliation",
] as const;

export type CoverageDimension = (typeof COVERAGE_DIMENSIONS)[number];

// ── Coverage status ─────────────────────────────────────────────────────────

export type CoverageStatus = "complete" | "partial" | "unverifiable" | "disputed";

const VALID_COVERAGE_STATUSES: readonly CoverageStatus[] = [
  "complete",
  "partial",
  "unverifiable",
  "disputed",
];

// ── Coverage type ───────────────────────────────────────────────────────────

export type EconomicDataCoverage = {
  readonly sellerId: string;
  readonly evaluatedAt: number;
  readonly dimensions: Readonly<Record<CoverageDimension, CoverageStatus>>;
  readonly overallStatus: CoverageStatus;
  readonly confidence: number; // 0..1
  readonly missingDimensions: readonly CoverageDimension[];
  readonly disputedDimensions: readonly CoverageDimension[];
};

// ── Errors ──────────────────────────────────────────────────────────────────

export class EconomicDataCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EconomicDataCoverageError";
  }
}

// ── Guards ──────────────────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidCoverageDimension(value: unknown): value is CoverageDimension {
  return (COVERAGE_DIMENSIONS as readonly string[]).includes(value as string);
}

function isValidCoverageStatus(value: unknown): value is CoverageStatus {
  return (VALID_COVERAGE_STATUSES as readonly string[]).includes(value as string);
}

// ── Factory ─────────────────────────────────────────────────────────────────

export type CreateEconomicDataCoverageInput = {
  readonly sellerId: string;
  readonly evaluatedAt: number;
  readonly dimensions: Readonly<Record<string, CoverageStatus>>;
  readonly overallStatus: CoverageStatus;
  readonly confidence: number;
  readonly missingDimensions?: readonly CoverageDimension[];
  readonly disputedDimensions?: readonly CoverageDimension[];
};

export type CreateEconomicDataCoverageResult =
  | { success: true; coverage: EconomicDataCoverage }
  | { success: false; error: EconomicDataCoverageError };

export function createEconomicDataCoverage(
  input: CreateEconomicDataCoverageInput,
): CreateEconomicDataCoverageResult {
  // Validate sellerId
  if (!isNonEmptyString(input.sellerId)) {
    return {
      success: false,
      error: new EconomicDataCoverageError("sellerId must be a non-empty string"),
    };
  }

  // Validate evaluatedAt
  if (typeof input.evaluatedAt !== "number" || !Number.isFinite(input.evaluatedAt)) {
    return {
      success: false,
      error: new EconomicDataCoverageError("evaluatedAt must be a finite number (epoch ms)"),
    };
  }

  // Validate dimensions keys and values
  for (const [key, value] of Object.entries(input.dimensions)) {
    if (!isValidCoverageDimension(key)) {
      return {
        success: false,
        error: new EconomicDataCoverageError(
          `Invalid coverage dimension: "${String(key)}". Must be one of: ${COVERAGE_DIMENSIONS.join(", ")}`,
        ),
      };
    }
    if (!isValidCoverageStatus(value)) {
      return {
        success: false,
        error: new EconomicDataCoverageError(
          `Invalid coverage status "${String(value)}" for dimension "${String(key)}". Must be one of: ${VALID_COVERAGE_STATUSES.join(", ")}`,
        ),
      };
    }
  }

  // Validate overallStatus
  if (!isValidCoverageStatus(input.overallStatus)) {
    return {
      success: false,
      error: new EconomicDataCoverageError(
        `overallStatus must be one of: ${VALID_COVERAGE_STATUSES.join(", ")}. Got: "${String(input.overallStatus)}"`,
      ),
    };
  }

  // Validate confidence
  if (typeof input.confidence !== "number" || input.confidence < 0 || input.confidence > 1) {
    return {
      success: false,
      error: new EconomicDataCoverageError(
        `confidence must be between 0 and 1, got ${input.confidence}`,
      ),
    };
  }

  // Validate missingDimensions
  const missingDimensions = input.missingDimensions ?? [];
  for (const dim of missingDimensions) {
    if (!isValidCoverageDimension(dim)) {
      return {
        success: false,
        error: new EconomicDataCoverageError(
          `Invalid dimension in missingDimensions: "${String(dim)}"`,
        ),
      };
    }
  }

  // Validate disputedDimensions
  const disputedDimensions = input.disputedDimensions ?? [];
  for (const dim of disputedDimensions) {
    if (!isValidCoverageDimension(dim)) {
      return {
        success: false,
        error: new EconomicDataCoverageError(
          `Invalid dimension in disputedDimensions: "${String(dim)}"`,
        ),
      };
    }
  }

  return {
    success: true,
    coverage: {
      sellerId: input.sellerId,
      evaluatedAt: input.evaluatedAt,
      dimensions: input.dimensions,
      overallStatus: input.overallStatus,
      confidence: input.confidence,
      missingDimensions,
      disputedDimensions,
    },
  };
}
