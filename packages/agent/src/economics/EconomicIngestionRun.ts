import type { EconomicIngestionRun, IngestionRunStatus } from "@msl/domain";
import { INGESTION_RUN_STATUSES } from "@msl/domain";
import { createEconomicIngestionRun } from "@msl/domain";

// ── Valid transitions ──────────────────────────────────────────────────────

const VALID_TRANSITIONS: Readonly<
  Record<IngestionRunStatus, readonly IngestionRunStatus[]>
> = {
  pending: ["fetching"],
  fetching: ["normalizing"],
  normalizing: ["adapting"],
  adapting: ["computing"],
  computing: ["persisting"],
  persisting: ["completed"],
  completed: [],
  failed: [],
};

// Any non-failed status can transition to "failed".
const FAILABLE_STATUSES = new Set<IngestionRunStatus>(
  INGESTION_RUN_STATUSES.filter((s) => s !== "failed"),
);

// ── Error ──────────────────────────────────────────────────────────────────

export class IngestionRunTransitionError extends Error {
  constructor(from: IngestionRunStatus, to: IngestionRunStatus) {
    super(`Invalid run transition: "${from}" → "${to}"`);
    this.name = "IngestionRunTransitionError";
  }
}

// ── Transition function ────────────────────────────────────────────────────

/**
 * Advance an EconomicIngestionRun to a new status following the valid
 * state-machine transitions. Creates a new immutable run record;
 * the original is never mutated.
 */
export function transitionRun(
  run: EconomicIngestionRun,
  to: IngestionRunStatus,
): EconomicIngestionRun {
  // "any → failed" is always valid
  if (to === "failed") {
    if (!FAILABLE_STATUSES.has(run.status)) {
      throw new IngestionRunTransitionError(run.status, to);
    }
  } else {
    const allowed = VALID_TRANSITIONS[run.status];
    if (!allowed.includes(to)) {
      throw new IngestionRunTransitionError(run.status, to);
    }
  }

  const now = Date.now();

  const result = createEconomicIngestionRun({
    runId: run.runId,
    sellerId: run.sellerId,
    mode: run.mode,
    sourceKinds: run.sourceKinds,
    startedAt: run.startedAt,
    ...(to === "completed" || to === "failed" ? { completedAt: now } : {}),
    ...(run.checkpointAfter !== undefined
      ? { checkpointBefore: run.checkpointAfter }
      : {}),
    ...(to === "completed" || to === "failed"
      ? { checkpointAfter: `checkpoint-${to}-${now}` }
      : {}),
    recordsFetched: run.recordsFetched,
    recordsNormalized: run.recordsNormalized,
    componentsCreated: run.componentsCreated,
    snapshotsCreated: run.snapshotsCreated,
    duplicatesIgnored: run.duplicatesIgnored,
    partialSnapshots: run.partialSnapshots,
    disputedSnapshots: run.disputedSnapshots,
    errors: run.errors,
    status: to,
  });

  if (!result.success) {
    throw new IngestionRunTransitionError(run.status, to);
  }

  return result.run;
}
