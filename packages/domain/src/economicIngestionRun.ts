import type { RunIdFactory } from "./runIdFactory.js";
import { CryptoRunIdFactory } from "./runIdFactory.js";

// ── Run mode ────────────────────────────────────────────────────────────────

export const INGESTION_RUN_MODES = [
  "dry-run",
  "backfill",
  "incremental",
  "reconcile",
  "repair",
] as const;

export type IngestionRunMode = (typeof INGESTION_RUN_MODES)[number];

// ── Run status ──────────────────────────────────────────────────────────────

export const INGESTION_RUN_STATUSES = [
  "pending",
  "fetching",
  "normalizing",
  "adapting",
  "computing",
  "persisting",
  "completed",
  "failed",
] as const;

export type IngestionRunStatus = (typeof INGESTION_RUN_STATUSES)[number];

// ── Run type ────────────────────────────────────────────────────────────────

export type EconomicIngestionRun = {
  readonly runId: string;
  readonly sellerId: string;
  readonly mode: IngestionRunMode;
  readonly sourceKinds: readonly string[]; // ["orders", "items", "claims", "ads"]
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly checkpointBefore?: string;
  readonly checkpointAfter?: string;
  readonly recordsFetched: number;
  readonly recordsNormalized: number;
  readonly componentsCreated: number;
  readonly snapshotsCreated: number;
  readonly duplicatesIgnored: number;
  readonly partialSnapshots: number;
  readonly disputedSnapshots: number;
  readonly errors: readonly string[]; // sanitized error messages only
  readonly reconciliation?: DurableReconciliation;
  readonly cumulativeMetrics?: DurableCumulativeMetrics;
  readonly status: IngestionRunStatus;
  readonly noExternalMutationExecuted: true;
};

export type DurableReconciliation = {
  readonly status:
    "balanced" | "balanced-with-tolerance" | "incomplete" | "mismatched" | "disputed";
  readonly details: string;
  readonly sourceTotal?: number;
  readonly computedTotal?: number;
  readonly difference?: number;
  readonly revenueReconciliation?: {
    readonly status: "balanced" | "balanced-with-tolerance" | "mismatched" | "incomplete";
    readonly sourceTotal: number;
    readonly computedTotal: number;
    readonly difference: number;
  };
  readonly costReconciliation?: {
    readonly status: "balanced" | "balanced-with-tolerance" | "mismatched" | "incomplete";
    readonly sourceTotal: number;
    readonly computedTotal: number;
    readonly difference: number;
  };
  readonly coverage?: {
    readonly meaningful: boolean;
    readonly dimensions: Record<string, "complete" | "missing" | "observed-zero">;
  };
  readonly productCostMissing?: boolean;
  readonly landedCostMissing?: boolean;
  readonly reasonCodes: readonly string[];
};

export type DurableCumulativeMetrics =
  | {
      readonly status: "available";
      readonly components: number;
      readonly snapshots: number;
      readonly evidence: number;
      readonly runs: number;
      readonly partialSnapshots: number;
      readonly disputedSnapshots: number;
    }
  | { readonly status: "unavailable"; readonly reason: "aggregate-query-failed" };

// ── Errors ──────────────────────────────────────────────────────────────────

export class EconomicIngestionRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EconomicIngestionRunError";
  }
}

// ── Guards ──────────────────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidRunMode(value: unknown): value is IngestionRunMode {
  return (INGESTION_RUN_MODES as readonly string[]).includes(value as string);
}

function isValidRunStatus(value: unknown): value is IngestionRunStatus {
  return (INGESTION_RUN_STATUSES as readonly string[]).includes(value as string);
}

// ── Factory ─────────────────────────────────────────────────────────────────

export type CreateEconomicIngestionRunInput = {
  readonly sellerId: string;
  readonly mode: IngestionRunMode;
  readonly sourceKinds: readonly string[];
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly checkpointBefore?: string;
  readonly checkpointAfter?: string;
  readonly recordsFetched: number;
  readonly recordsNormalized: number;
  readonly componentsCreated: number;
  readonly snapshotsCreated: number;
  readonly duplicatesIgnored: number;
  readonly partialSnapshots: number;
  readonly disputedSnapshots: number;
  readonly errors: readonly string[];
  readonly status: IngestionRunStatus;
  /** Optional factory for generating run IDs. If neither runId nor runIdFactory
   * is provided, a default CryptoRunIdFactory is used. */
  readonly runIdFactory?: RunIdFactory;
  /** Optional explicit run ID override. Takes precedence over runIdFactory. */
  readonly runId?: string;
};

export type CreateEconomicIngestionRunResult =
  | { success: true; run: EconomicIngestionRun }
  | { success: false; error: EconomicIngestionRunError };

export type FinalizeEconomicIngestionRunResult = Pick<
  EconomicIngestionRun,
  | "status"
  | "completedAt"
  | "checkpointBefore"
  | "checkpointAfter"
  | "recordsFetched"
  | "recordsNormalized"
  | "componentsCreated"
  | "snapshotsCreated"
  | "duplicatesIgnored"
  | "partialSnapshots"
  | "disputedSnapshots"
  | "errors"
  | "reconciliation"
  | "cumulativeMetrics"
>;

export function createEconomicIngestionRun(
  input: CreateEconomicIngestionRunInput,
): CreateEconomicIngestionRunResult {
  // Validate sellerId
  if (!isNonEmptyString(input.sellerId)) {
    return {
      success: false,
      error: new EconomicIngestionRunError("sellerId must be a non-empty string"),
    };
  }

  // Validate mode
  if (!isValidRunMode(input.mode)) {
    return {
      success: false,
      error: new EconomicIngestionRunError(
        `mode must be one of: ${INGESTION_RUN_MODES.join(", ")}. Got: "${String(input.mode)}"`,
      ),
    };
  }

  // Validate status
  if (!isValidRunStatus(input.status)) {
    return {
      success: false,
      error: new EconomicIngestionRunError(
        `status must be one of: ${INGESTION_RUN_STATUSES.join(", ")}. Got: "${String(input.status)}"`,
      ),
    };
  }

  // Validate sourceKinds
  if (!Array.isArray(input.sourceKinds) || input.sourceKinds.length === 0) {
    return {
      success: false,
      error: new EconomicIngestionRunError("sourceKinds must be a non-empty array"),
    };
  }

  // Validate startedAt
  if (typeof input.startedAt !== "number" || !Number.isFinite(input.startedAt)) {
    return {
      success: false,
      error: new EconomicIngestionRunError("startedAt must be a finite number (epoch ms)"),
    };
  }

  // Validate non-negative counts
  const nonNegativeFields = [
    { name: "recordsFetched", value: input.recordsFetched },
    { name: "recordsNormalized", value: input.recordsNormalized },
    { name: "componentsCreated", value: input.componentsCreated },
    { name: "snapshotsCreated", value: input.snapshotsCreated },
    { name: "duplicatesIgnored", value: input.duplicatesIgnored },
    { name: "partialSnapshots", value: input.partialSnapshots },
    { name: "disputedSnapshots", value: input.disputedSnapshots },
  ] as const;

  for (const { name, value } of nonNegativeFields) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      !Number.isInteger(value)
    ) {
      return {
        success: false,
        error: new EconomicIngestionRunError(
          `${name} must be a non-negative integer, got ${value}`,
        ),
      };
    }
  }

  const runId =
    input.runId ?? input.runIdFactory?.createRunId() ?? new CryptoRunIdFactory().createRunId();

  return {
    success: true,
    run: {
      runId,
      sellerId: input.sellerId,
      mode: input.mode,
      sourceKinds: input.sourceKinds,
      startedAt: input.startedAt,
      ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      ...(input.checkpointBefore !== undefined ? { checkpointBefore: input.checkpointBefore } : {}),
      ...(input.checkpointAfter !== undefined ? { checkpointAfter: input.checkpointAfter } : {}),
      recordsFetched: input.recordsFetched,
      recordsNormalized: input.recordsNormalized,
      componentsCreated: input.componentsCreated,
      snapshotsCreated: input.snapshotsCreated,
      duplicatesIgnored: input.duplicatesIgnored,
      partialSnapshots: input.partialSnapshots,
      disputedSnapshots: input.disputedSnapshots,
      errors: input.errors,
      status: input.status,
      noExternalMutationExecuted: true,
    },
  };
}

/**
 * Produces a terminal aggregate without allocating another run identity.
 * Persistence belongs to the caller so this transition remains deterministic.
 */
export function finalizeEconomicIngestionRun(
  existingRun: EconomicIngestionRun,
  result: FinalizeEconomicIngestionRunResult,
): EconomicIngestionRun {
  if (result.status !== "completed" && result.status !== "failed") {
    throw new EconomicIngestionRunError("finalized run status must be completed or failed");
  }
  if (result.completedAt === undefined || !Number.isFinite(result.completedAt)) {
    throw new EconomicIngestionRunError("finalized run requires a finite completedAt");
  }

  return {
    ...existingRun,
    ...result,
    runId: existingRun.runId,
    sellerId: existingRun.sellerId,
    mode: existingRun.mode,
    sourceKinds: existingRun.sourceKinds,
    startedAt: existingRun.startedAt,
    noExternalMutationExecuted: true,
  };
}
