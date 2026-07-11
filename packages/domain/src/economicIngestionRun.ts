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
  readonly status: IngestionRunStatus;
  readonly noExternalMutationExecuted: true;
};

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
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      return {
        success: false,
        error: new EconomicIngestionRunError(
          `${name} must be a non-negative integer, got ${value}`,
        ),
      };
    }
  }

  const runId =
    input.runId ??
    input.runIdFactory?.createRunId() ??
    new CryptoRunIdFactory().createRunId();

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
