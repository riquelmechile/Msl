import type { EconomicIngestionRun, IngestionRunMode, IngestionRunStatus } from "@msl/domain";
import { createClaimsBacklogIdentity } from "@msl/domain";
import Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";
import { createEconomicMigrationPlan, readEconomicDatabaseFence } from "./migrationRegistry.js";

// ── Row types ──────────────────────────────────────────────────────────────

type RunRow = {
  id: string;
  seller_id: string;
  status: string;
  mode: string;
  started_at: number | null;
  completed_at: number | null;
  params: string | null;
  result: string | null;
  error: string | null;
  checkpoint_advanced: number;
  created_at: string;
};

type CheckpointRow = {
  seller_id: string;
  last_order_date: string | null;
  last_order_id: string | null;
  last_run_id: string | null;
  occurred_at: number | null;
  source_record_id: string | null;
  updated_at: string;
};

// ── Public types ───────────────────────────────────────────────────────────

export type Checkpoint = {
  sellerId: string;
  lastOrderDate: string | null;
  lastOrderId: string | null;
  lastRunId: string | null;
  occurredAt: number | null;
  sourceRecordId: string | null;
  updatedAt: string;
};

export type SourceCheckpointKind = "orders" | "claims" | "product-ads";

export type SourceCheckpoint = {
  readonly sellerId: string;
  readonly source: SourceCheckpointKind;
  readonly occurredAt: number | null;
  readonly sourceRecordId: string | null;
  readonly version: number;
  readonly lastRunId: string;
  readonly updatedAt: number;
};

export type SourceCheckpointAdvanceInput = {
  readonly sellerId: string;
  readonly source: SourceCheckpointKind;
  readonly occurredAt: number;
  readonly sourceRecordId: string;
  readonly runId: string;
  /** The exact checkpoint observed before fetch; 0/null represents a missing row. */
  readonly expected: {
    readonly version: number;
    readonly occurredAt: number | null;
    readonly sourceRecordId: string | null;
  };
  readonly fence: { readonly generation: number; readonly tokenDigest: string };
  readonly abortSignal?: AbortSignal;
  readonly retryDelayMs?: number;
};

export type CheckpointAdvanceResult =
  | { readonly status: "advanced"; readonly checkpoint: SourceCheckpoint }
  | { readonly status: "already-applied"; readonly checkpoint: SourceCheckpoint }
  | { readonly status: "stale"; readonly checkpoint: SourceCheckpoint }
  | { readonly status: "concurrent"; readonly checkpoint: SourceCheckpoint | null }
  | { readonly status: "missing" }
  | { readonly status: "retry-exhausted" };

export type SellerLeaseConfig = {
  readonly ttlMs: number;
  readonly renewIntervalMs: number;
  readonly recoveryGraceMs: number;
};

export const DEFAULT_SELLER_LEASE_CONFIG: SellerLeaseConfig = {
  ttlMs: 60_000,
  renewIntervalMs: 20_000,
  recoveryGraceMs: 15_000,
};

/** Typed durable-ownership loss contract; R5 wires it to the global abort controller. */
export class EconomicLeaseOwnershipLostError extends Error {
  readonly code = "lease-lost";

  constructor() {
    super("Economic seller lease rejected");
    this.name = "EconomicLeaseOwnershipLostError";
  }
}

export type SellerLeaseFence = {
  readonly generation: number;
  readonly tokenDigest: string;
  readonly databaseGeneration: number;
};

export type SellerLease = {
  readonly sellerId: string;
  readonly ownerRunId: string;
  /** Returned only to the acquiring owner; SQLite stores its SHA-256 digest. */
  readonly token: string;
  readonly generation: number;
  readonly databaseGeneration: number;
  readonly fenceGeneration: number;
  readonly expiresAt: number;
};

export type SellerLeaseHandle = Omit<SellerLease, "sellerId">;

export type SellerLeaseAcquireResult =
  | { readonly status: "acquired" | "recovered"; readonly lease: SellerLease }
  | { readonly status: "held"; readonly ownerRunId: string; readonly expiresAt: number }
  | { readonly status: "database-fenced" | "database-generation-mismatch" };

export type SellerLeaseRenewResult =
  | { readonly status: "renewed"; readonly lease: SellerLease }
  | {
      readonly status:
        | "not-owner"
        | "stale-generation"
        | "lease-replaced"
        | "expired"
        | "database-fenced"
        | "database-generation-mismatch";
    };

export type SellerLeaseReleaseResult =
  | { readonly status: "released" }
  | {
      readonly status:
        | "already-released"
        | "not-owner"
        | "stale-generation"
        | "lease-replaced"
        | "database-fenced"
        | "database-generation-mismatch";
    };

export type SellerLeaseStoreOptions = {
  readonly now?: () => number;
  readonly leaseConfig?: Partial<SellerLeaseConfig>;
  readonly skipMigration?: boolean;
  /** Test-only failure seam for proving cancellation transaction rollback. */
  readonly administrativeCancellationFaultInjector?: (
    boundary: AdministrativeCancellationFaultBoundary,
  ) => void;
};

export type ClaimsBacklogState =
  "pending" | "leased" | "retrying" | "resolved" | "dead-letter" | "administratively-cancelled";

export type ClaimsBacklog = {
  readonly identityKey: string;
  readonly sellerId: string;
  readonly state: ClaimsBacklogState;
  readonly attemptCount: number;
  readonly nextAttemptAt: number;
  readonly claimOwner: string | null;
  readonly claimGeneration: number | null;
  readonly claimExpiresAt: number | null;
};

export type ClaimsBacklogClaim = {
  readonly identityKey: string;
  readonly sellerId: string;
  readonly ownerRunId: string;
  readonly token: string;
  readonly generation: number;
  readonly expiresAt: number;
};

export const ADMINISTRATIVE_CANCELLATION_ALERT_VERSION = 1 as const;
export const ADMINISTRATIVE_CANCELLATION_ALERT_TYPE =
  "claims-backlog-administratively-cancelled" as const;
export const ADMINISTRATIVE_CANCELLATION_ALERT_SEVERITY = "warning" as const;

export type OperationalAlertIntent = {
  readonly intentId: string;
  readonly dedupKey: string;
  readonly sellerId: string;
  readonly alertType: typeof ADMINISTRATIVE_CANCELLATION_ALERT_TYPE;
  readonly severity: typeof ADMINISTRATIVE_CANCELLATION_ALERT_SEVERITY;
  readonly reasonCode: "administratively-cancelled";
  readonly source: "claims";
  readonly relatedBacklogIdentityKey: string;
  readonly cancellationVersion: typeof ADMINISTRATIVE_CANCELLATION_ALERT_VERSION;
  readonly metadata: Readonly<{
    cancellationVersion: 1;
    backlogState: "administratively-cancelled";
  }>;
  readonly status: "pending" | "consumed";
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly consumedAt: number | null;
};

export type OperationalAlertIntentCreateResult =
  | { readonly status: "created"; readonly intent: OperationalAlertIntent }
  | { readonly status: "existing"; readonly intent: OperationalAlertIntent };

export type OperationalAlertIntentConsumeResult =
  | { readonly status: "consumed"; readonly intent: OperationalAlertIntent }
  | { readonly status: "already-consumed"; readonly intent: OperationalAlertIntent }
  | { readonly status: "not-found" }
  | { readonly status: "wrong-seller" };

export type AdministrativeCancellationFaultBoundary =
  "after-backlog" | "after-audit" | "after-intent" | "before-commit";

export type SourceHealth = {
  readonly sellerId: string;
  readonly source: "orders" | "claims" | "product-ads";
  readonly ready: boolean;
  readonly reasonCode: string | null;
  readonly requestedAt: number;
  readonly attempts: number;
  readonly pages: number;
  readonly records: number;
  readonly retryable: boolean;
  readonly retryAt: number | null;
  readonly backlogIdentityKey: string | null;
  readonly updatedAt: number;
};

export const DEFAULT_CLAIMS_BACKLOG_CONFIG = {
  ttlMs: 120_000,
  renewIntervalMs: 40_000,
  recoveryIntervalMs: 30_000,
  maxAttempts: 4,
} as const;

export type CreateRunInput = {
  runId: string;
  sellerId: string;
  mode: IngestionRunMode;
  status: IngestionRunStatus;
  startedAt?: number;
  completedAt?: number;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  checkpointAdvanced?: boolean;
};

export type UpdateRunInput = {
  status?: IngestionRunStatus;
  completedAt?: number;
  result?: Record<string, unknown>;
  error?: string;
  checkpointAdvanced?: boolean;
};

export type EconomicIngestionRunStore = {
  /** Available on SQLite implementations for shared-transaction assertions. */
  getDb?: () => Database.Database;
  createRun(run: CreateRunInput): Promise<EconomicIngestionRun>;
  updateRun(id: string, updates: UpdateRunInput): Promise<EconomicIngestionRun>;
  getRun(id: string): Promise<EconomicIngestionRun | null>;
  getLastRunBySeller(sellerId: string): Promise<EconomicIngestionRun | null>;
  listRunsBySeller(sellerId: string, limit?: number): Promise<EconomicIngestionRun[]>;
  countRunsBySeller?(sellerId: string): number;
  getActiveRun(sellerId: string): Promise<EconomicIngestionRun | null>;
  recoverAbandonedRun(sellerId: string): Promise<void>;
  getCheckpoint(sellerId: string): Promise<Checkpoint | null>;
  updateCheckpoint(
    sellerId: string,
    data: {
      lastOrderDate?: string;
      lastOrderId?: string;
      lastRunId?: string;
      occurredAt?: number;
      sourceRecordId?: string;
    },
  ): Promise<void>;
  getSourceCheckpoint?(
    sellerId: string,
    source: SourceCheckpointKind,
  ): Promise<SourceCheckpoint | null>;
  advanceSourceCheckpoint?(input: SourceCheckpointAdvanceInput): Promise<CheckpointAdvanceResult>;
  acquireSellerLease?(input: {
    sellerId: string;
    ownerRunId: string;
    fence: SellerLeaseFence;
  }): Promise<SellerLeaseAcquireResult>;
  renewSellerLease?(input: {
    sellerId: string;
    ownerRunId: string;
    token: string;
    generation: number;
    fence: SellerLeaseFence;
  }): Promise<SellerLeaseRenewResult>;
  releaseSellerLease?(input: {
    sellerId: string;
    ownerRunId: string;
    token: string;
    generation: number;
    fence: SellerLeaseFence;
  }): Promise<SellerLeaseReleaseResult>;
  upsertClaimsBacklog?(input: {
    sellerId: string;
    range: { from: number | null; to: number | null };
    cursor: { afterOccurredAt: number | null; afterSourceRecordId: string | null };
    purpose: "claims-recovery";
    reasonCode: string;
    retryable: boolean;
    retryAfterMs: number | null;
    runId: string;
    fence: SellerLeaseFence;
  }): Promise<ClaimsBacklog>;
  getClaimsBacklog?(identityKey: string): Promise<ClaimsBacklog | null>;
  claimDueClaimsBacklog?(input: {
    sellerId: string;
    ownerRunId: string;
    fence: SellerLeaseFence;
  }): Promise<{ status: "claimed"; claim: ClaimsBacklogClaim } | { status: "none-due" }>;
  markClaimsRequestStarted?(
    input: ClaimsBacklogClaim & { fence: SellerLeaseFence },
  ): Promise<{ status: "started"; attemptCount: number } | { status: "stale-or-replaced" }>;
  retryClaimsBacklog?(
    input: ClaimsBacklogClaim & {
      fence: SellerLeaseFence;
      reasonCode: string;
      retryAfterMs: number | null;
    },
  ): Promise<{ status: "pending" | "dead-letter" | "stale-or-replaced" }>;
  resolveClaimsBacklog?(
    input: ClaimsBacklogClaim & { fence: SellerLeaseFence },
  ): Promise<{ status: "resolved" | "stale-or-replaced" }>;
  returnClaimsBacklogToPending?(
    input: ClaimsBacklogClaim & { fence: SellerLeaseFence; requestStarted: boolean },
  ): Promise<{ status: "pending" | "stale-or-replaced" }>;
  recoverExpiredClaimsBacklog?(input: {
    sellerId: string;
    fence: SellerLeaseFence;
  }): Promise<{ recovered: number; deferred: number }>;
  cancelClaimsBacklog?(input: {
    sellerId: string;
    identityKey: string;
    actor: string;
    approver: string;
    reason: string;
    fence: SellerLeaseFence;
  }): Promise<{ status: "administratively-cancelled" | "stale-or-replaced" }>;
  createOperationalAlertIntent?(input: {
    sellerId: string;
    relatedBacklogIdentityKey: string;
  }): Promise<OperationalAlertIntentCreateResult>;
  getOperationalAlertIntent?(input: {
    sellerId: string;
    intentId: string;
  }): Promise<OperationalAlertIntent | null>;
  listOperationalAlertIntents?(input: {
    sellerId: string;
    status?: OperationalAlertIntent["status"];
    limit?: number;
  }): Promise<readonly OperationalAlertIntent[]>;
  countPendingOperationalAlertIntents?(sellerId: string): Promise<number>;
  markOperationalAlertIntentConsumed?(input: {
    sellerId: string;
    intentId: string;
  }): Promise<OperationalAlertIntentConsumeResult>;
  replayClaimsBacklog?(input: {
    sellerId: string;
    identityKey: string;
    actor: string;
    approver: string;
    reason: string;
    fence: SellerLeaseFence;
  }): Promise<{ status: "replayed" | "stale-or-replaced" }>;
  recordSourceHealth?(
    input: Omit<SourceHealth, "updatedAt"> & { fence: SellerLeaseFence },
  ): Promise<void>;
  getSourceHealth?(sellerId: string, source: SourceHealth["source"]): Promise<SourceHealth | null>;
};

// ── Sanitization ───────────────────────────────────────────────────────────

/**
 * Strip file paths and stack traces from error strings.
 * Stack traces that reveal local filesystem paths are not exported.
 */
function sanitizeError(raw: string): string {
  // Remove stack traces that contain file paths (lines starting with whitespace
  // followed by "at " and a path string).
  const lines = raw.split("\n");
  const cleaned = lines
    .filter((line) => {
      const trimmed = line.trimStart();
      // Strip typical stack trace lines
      if (trimmed.startsWith("at ") && (trimmed.includes("/") || trimmed.includes("\\"))) {
        return false;
      }
      // Strip "at ..." lines generally
      if (trimmed.startsWith("at ")) {
        return false;
      }
      return true;
    })
    .join("\n");
  return cleaned.trim();
}

// ── Row → domain conversion ────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseParams(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reconstruct an EconomicIngestionRun from a database row.
 *
 * Bypasses the domain factory because rows persisted to the store were already
 * validated on creation. Reconstruction should faithfully reflect what was stored
 * regardless of intermediate statuses (e.g., "running" is valid at the persistence
 * layer even though the domain type narrows to specific statuses).
 */
function runFromRow(row: RunRow): EconomicIngestionRun {
  const parsedParams = parseParams(row.params);
  const parsedResult = parseParams(row.result);

  return {
    runId: row.id,
    sellerId: row.seller_id,
    mode: row.mode as IngestionRunMode,
    sourceKinds: (parsedParams?.sourceKinds as readonly string[]) ?? [
      "orders",
      "items",
      "claims",
      "ads",
    ],
    startedAt: row.started_at ?? 0,
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
    recordsFetched: (parsedResult?.recordsFetched as number) ?? 0,
    recordsNormalized: (parsedResult?.recordsNormalized as number) ?? 0,
    componentsCreated: (parsedResult?.componentsCreated as number) ?? 0,
    snapshotsCreated: (parsedResult?.snapshotsCreated as number) ?? 0,
    duplicatesIgnored: (parsedResult?.duplicatesIgnored as number) ?? 0,
    partialSnapshots: (parsedResult?.partialSnapshots as number) ?? 0,
    disputedSnapshots: (parsedResult?.disputedSnapshots as number) ?? 0,
    errors: Array.isArray(parsedResult?.errors)
      ? parsedResult.errors.filter((value): value is string => typeof value === "string")
      : row.error
        ? [row.error]
        : [],
    status: row.status as IngestionRunStatus,
    noExternalMutationExecuted: true,
    ...(typeof parsedResult?.checkpointBefore === "string"
      ? { checkpointBefore: parsedResult.checkpointBefore }
      : {}),
    ...(typeof parsedResult?.checkpointAfter === "string"
      ? { checkpointAfter: parsedResult.checkpointAfter }
      : {}),
    ...(isRecord(parsedResult?.reconciliation)
      ? {
          reconciliation: parsedResult.reconciliation as NonNullable<
            EconomicIngestionRun["reconciliation"]
          >,
        }
      : {}),
    ...(isRecord(parsedResult?.cumulativeMetrics)
      ? {
          cumulativeMetrics: parsedResult.cumulativeMetrics as NonNullable<
            EconomicIngestionRun["cumulativeMetrics"]
          >,
        }
      : {}),
  };
}

function checkpointFromRow(row: CheckpointRow): Checkpoint {
  return {
    sellerId: row.seller_id,
    lastOrderDate: row.last_order_date,
    lastOrderId: row.last_order_id,
    lastRunId: row.last_run_id,
    occurredAt: row.occurred_at,
    sourceRecordId: row.source_record_id,
    updatedAt: row.updated_at,
  };
}

type SourceCheckpointRow = {
  seller_id: string;
  source: SourceCheckpointKind;
  occurred_at: number | null;
  source_record_id: string | null;
  version: number;
  last_run_id: string;
  updated_at: number;
};

function sourceCheckpointFromRow(row: SourceCheckpointRow): SourceCheckpoint {
  return {
    sellerId: row.seller_id,
    source: row.source,
    occurredAt: row.occurred_at,
    sourceRecordId: row.source_record_id,
    version: row.version,
    lastRunId: row.last_run_id,
    updatedAt: row.updated_at,
  };
}

function compareSourceCursor(
  left: { occurredAt: number; sourceRecordId: string },
  right: { occurredAt: number; sourceRecordId: string },
): number {
  return left.occurredAt === right.occurredAt
    ? left.sourceRecordId.localeCompare(right.sourceRecordId)
    : left.occurredAt - right.occurredAt;
}

function classifySourceCheckpoint(
  input: Pick<SourceCheckpointAdvanceInput, "occurredAt" | "sourceRecordId">,
  row: SourceCheckpointRow | undefined,
): Exclude<
  CheckpointAdvanceResult,
  | { readonly status: "advanced" }
  | { readonly status: "missing" }
  | { readonly status: "retry-exhausted" }
> {
  if (!row) return { status: "concurrent", checkpoint: null };
  const checkpoint = sourceCheckpointFromRow(row);
  if (checkpoint.occurredAt !== null && checkpoint.sourceRecordId !== null) {
    const relation = compareSourceCursor(
      { occurredAt: input.occurredAt, sourceRecordId: input.sourceRecordId },
      { occurredAt: checkpoint.occurredAt, sourceRecordId: checkpoint.sourceRecordId },
    );
    if (relation === 0) return { status: "already-applied", checkpoint };
    if (relation < 0) return { status: "stale", checkpoint };
  }
  return { status: "concurrent", checkpoint };
}

function assertOpenFence(
  db: Database.Database,
  expected: SourceCheckpointAdvanceInput["fence"],
): void {
  const fence = readEconomicDatabaseFence(db);
  if (
    fence.state !== "open" ||
    fence.generation !== expected.generation ||
    fence.tokenDigest !== expected.tokenDigest
  ) {
    throw new Error("Economic checkpoint writer fence rejected");
  }
}

function isBusy(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("SQLITE_BUSY") || error.message.includes("SQLITE_LOCKED"))
  );
}

function waitForCheckpointRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

type SellerLeaseRow = {
  seller_id: string;
  owner_run_id: string;
  lease_token_digest: string;
  generation: number;
  database_generation: number;
  fence_generation: number;
  expires_at: number;
  updated_at: number;
};

type ClaimsBacklogRow = {
  backlog_identity_key: string;
  seller_id: string;
  state: ClaimsBacklogState;
  attempt_count: number;
  next_attempt_at: number;
  claim_owner: string | null;
  claim_token_digest: string | null;
  claim_generation: number | null;
  claim_expires_at: number | null;
};

type SourceHealthRow = {
  seller_id: string;
  source: SourceHealth["source"];
  ready: number;
  reason_code: string | null;
  requested_at: number;
  attempts: number;
  pages: number;
  records: number;
  retryable: number;
  retry_at: number | null;
  backlog_identity_key: string | null;
  updated_at: number;
};

type OperationalAlertIntentRow = {
  intent_id: string;
  dedup_key: string;
  seller_id: string;
  alert_type: typeof ADMINISTRATIVE_CANCELLATION_ALERT_TYPE;
  severity: typeof ADMINISTRATIVE_CANCELLATION_ALERT_SEVERITY;
  reason_code: "administratively-cancelled";
  source: "claims";
  related_backlog_identity_key: string;
  cancellation_version: 1;
  metadata_json: string;
  status: "pending" | "consumed";
  created_at: number;
  updated_at: number;
  consumed_at: number | null;
};

function claimsBacklogFromRow(row: ClaimsBacklogRow): ClaimsBacklog {
  return {
    identityKey: row.backlog_identity_key,
    sellerId: row.seller_id,
    state: row.state,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    claimOwner: row.claim_owner,
    claimGeneration: row.claim_generation,
    claimExpiresAt: row.claim_expires_at,
  };
}

function sourceHealthFromRow(row: SourceHealthRow): SourceHealth {
  return {
    sellerId: row.seller_id,
    source: row.source,
    ready: row.ready === 1,
    reasonCode: row.reason_code,
    requestedAt: row.requested_at,
    attempts: row.attempts,
    pages: row.pages,
    records: row.records,
    retryable: row.retryable === 1,
    retryAt: row.retry_at,
    backlogIdentityKey: row.backlog_identity_key,
    updatedAt: row.updated_at,
  };
}

function operationalAlertIntentFromRow(row: OperationalAlertIntentRow): OperationalAlertIntent {
  return {
    intentId: row.intent_id,
    dedupKey: row.dedup_key,
    sellerId: row.seller_id,
    alertType: row.alert_type,
    severity: row.severity,
    reasonCode: row.reason_code,
    source: row.source,
    relatedBacklogIdentityKey: row.related_backlog_identity_key,
    cancellationVersion: row.cancellation_version,
    metadata: { cancellationVersion: 1, backlogState: "administratively-cancelled" },
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    consumedAt: row.consumed_at,
  };
}

/** Stable, PII-free identity for the only R4b-owned operational alert intent. */
export function createAdministrativeCancellationAlertDedupKey(input: {
  sellerId: string;
  backlogIdentityKey: string;
}): string {
  return createHash("sha256")
    .update(
      `${input.sellerId.length}:${input.sellerId}|${ADMINISTRATIVE_CANCELLATION_ALERT_TYPE.length}:${ADMINISTRATIVE_CANCELLATION_ALERT_TYPE}|${input.backlogIdentityKey.length}:${input.backlogIdentityKey}|${ADMINISTRATIVE_CANCELLATION_ALERT_VERSION}`,
      "utf8",
    )
    .digest("hex");
}

function createOperationalAlertIntentInTx(
  db: Database.Database,
  input: { sellerId: string; relatedBacklogIdentityKey: string },
  timestamp: number,
): OperationalAlertIntentCreateResult {
  const dedupKey = createAdministrativeCancellationAlertDedupKey({
    sellerId: input.sellerId,
    backlogIdentityKey: input.relatedBacklogIdentityKey,
  });
  const inserted = db
    .prepare(
      `INSERT INTO economic_operational_alert_intents
       (intent_id, dedup_key, seller_id, alert_type, severity, reason_code, source,
        related_backlog_identity_key, cancellation_version, metadata_json, status,
        created_at, updated_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, 'administratively-cancelled', 'claims', ?, 1, ?, 'pending', ?, ?, NULL)
       ON CONFLICT(dedup_key) DO NOTHING`,
    )
    .run(
      dedupKey,
      dedupKey,
      input.sellerId,
      ADMINISTRATIVE_CANCELLATION_ALERT_TYPE,
      ADMINISTRATIVE_CANCELLATION_ALERT_SEVERITY,
      input.relatedBacklogIdentityKey,
      JSON.stringify({ cancellationVersion: 1, backlogState: "administratively-cancelled" }),
      timestamp,
      timestamp,
    );
  const row = db
    .prepare("SELECT * FROM economic_operational_alert_intents WHERE dedup_key = ?")
    .get(dedupKey) as OperationalAlertIntentRow;
  return {
    status: inserted.changes === 1 ? "created" : "existing",
    intent: operationalAlertIntentFromRow(row),
  };
}

function resolveLeaseConfig(config: Partial<SellerLeaseConfig> | undefined): SellerLeaseConfig {
  const resolved = { ...DEFAULT_SELLER_LEASE_CONFIG, ...config };
  if (
    !Number.isInteger(resolved.ttlMs) ||
    !Number.isInteger(resolved.renewIntervalMs) ||
    !Number.isInteger(resolved.recoveryGraceMs) ||
    resolved.ttlMs <= 0 ||
    resolved.renewIntervalMs <= 0 ||
    resolved.recoveryGraceMs < 0 ||
    resolved.renewIntervalMs >= resolved.ttlMs
  ) {
    throw new Error("Invalid seller lease configuration");
  }
  return resolved;
}

function digestLeaseToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function createLeaseToken(): string {
  return randomBytes(32).toString("base64url");
}

function readLeaseFence(
  db: Database.Database,
  expected: SellerLeaseFence,
): "ok" | "database-fenced" | "database-generation-mismatch" {
  try {
    const fence = readEconomicDatabaseFence(db);
    if (
      fence.state !== "open" ||
      fence.fenceGeneration !== expected.generation ||
      fence.tokenDigest !== expected.tokenDigest
    ) {
      return "database-fenced";
    }
    return fence.generation === expected.databaseGeneration ? "ok" : "database-generation-mismatch";
  } catch {
    return "database-fenced";
  }
}

function sellerLeaseFromRow(row: SellerLeaseRow, token: string): SellerLease {
  return {
    sellerId: row.seller_id,
    ownerRunId: row.owner_run_id,
    token,
    generation: row.generation,
    databaseGeneration: row.database_generation,
    fenceGeneration: row.fence_generation,
    expiresAt: row.expires_at,
  };
}

function inImmediateTransaction<T>(db: Database.Database, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function acquireSellerLeaseInTx(
  db: Database.Database,
  input: { sellerId: string; ownerRunId: string; fence: SellerLeaseFence },
  config: SellerLeaseConfig,
  clock: () => number,
  getLease: Database.Statement,
): SellerLeaseAcquireResult {
  return inImmediateTransaction(db, () => {
    const fenceStatus = readLeaseFence(db, input.fence);
    if (fenceStatus !== "ok") return { status: fenceStatus };
    const timestamp = clock();
    const current = getLease.get(input.sellerId) as SellerLeaseRow | undefined;
    if (current && current.expires_at + config.recoveryGraceMs > timestamp) {
      return { status: "held", ownerRunId: current.owner_run_id, expiresAt: current.expires_at };
    }
    const token = createLeaseToken();
    const digest = digestLeaseToken(token);
    const generation = (current?.generation ?? 0) + 1;
    const expiresAt = timestamp + config.ttlMs;
    const changed = current
      ? db
          .prepare(
            `UPDATE economic_seller_leases
             SET owner_run_id = ?, lease_token_digest = ?, generation = ?, database_generation = ?,
                 fence_generation = ?, expires_at = ?, updated_at = ?
             WHERE seller_id = ? AND generation = ? AND expires_at + ? <= ?`,
          )
          .run(
            input.ownerRunId,
            digest,
            generation,
            input.fence.databaseGeneration,
            input.fence.generation,
            expiresAt,
            timestamp,
            input.sellerId,
            current.generation,
            config.recoveryGraceMs,
            timestamp,
          ).changes
      : db
          .prepare(
            `INSERT INTO economic_seller_leases
             (seller_id, owner_run_id, lease_token_digest, generation, database_generation,
              fence_generation, expires_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.sellerId,
            input.ownerRunId,
            digest,
            generation,
            input.fence.databaseGeneration,
            input.fence.generation,
            expiresAt,
            timestamp,
          ).changes;
    if (changed !== 1)
      return {
        status: "held",
        ownerRunId: current?.owner_run_id ?? "",
        expiresAt: current?.expires_at ?? timestamp,
      };
    const readback = getLease.get(input.sellerId) as SellerLeaseRow | undefined;
    if (
      !readback ||
      readback.owner_run_id !== input.ownerRunId ||
      readback.lease_token_digest !== digest ||
      readback.generation !== generation
    ) {
      throw new Error("Seller lease acquire readback rejected");
    }
    return {
      status: current ? "recovered" : "acquired",
      lease: sellerLeaseFromRow(readback, token),
    };
  });
}

function classifyLeaseOwner(
  row: SellerLeaseRow | undefined,
  input: { ownerRunId: string; token: string; generation: number },
): "not-owner" | "stale-generation" | "lease-replaced" {
  if (!row) return "lease-replaced";
  if (row.owner_run_id !== input.ownerRunId) return "not-owner";
  if (row.generation !== input.generation) return "stale-generation";
  return row.lease_token_digest === digestLeaseToken(input.token)
    ? "lease-replaced"
    : "lease-replaced";
}

function renewSellerLeaseInTx(
  db: Database.Database,
  input: {
    sellerId: string;
    ownerRunId: string;
    token: string;
    generation: number;
    fence: SellerLeaseFence;
  },
  config: SellerLeaseConfig,
  clock: () => number,
  getLease: Database.Statement,
): SellerLeaseRenewResult {
  return inImmediateTransaction(db, () => {
    const fenceStatus = readLeaseFence(db, input.fence);
    if (fenceStatus !== "ok") return { status: fenceStatus };
    const timestamp = clock();
    const digest = digestLeaseToken(input.token);
    const changed = db
      .prepare(
        `UPDATE economic_seller_leases SET expires_at = ?, updated_at = ?
       WHERE seller_id = ? AND owner_run_id = ? AND lease_token_digest = ? AND generation = ?
         AND database_generation = ? AND fence_generation = ? AND expires_at > ?`,
      )
      .run(
        timestamp + config.ttlMs,
        timestamp,
        input.sellerId,
        input.ownerRunId,
        digest,
        input.generation,
        input.fence.databaseGeneration,
        input.fence.generation,
        timestamp,
      );
    if (changed.changes !== 1) {
      const row = getLease.get(input.sellerId) as SellerLeaseRow | undefined;
      if (
        row?.owner_run_id === input.ownerRunId &&
        row.generation === input.generation &&
        row.lease_token_digest === digest &&
        row.expires_at <= timestamp
      )
        return { status: "expired" };
      return { status: classifyLeaseOwner(row, input) };
    }
    const row = getLease.get(input.sellerId) as SellerLeaseRow;
    return { status: "renewed", lease: sellerLeaseFromRow(row, input.token) };
  });
}

function releaseSellerLeaseInTx(
  db: Database.Database,
  input: {
    sellerId: string;
    ownerRunId: string;
    token: string;
    generation: number;
    fence: SellerLeaseFence;
  },
  clock: () => number,
  getLease: Database.Statement,
): SellerLeaseReleaseResult {
  return inImmediateTransaction(db, () => {
    const fenceStatus = readLeaseFence(db, input.fence);
    if (fenceStatus !== "ok") return { status: fenceStatus };
    const changed = db
      .prepare(
        `DELETE FROM economic_seller_leases
       WHERE seller_id = ? AND owner_run_id = ? AND lease_token_digest = ? AND generation = ?
         AND database_generation = ? AND fence_generation = ?`,
      )
      .run(
        input.sellerId,
        input.ownerRunId,
        digestLeaseToken(input.token),
        input.generation,
        input.fence.databaseGeneration,
        input.fence.generation,
      );
    if (changed.changes === 1) return { status: "released" };
    const row = getLease.get(input.sellerId) as SellerLeaseRow | undefined;
    if (!row) return { status: "already-released" };
    const classification = classifyLeaseOwner(row, input);
    return { status: classification === "lease-replaced" ? "lease-replaced" : classification };
  });
}

/** Throws unless the exact unexpired owner/token/generation still owns the lease. */
export function assertSellerLeaseOwnershipInTx(
  db: Database.Database,
  input: {
    readonly sellerId: string;
    readonly ownerRunId: string;
    readonly token: string;
    readonly generation: number;
    readonly databaseGeneration: number;
    readonly fenceGeneration: number;
  },
  timestamp = Date.now(),
): void {
  const row = db
    .prepare(`SELECT * FROM economic_seller_leases WHERE seller_id = ?`)
    .get(input.sellerId) as SellerLeaseRow | undefined;
  if (
    !row ||
    row.owner_run_id !== input.ownerRunId ||
    row.lease_token_digest !== digestLeaseToken(input.token) ||
    row.generation !== input.generation ||
    row.database_generation !== input.databaseGeneration ||
    row.fence_generation !== input.fenceGeneration ||
    row.expires_at <= timestamp
  ) {
    throw new EconomicLeaseOwnershipLostError();
  }
}

// ── Migration ──────────────────────────────────────────────────────────────

export function migrateEconomicIngestionRunStore(db: Database.Database): void {
  // Legacy callers retain this entry point, but the canonical plan is the only
  // DDL owner. In particular, 1007/1008 must never race or diverge here.
  createEconomicMigrationPlan().apply(db);
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createSqliteEconomicIngestionRunStore(
  db: Database.Database,
  options: SellerLeaseStoreOptions = {},
): EconomicIngestionRunStore {
  if (!options.skipMigration && process.env.MSL_MIGRATION_ENABLED !== "true") {
    migrateEconomicIngestionRunStore(db);
  }

  const leaseConfig = resolveLeaseConfig(options.leaseConfig);
  const now = options.now ?? Date.now;
  // ── Prepared statements ────────────────────────────────────────────────

  const insertRunStmt = db.prepare(`
    INSERT INTO economic_ingestion_runs
      (id, seller_id, status, mode, started_at, completed_at, params, result, error, checkpoint_advanced, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateRunStmt = db.prepare(`
    UPDATE economic_ingestion_runs
    SET status = COALESCE(?, status),
         completed_at = COALESCE(?, completed_at),
         result = COALESCE(?, result),
         error = COALESCE(?, error),
         checkpoint_advanced = COALESCE(?, checkpoint_advanced)
    WHERE id = ?
  `);

  const getRunStmt = db.prepare("SELECT * FROM economic_ingestion_runs WHERE id = ?");

  const getLastRunStmt = db.prepare(`
    SELECT * FROM economic_ingestion_runs
    WHERE seller_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const listRunsStmt = db.prepare(`
    SELECT * FROM economic_ingestion_runs
    WHERE seller_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const countRunsStmt = db.prepare(
    "SELECT COUNT(*) AS count FROM economic_ingestion_runs WHERE seller_id = ?",
  );

  const getActiveRunStmt = db.prepare(`
    SELECT * FROM economic_ingestion_runs
    WHERE seller_id = ? AND status IN ('pending', 'fetching', 'normalizing', 'adapting', 'computing', 'persisting')
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const recoverAbandonedRunsStmt = db.prepare(`
    UPDATE economic_ingestion_runs
    SET status = 'failed',
        error = 'Recovered: previous run was abandoned (process restart).',
        completed_at = strftime('%s', 'now') * 1000
    WHERE seller_id = ? AND status IN ('pending', 'fetching', 'normalizing', 'adapting', 'computing', 'persisting')
  `);

  const getCheckpointStmt = db.prepare(`
    SELECT * FROM economic_ingestion_checkpoints
    WHERE seller_id = ?
  `);

  const upsertCheckpointStmt = db.prepare(`
    INSERT INTO economic_ingestion_checkpoints
      (seller_id, last_order_date, last_order_id, last_run_id, occurred_at, source_record_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(seller_id) DO UPDATE SET
      last_order_date = COALESCE(excluded.last_order_date, economic_ingestion_checkpoints.last_order_date),
      last_order_id = COALESCE(excluded.last_order_id, economic_ingestion_checkpoints.last_order_id),
      last_run_id = COALESCE(excluded.last_run_id, economic_ingestion_checkpoints.last_run_id),
      occurred_at = COALESCE(excluded.occurred_at, economic_ingestion_checkpoints.occurred_at),
      source_record_id = COALESCE(excluded.source_record_id, economic_ingestion_checkpoints.source_record_id),
      updated_at = excluded.updated_at
  `);
  const getSourceCheckpointStmt = db.prepare(`SELECT * FROM economic_source_checkpoints
    WHERE seller_id = ? AND source = ?`);
  const getSellerLeaseStmt = db.prepare(`SELECT * FROM economic_seller_leases WHERE seller_id = ?`);

  // ── Store implementation ─────────────────────────────────────────────────

  return {
    getDb(): Database.Database {
      return db;
    },
    createRun(input: CreateRunInput): Promise<EconomicIngestionRun> {
      return Promise.resolve().then(() => {
        const now = new Date().toISOString();
        const error = input.error ? sanitizeError(input.error) : null;
        const paramsJson = input.params ? JSON.stringify(input.params) : null;
        const resultJson = input.result ? JSON.stringify(input.result) : null;

        insertRunStmt.run(
          input.runId,
          input.sellerId,
          input.status,
          input.mode,
          input.startedAt ?? null,
          input.completedAt ?? null,
          paramsJson,
          resultJson,
          error,
          // A newly created run has not advanced a checkpoint. The canonical
          // migration makes this column NOT NULL, so rely on neither SQLite's
          // default nor a nullable binding here.
          Number(input.checkpointAdvanced ?? false),
          now,
        );

        const row = getRunStmt.get(input.runId) as RunRow | undefined;
        if (!row) {
          throw new Error(`Failed to create ingestion run: ${input.runId}`);
        }

        return runFromRow(row);
      });
    },

    updateRun(id: string, updates: UpdateRunInput): Promise<EconomicIngestionRun> {
      return Promise.resolve().then(() => {
        const error = updates.error ? sanitizeError(updates.error) : null;
        const resultJson = updates.result ? JSON.stringify(updates.result) : null;

        updateRunStmt.run(
          updates.status ?? null,
          updates.completedAt ?? null,
          resultJson,
          error,
          updates.checkpointAdvanced === undefined ? null : Number(updates.checkpointAdvanced),
          id,
        );

        const row = getRunStmt.get(id) as RunRow | undefined;
        if (!row) {
          throw new Error(`Ingestion run not found: ${id}`);
        }

        return runFromRow(row);
      });
    },

    getRun(id: string): Promise<EconomicIngestionRun | null> {
      const row = getRunStmt.get(id) as RunRow | undefined;
      if (!row) return Promise.resolve(null);
      return Promise.resolve(runFromRow(row));
    },

    getLastRunBySeller(sellerId: string): Promise<EconomicIngestionRun | null> {
      const row = getLastRunStmt.get(sellerId) as RunRow | undefined;
      if (!row) return Promise.resolve(null);
      return Promise.resolve(runFromRow(row));
    },

    listRunsBySeller(sellerId: string, limit = 20): Promise<EconomicIngestionRun[]> {
      const rows = listRunsStmt.all(sellerId, limit) as RunRow[];
      return Promise.resolve(rows.map(runFromRow));
    },

    countRunsBySeller(sellerId: string): number {
      return (countRunsStmt.get(sellerId) as { count: number }).count;
    },

    getActiveRun(sellerId: string): Promise<EconomicIngestionRun | null> {
      const row = getActiveRunStmt.get(sellerId) as RunRow | undefined;
      if (!row) return Promise.resolve(null);
      return Promise.resolve(runFromRow(row));
    },

    recoverAbandonedRun(sellerId: string): Promise<void> {
      recoverAbandonedRunsStmt.run(sellerId);
      return Promise.resolve();
    },

    getCheckpoint(sellerId: string): Promise<Checkpoint | null> {
      const row = getCheckpointStmt.get(sellerId) as CheckpointRow | undefined;
      if (!row) return Promise.resolve(null);
      return Promise.resolve(checkpointFromRow(row));
    },

    updateCheckpoint(
      sellerId: string,
      data: {
        lastOrderDate?: string;
        lastOrderId?: string;
        lastRunId?: string;
        occurredAt?: number;
        sourceRecordId?: string;
      },
    ): Promise<void> {
      upsertCheckpointStmt.run(
        sellerId,
        data.lastOrderDate ?? null,
        data.lastOrderId ?? null,
        data.lastRunId ?? null,
        data.occurredAt ?? null,
        data.sourceRecordId ?? null,
        new Date().toISOString(),
      );
      return Promise.resolve();
    },

    getSourceCheckpoint(
      sellerId: string,
      source: SourceCheckpointKind,
    ): Promise<SourceCheckpoint | null> {
      const row = getSourceCheckpointStmt.get(sellerId, source) as SourceCheckpointRow | undefined;
      return Promise.resolve(row ? sourceCheckpointFromRow(row) : null);
    },

    async advanceSourceCheckpoint(
      input: SourceCheckpointAdvanceInput,
    ): Promise<CheckpointAdvanceResult> {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (input.abortSignal?.aborted) return { status: "retry-exhausted" };
        try {
          assertOpenFence(db, input.fence);
          const row = getSourceCheckpointStmt.get(input.sellerId, input.source) as
            SourceCheckpointRow | undefined;
          if (!row) {
            if (input.expected.version !== 0) return { status: "missing" };
            try {
              const insertedResult = db
                .prepare(
                  `INSERT INTO economic_source_checkpoints
                (seller_id, source, occurred_at, source_record_id, version, last_run_id, updated_at)
                VALUES (?, ?, ?, ?, 1, ?, ?)`,
                )
                .run(
                  input.sellerId,
                  input.source,
                  input.occurredAt,
                  input.sourceRecordId,
                  input.runId,
                  Date.now(),
                );
              const inserted = getSourceCheckpointStmt.get(input.sellerId, input.source) as
                SourceCheckpointRow | undefined;
              if (insertedResult.changes === 1 && inserted) {
                return { status: "advanced", checkpoint: sourceCheckpointFromRow(inserted) };
              }
              const classification = classifySourceCheckpoint(input, inserted);
              if (classification.status !== "concurrent") return classification;
              if (attempt === 2) return { status: "retry-exhausted" };
              await waitForCheckpointRetry(input.retryDelayMs ?? 1, input.abortSignal);
              continue;
            } catch (error) {
              const observed = getSourceCheckpointStmt.get(input.sellerId, input.source) as
                SourceCheckpointRow | undefined;
              if (!isBusy(error) && !observed) throw error;
              const classification = classifySourceCheckpoint(input, observed);
              if (classification.status !== "concurrent") return classification;
              if (attempt === 2) return { status: "retry-exhausted" };
              await waitForCheckpointRetry(input.retryDelayMs ?? 1, input.abortSignal);
              continue;
            }
          }
          const classification = classifySourceCheckpoint(input, row);
          if (classification.status !== "concurrent") return classification;
          const checkpoint = sourceCheckpointFromRow(row);
          if (
            checkpoint.version !== input.expected.version ||
            checkpoint.occurredAt !== input.expected.occurredAt ||
            checkpoint.sourceRecordId !== input.expected.sourceRecordId
          )
            return { status: "concurrent", checkpoint };
          const changed = db
            .prepare(
              `UPDATE economic_source_checkpoints
            SET occurred_at = ?, source_record_id = ?, version = version + 1, last_run_id = ?, updated_at = ?
            WHERE seller_id = ? AND source = ? AND version = ?
              AND ((occurred_at IS NULL AND ? IS NULL) OR occurred_at = ?)
              AND ((source_record_id IS NULL AND ? IS NULL) OR source_record_id = ?)`,
            )
            .run(
              input.occurredAt,
              input.sourceRecordId,
              input.runId,
              Date.now(),
              input.sellerId,
              input.source,
              input.expected.version,
              input.expected.occurredAt,
              input.expected.occurredAt,
              input.expected.sourceRecordId,
              input.expected.sourceRecordId,
            );
          if (changed.changes === 1) {
            const advanced = getSourceCheckpointStmt.get(
              input.sellerId,
              input.source,
            ) as SourceCheckpointRow;
            return { status: "advanced", checkpoint: sourceCheckpointFromRow(advanced) };
          }
          const observed = getSourceCheckpointStmt.get(input.sellerId, input.source) as
            SourceCheckpointRow | undefined;
          const afterConflict = classifySourceCheckpoint(input, observed);
          if (afterConflict.status !== "concurrent") return afterConflict;
          if (attempt === 2) return { status: "retry-exhausted" };
          await waitForCheckpointRetry(input.retryDelayMs ?? 1, input.abortSignal);
          continue;
        } catch (error) {
          if (!isBusy(error)) throw error;
          if (attempt === 2) return { status: "retry-exhausted" };
          await waitForCheckpointRetry(input.retryDelayMs ?? 1, input.abortSignal);
        }
      }
      return { status: "retry-exhausted" };
    },

    acquireSellerLease(input): Promise<SellerLeaseAcquireResult> {
      return Promise.resolve(
        acquireSellerLeaseInTx(db, input, leaseConfig, now, getSellerLeaseStmt),
      );
    },

    renewSellerLease(input): Promise<SellerLeaseRenewResult> {
      return Promise.resolve(renewSellerLeaseInTx(db, input, leaseConfig, now, getSellerLeaseStmt));
    },

    releaseSellerLease(input): Promise<SellerLeaseReleaseResult> {
      return Promise.resolve(releaseSellerLeaseInTx(db, input, now, getSellerLeaseStmt));
    },

    upsertClaimsBacklog(input): Promise<ClaimsBacklog> {
      return Promise.resolve().then(() =>
        inImmediateTransaction(db, () => {
          if (readLeaseFence(db, input.fence) !== "ok")
            throw new Error("Economic backlog fence rejected");
          const identity = createClaimsBacklogIdentity({
            sellerId: input.sellerId,
            range: input.range,
            cursor: input.cursor,
          });
          if (!identity) throw new Error("Invalid Claims backlog identity");
          const timestamp = now();
          const nextAttemptAt = timestamp + (input.retryAfterMs ?? 0);
          db.prepare(
            `INSERT INTO economic_source_retry_backlog
             (backlog_identity_key, seller_id, source, range_from, range_to, cursor_occurred_at,
              cursor_source_record_id, purpose, reason_code, state, attempt_count, next_attempt_at,
              last_run_id, created_at, updated_at)
             VALUES (?, ?, 'claims', ?, ?, ?, ?, 'claims-recovery', ?, 'pending', 0, ?, ?, ?, ?)
             ON CONFLICT(backlog_identity_key) DO UPDATE SET
               reason_code = excluded.reason_code, last_run_id = excluded.last_run_id,
               next_attempt_at = CASE WHEN economic_source_retry_backlog.state IN ('pending', 'retrying')
                 THEN MIN(economic_source_retry_backlog.next_attempt_at, excluded.next_attempt_at)
                 ELSE economic_source_retry_backlog.next_attempt_at END,
               updated_at = excluded.updated_at`,
          ).run(
            identity.key,
            input.sellerId,
            input.range.from,
            input.range.to,
            input.cursor.afterOccurredAt,
            input.cursor.afterSourceRecordId,
            input.reasonCode,
            nextAttemptAt,
            input.runId,
            timestamp,
            timestamp,
          );
          const row = db
            .prepare("SELECT * FROM economic_source_retry_backlog WHERE backlog_identity_key = ?")
            .get(identity.key) as ClaimsBacklogRow;
          return claimsBacklogFromRow(row);
        }),
      );
    },

    getClaimsBacklog(identityKey): Promise<ClaimsBacklog | null> {
      const row = db
        .prepare("SELECT * FROM economic_source_retry_backlog WHERE backlog_identity_key = ?")
        .get(identityKey) as ClaimsBacklogRow | undefined;
      return Promise.resolve(row ? claimsBacklogFromRow(row) : null);
    },

    claimDueClaimsBacklog(input) {
      return Promise.resolve(
        inImmediateTransaction(db, () => {
          if (readLeaseFence(db, input.fence) !== "ok")
            throw new Error("Economic backlog fence rejected");
          const timestamp = now();
          const row = db
            .prepare(
              `SELECT * FROM economic_source_retry_backlog WHERE seller_id = ? AND source = 'claims'
             AND state IN ('pending', 'retrying') AND next_attempt_at <= ? ORDER BY next_attempt_at, backlog_identity_key LIMIT 1`,
            )
            .get(input.sellerId, timestamp) as ClaimsBacklogRow | undefined;
          if (!row) return { status: "none-due" } as const;
          const token = createLeaseToken();
          const generation = (row.claim_generation ?? 0) + 1;
          const changed = db
            .prepare(
              `UPDATE economic_source_retry_backlog SET state = 'leased', claim_owner = ?, claim_token_digest = ?,
             claim_generation = ?, claim_expires_at = ?, updated_at = ?
              WHERE backlog_identity_key = ? AND seller_id = ? AND state IN ('pending', 'retrying') AND next_attempt_at <= ?`,
            )
            .run(
              input.ownerRunId,
              digestLeaseToken(token),
              generation,
              timestamp + DEFAULT_CLAIMS_BACKLOG_CONFIG.ttlMs,
              timestamp,
              row.backlog_identity_key,
              input.sellerId,
              timestamp,
            ).changes;
          if (changed !== 1) return { status: "none-due" } as const;
          return {
            status: "claimed",
            claim: {
              identityKey: row.backlog_identity_key,
              sellerId: input.sellerId,
              ownerRunId: input.ownerRunId,
              token,
              generation,
              expiresAt: timestamp + DEFAULT_CLAIMS_BACKLOG_CONFIG.ttlMs,
            },
          } as const;
        }),
      );
    },

    markClaimsRequestStarted(input) {
      return Promise.resolve(
        inImmediateTransaction(db, () => {
          if (readLeaseFence(db, input.fence) !== "ok")
            throw new Error("Economic backlog fence rejected");
          const timestamp = now();
          const changed = db
            .prepare(
              `UPDATE economic_source_retry_backlog SET state = 'retrying', attempt_count = attempt_count + 1, updated_at = ?
           WHERE backlog_identity_key = ? AND seller_id = ? AND state = 'leased' AND claim_owner = ?
             AND claim_token_digest = ? AND claim_generation = ? AND claim_expires_at > ?`,
            )
            .run(
              timestamp,
              input.identityKey,
              input.sellerId,
              input.ownerRunId,
              digestLeaseToken(input.token),
              input.generation,
              timestamp,
            ).changes;
          if (changed !== 1) return { status: "stale-or-replaced" } as const;
          const row = db
            .prepare(
              "SELECT attempt_count FROM economic_source_retry_backlog WHERE backlog_identity_key = ?",
            )
            .get(input.identityKey) as { attempt_count: number };
          return { status: "started", attemptCount: row.attempt_count } as const;
        }),
      );
    },

    retryClaimsBacklog(input) {
      return Promise.resolve(
        inImmediateTransaction(db, () => {
          if (readLeaseFence(db, input.fence) !== "ok")
            throw new Error("Economic backlog fence rejected");
          const timestamp = now();
          const row = db
            .prepare(
              "SELECT * FROM economic_source_retry_backlog WHERE backlog_identity_key = ? AND seller_id = ?",
            )
            .get(input.identityKey, input.sellerId) as ClaimsBacklogRow | undefined;
          if (
            !row ||
            row.seller_id !== input.sellerId ||
            row.state !== "retrying" ||
            row.claim_owner !== input.ownerRunId ||
            row.claim_token_digest !== digestLeaseToken(input.token) ||
            row.claim_generation !== input.generation ||
            (row.claim_expires_at ?? 0) <= timestamp
          )
            return { status: "stale-or-replaced" } as const;
          const state =
            row.attempt_count >= DEFAULT_CLAIMS_BACKLOG_CONFIG.maxAttempts
              ? "dead-letter"
              : "pending";
          db.prepare(
            `UPDATE economic_source_retry_backlog SET state = ?, reason_code = ?, next_attempt_at = ?, claim_owner = NULL, claim_token_digest = NULL, claim_expires_at = NULL, updated_at = ? WHERE backlog_identity_key = ? AND seller_id = ?`,
          ).run(
            state,
            input.reasonCode,
            timestamp + (input.retryAfterMs ?? 0),
            timestamp,
            input.identityKey,
            input.sellerId,
          );
          return { status: state } as const;
        }),
      );
    },

    resolveClaimsBacklog(input) {
      return Promise.resolve(
        inImmediateTransaction(db, () => {
          if (readLeaseFence(db, input.fence) !== "ok")
            throw new Error("Economic backlog fence rejected");
          const timestamp = now();
          const changed = db
            .prepare(
              `UPDATE economic_source_retry_backlog SET state = 'resolved', resolved_at = ?, updated_at = ? WHERE backlog_identity_key = ? AND seller_id = ? AND state = 'retrying' AND claim_owner = ? AND claim_token_digest = ? AND claim_generation = ? AND claim_expires_at > ?`,
            )
            .run(
              timestamp,
              timestamp,
              input.identityKey,
              input.sellerId,
              input.ownerRunId,
              digestLeaseToken(input.token),
              input.generation,
              timestamp,
            ).changes;
          return { status: changed === 1 ? "resolved" : "stale-or-replaced" } as const;
        }),
      );
    },

    returnClaimsBacklogToPending(input) {
      return Promise.resolve(
        inImmediateTransaction(db, () => {
          if (readLeaseFence(db, input.fence) !== "ok")
            throw new Error("Economic backlog fence rejected");
          const timestamp = now();
          const changed = db
            .prepare(
              `UPDATE economic_source_retry_backlog SET state = 'pending', claim_owner = NULL, claim_token_digest = NULL, claim_expires_at = NULL, next_attempt_at = ?, updated_at = ? WHERE backlog_identity_key = ? AND seller_id = ? AND state IN ('leased', 'retrying') AND claim_owner = ? AND claim_token_digest = ? AND claim_generation = ?`,
            )
            .run(
              timestamp,
              timestamp,
              input.identityKey,
              input.sellerId,
              input.ownerRunId,
              digestLeaseToken(input.token),
              input.generation,
            ).changes;
          return { status: changed === 1 ? "pending" : "stale-or-replaced" } as const;
        }),
      );
    },

    recoverExpiredClaimsBacklog(input) {
      return Promise.resolve(
        inImmediateTransaction(db, () => {
          if (readLeaseFence(db, input.fence) !== "ok")
            throw new Error("Economic backlog fence rejected");
          const timestamp = now();
          const changed = db
            .prepare(
              `UPDATE economic_source_retry_backlog SET state = 'pending', claim_owner = NULL, claim_token_digest = NULL, claim_expires_at = NULL, next_attempt_at = ?, updated_at = ? WHERE seller_id = ? AND backlog_identity_key IN (SELECT backlog_identity_key FROM economic_source_retry_backlog WHERE seller_id = ? AND state IN ('leased', 'retrying') AND claim_expires_at <= ? ORDER BY claim_expires_at LIMIT 100)`,
            )
            .run(timestamp, timestamp, input.sellerId, input.sellerId, timestamp).changes;
          return { recovered: changed, deferred: 0 };
        }),
      );
    },

    cancelClaimsBacklog(input) {
      return Promise.resolve().then(() =>
        inImmediateTransaction(db, () => {
          if (readLeaseFence(db, input.fence) !== "ok")
            throw new Error("Economic backlog fence rejected");
          const timestamp = now();
          const backlog = db
            .prepare(
              `SELECT state FROM economic_source_retry_backlog
               WHERE backlog_identity_key = ? AND seller_id = ?`,
            )
            .get(input.identityKey, input.sellerId) as { state: ClaimsBacklogState } | undefined;
          if (!backlog || backlog.state === "resolved") {
            return { status: "stale-or-replaced" } as const;
          }
          if (backlog.state === "administratively-cancelled") {
            return { status: "administratively-cancelled" } as const;
          }
          const changed = db
            .prepare(
              `UPDATE economic_source_retry_backlog SET state = 'administratively-cancelled', claim_owner = NULL, claim_token_digest = NULL, claim_expires_at = NULL, updated_at = ? WHERE backlog_identity_key = ? AND seller_id = ? AND state NOT IN ('resolved', 'administratively-cancelled')`,
            )
            .run(timestamp, input.identityKey, input.sellerId).changes;
          if (changed !== 1) return { status: "stale-or-replaced" } as const;
          options.administrativeCancellationFaultInjector?.("after-backlog");
          db.prepare(
            `INSERT INTO economic_source_retry_backlog_audit
             (backlog_identity_key, seller_id, action, actor, approver, reason, created_at)
             SELECT ?, ?, 'administratively-cancelled', ?, ?, ?, ?
             WHERE NOT EXISTS (
               SELECT 1 FROM economic_source_retry_backlog_audit
               WHERE backlog_identity_key = ? AND seller_id = ? AND action = 'administratively-cancelled'
             )`,
          ).run(
            input.identityKey,
            input.sellerId,
            input.actor,
            input.approver,
            input.reason,
            timestamp,
            input.identityKey,
            input.sellerId,
          );
          options.administrativeCancellationFaultInjector?.("after-audit");
          createOperationalAlertIntentInTx(
            db,
            { sellerId: input.sellerId, relatedBacklogIdentityKey: input.identityKey },
            timestamp,
          );
          options.administrativeCancellationFaultInjector?.("after-intent");
          db.prepare(
            `INSERT INTO economic_source_health
             (seller_id, source, ready, reason_code, requested_at, attempts, pages, records, retryable,
              retry_at, backlog_identity_key, updated_at)
             VALUES (?, 'claims', 0, 'administratively-cancelled', ?, 0, 0, 0, 0, NULL, ?, ?)
             ON CONFLICT(seller_id, source) DO UPDATE SET ready = 0,
               reason_code = 'administratively-cancelled', backlog_identity_key = excluded.backlog_identity_key,
                updated_at = excluded.updated_at`,
          ).run(input.sellerId, timestamp, input.identityKey, timestamp);
          options.administrativeCancellationFaultInjector?.("before-commit");
          return { status: "administratively-cancelled" } as const;
        }),
      );
    },

    createOperationalAlertIntent(input) {
      return Promise.resolve().then(() =>
        inImmediateTransaction(db, () => createOperationalAlertIntentInTx(db, input, now())),
      );
    },

    getOperationalAlertIntent(input) {
      const row = db
        .prepare(
          `SELECT * FROM economic_operational_alert_intents
           WHERE seller_id = ? AND intent_id = ?`,
        )
        .get(input.sellerId, input.intentId) as OperationalAlertIntentRow | undefined;
      return Promise.resolve(row ? operationalAlertIntentFromRow(row) : null);
    },

    listOperationalAlertIntents(input) {
      const limit = Math.max(1, Math.min(input.limit ?? 100, 100));
      const rows = input.status
        ? (db
            .prepare(
              `SELECT * FROM economic_operational_alert_intents
               WHERE seller_id = ? AND status = ? ORDER BY created_at, intent_id LIMIT ?`,
            )
            .all(input.sellerId, input.status, limit) as OperationalAlertIntentRow[])
        : (db
            .prepare(
              `SELECT * FROM economic_operational_alert_intents
               WHERE seller_id = ? ORDER BY created_at, intent_id LIMIT ?`,
            )
            .all(input.sellerId, limit) as OperationalAlertIntentRow[]);
      return Promise.resolve(rows.map(operationalAlertIntentFromRow));
    },

    countPendingOperationalAlertIntents(sellerId) {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS count FROM economic_operational_alert_intents
           WHERE seller_id = ? AND status = 'pending'`,
        )
        .get(sellerId) as { count: number };
      return Promise.resolve(row.count);
    },

    markOperationalAlertIntentConsumed(input) {
      return Promise.resolve().then(() =>
        inImmediateTransaction(db, () => {
          const current = db
            .prepare("SELECT * FROM economic_operational_alert_intents WHERE intent_id = ?")
            .get(input.intentId) as OperationalAlertIntentRow | undefined;
          if (!current) return { status: "not-found" } as const;
          if (current.seller_id !== input.sellerId) return { status: "wrong-seller" } as const;
          const intent = operationalAlertIntentFromRow(current);
          if (intent.status === "consumed") return { status: "already-consumed", intent } as const;
          const timestamp = now();
          db.prepare(
            `UPDATE economic_operational_alert_intents
             SET status = 'consumed', consumed_at = ?, updated_at = ?
             WHERE intent_id = ? AND seller_id = ? AND status = 'pending'`,
          ).run(timestamp, timestamp, input.intentId, input.sellerId);
          const consumed = db
            .prepare("SELECT * FROM economic_operational_alert_intents WHERE intent_id = ?")
            .get(input.intentId) as OperationalAlertIntentRow;
          return { status: "consumed", intent: operationalAlertIntentFromRow(consumed) } as const;
        }),
      );
    },

    replayClaimsBacklog(input) {
      return Promise.resolve(
        inImmediateTransaction(db, () => {
          if (readLeaseFence(db, input.fence) !== "ok")
            throw new Error("Economic backlog fence rejected");
          const timestamp = now();
          const changed = db
            .prepare(
              `UPDATE economic_source_retry_backlog SET state = 'pending', next_attempt_at = ?, claim_owner = NULL, claim_token_digest = NULL, claim_expires_at = NULL, updated_at = ? WHERE backlog_identity_key = ? AND seller_id = ? AND state IN ('dead-letter', 'administratively-cancelled')`,
            )
            .run(timestamp, timestamp, input.identityKey, input.sellerId).changes;
          if (changed !== 1) return { status: "stale-or-replaced" } as const;
          db.prepare(
            `INSERT INTO economic_source_retry_backlog_audit (backlog_identity_key, seller_id, action, actor, approver, reason, created_at) VALUES (?, ?, 'replayed', ?, ?, ?, ?)`,
          ).run(
            input.identityKey,
            input.sellerId,
            input.actor,
            input.approver,
            input.reason,
            timestamp,
          );
          return { status: "replayed" } as const;
        }),
      );
    },

    recordSourceHealth(input): Promise<void> {
      return Promise.resolve().then(() =>
        inImmediateTransaction(db, () => {
          if (readLeaseFence(db, input.fence) !== "ok")
            throw new Error("Economic health fence rejected");
          const timestamp = now();
          db.prepare(
            `INSERT INTO economic_source_health (seller_id, source, ready, reason_code, requested_at, attempts, pages, records, retryable, retry_at, backlog_identity_key, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(seller_id, source) DO UPDATE SET ready = excluded.ready, reason_code = excluded.reason_code, requested_at = excluded.requested_at, attempts = excluded.attempts, pages = excluded.pages, records = excluded.records, retryable = excluded.retryable, retry_at = excluded.retry_at, backlog_identity_key = excluded.backlog_identity_key, updated_at = excluded.updated_at WHERE excluded.requested_at >= economic_source_health.requested_at`,
          ).run(
            input.sellerId,
            input.source,
            Number(input.ready),
            input.reasonCode,
            input.requestedAt,
            input.attempts,
            input.pages,
            input.records,
            Number(input.retryable),
            input.retryAt,
            input.backlogIdentityKey,
            timestamp,
          );
        }),
      );
    },

    getSourceHealth(sellerId, source): Promise<SourceHealth | null> {
      const row = db
        .prepare("SELECT * FROM economic_source_health WHERE seller_id = ? AND source = ?")
        .get(sellerId, source) as SourceHealthRow | undefined;
      return Promise.resolve(row ? sourceHealthFromRow(row) : null);
    },
  };
}

// ── Sync helpers for use inside external transactions ─────────────────────

/**
 * Synchronous run update for use inside db.transaction() callbacks.
 * Writes status, completedAt, result, and error to a run row.
 */
export function syncUpdateRunInTx(
  db: Database.Database,
  id: string,
  updates: {
    status?: string | null;
    completedAt?: number | null;
    result?: Record<string, unknown> | null;
    error?: string | null;
    checkpointAdvanced?: boolean | null;
  },
): void {
  const stmt = db.prepare(`
    UPDATE economic_ingestion_runs
    SET status = COALESCE(?, status),
         completed_at = COALESCE(?, completed_at),
         result = COALESCE(?, result),
         error = COALESCE(?, error),
         checkpoint_advanced = COALESCE(?, checkpoint_advanced)
    WHERE id = ?
  `);
  const resultJson = updates.result ? JSON.stringify(updates.result) : null;
  const errorClean = updates.error ? sanitizeError(updates.error) : null;
  stmt.run(
    updates.status ?? null,
    updates.completedAt ?? null,
    resultJson,
    errorClean,
    updates.checkpointAdvanced === undefined || updates.checkpointAdvanced === null
      ? null
      : Number(updates.checkpointAdvanced),
    id,
  );
}

/**
 * Synchronous checkpoint upsert for use inside db.transaction() callbacks.
 */
export function syncUpdateCheckpointInTx(
  db: Database.Database,
  sellerId: string,
  data: {
    lastOrderDate?: string;
    lastOrderId?: string;
    lastRunId?: string;
    occurredAt?: number;
    sourceRecordId?: string;
  },
): void {
  const stmt = db.prepare(`
    INSERT INTO economic_ingestion_checkpoints
      (seller_id, last_order_date, last_order_id, last_run_id, occurred_at, source_record_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(seller_id) DO UPDATE SET
      last_order_date = COALESCE(excluded.last_order_date, economic_ingestion_checkpoints.last_order_date),
      last_order_id = COALESCE(excluded.last_order_id, economic_ingestion_checkpoints.last_order_id),
      last_run_id = COALESCE(excluded.last_run_id, economic_ingestion_checkpoints.last_run_id),
      occurred_at = COALESCE(excluded.occurred_at, economic_ingestion_checkpoints.occurred_at),
      source_record_id = COALESCE(excluded.source_record_id, economic_ingestion_checkpoints.source_record_id),
      updated_at = excluded.updated_at
  `);
  stmt.run(
    sellerId,
    data.lastOrderDate ?? null,
    data.lastOrderId ?? null,
    data.lastRunId ?? null,
    data.occurredAt ?? null,
    data.sourceRecordId ?? null,
    new Date().toISOString(),
  );
}

/** Synchronous CAS for the pipeline's final SQLite transaction. */
export function syncAdvanceSourceCheckpointInTx(
  db: Database.Database,
  input: Omit<SourceCheckpointAdvanceInput, "abortSignal" | "retryDelayMs">,
): CheckpointAdvanceResult {
  assertOpenFence(db, input.fence);
  const row = db
    .prepare(`SELECT * FROM economic_source_checkpoints WHERE seller_id = ? AND source = ?`)
    .get(input.sellerId, input.source) as SourceCheckpointRow | undefined;
  if (!row) {
    if (input.expected.version !== 0) return { status: "missing" };
    try {
      const insertedResult = db
        .prepare(
          `INSERT INTO economic_source_checkpoints
        (seller_id, source, occurred_at, source_record_id, version, last_run_id, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          input.sellerId,
          input.source,
          input.occurredAt,
          input.sourceRecordId,
          input.runId,
          Date.now(),
        );
      if (insertedResult.changes !== 1) {
        const observed = db
          .prepare(`SELECT * FROM economic_source_checkpoints WHERE seller_id = ? AND source = ?`)
          .get(input.sellerId, input.source) as SourceCheckpointRow | undefined;
        return classifySourceCheckpoint(input, observed);
      }
    } catch {
      const observed = db
        .prepare(`SELECT * FROM economic_source_checkpoints WHERE seller_id = ? AND source = ?`)
        .get(input.sellerId, input.source) as SourceCheckpointRow | undefined;
      if (!observed) return { status: "concurrent", checkpoint: null };
      const checkpoint = sourceCheckpointFromRow(observed);
      return checkpoint.occurredAt === input.occurredAt &&
        checkpoint.sourceRecordId === input.sourceRecordId
        ? { status: "already-applied", checkpoint }
        : { status: "concurrent", checkpoint };
    }
    const inserted = db
      .prepare(`SELECT * FROM economic_source_checkpoints WHERE seller_id = ? AND source = ?`)
      .get(input.sellerId, input.source) as SourceCheckpointRow;
    return { status: "advanced", checkpoint: sourceCheckpointFromRow(inserted) };
  }
  const classification = classifySourceCheckpoint(input, row);
  if (classification.status !== "concurrent") return classification;
  const checkpoint = sourceCheckpointFromRow(row);
  if (
    checkpoint.version !== input.expected.version ||
    checkpoint.occurredAt !== input.expected.occurredAt ||
    checkpoint.sourceRecordId !== input.expected.sourceRecordId
  )
    return { status: "concurrent", checkpoint };
  const changed = db
    .prepare(
      `UPDATE economic_source_checkpoints
    SET occurred_at = ?, source_record_id = ?, version = version + 1, last_run_id = ?, updated_at = ?
    WHERE seller_id = ? AND source = ? AND version = ?
      AND ((occurred_at IS NULL AND ? IS NULL) OR occurred_at = ?)
      AND ((source_record_id IS NULL AND ? IS NULL) OR source_record_id = ?)`,
    )
    .run(
      input.occurredAt,
      input.sourceRecordId,
      input.runId,
      Date.now(),
      input.sellerId,
      input.source,
      input.expected.version,
      input.expected.occurredAt,
      input.expected.occurredAt,
      input.expected.sourceRecordId,
      input.expected.sourceRecordId,
    );
  if (changed.changes !== 1) return { status: "concurrent", checkpoint };
  const advanced = db
    .prepare(`SELECT * FROM economic_source_checkpoints WHERE seller_id = ? AND source = ?`)
    .get(input.sellerId, input.source) as SourceCheckpointRow;
  return { status: "advanced", checkpoint: sourceCheckpointFromRow(advanced) };
}

/** Writes a Claims gap intent in the caller's already-fenced final transaction. */
export function syncUpsertClaimsBacklogInTx(
  db: Database.Database,
  input: {
    sellerId: string;
    range: { from: number | null; to: number | null };
    cursor: { afterOccurredAt: number | null; afterSourceRecordId: string | null };
    reasonCode: string;
    retryAfterMs: number | null;
    runId: string;
    now?: number;
  },
): string {
  const identity = createClaimsBacklogIdentity({
    sellerId: input.sellerId,
    range: input.range,
    cursor: input.cursor,
  });
  if (!identity) throw new Error("Invalid Claims backlog identity");
  const timestamp = input.now ?? Date.now();
  db.prepare(
    `INSERT INTO economic_source_retry_backlog
     (backlog_identity_key, seller_id, source, range_from, range_to, cursor_occurred_at,
      cursor_source_record_id, purpose, reason_code, state, attempt_count, next_attempt_at,
      last_run_id, created_at, updated_at)
     VALUES (?, ?, 'claims', ?, ?, ?, ?, 'claims-recovery', ?, 'pending', 0, ?, ?, ?, ?)
     ON CONFLICT(backlog_identity_key) DO UPDATE SET reason_code = excluded.reason_code,
       last_run_id = excluded.last_run_id, updated_at = excluded.updated_at,
       next_attempt_at = MIN(economic_source_retry_backlog.next_attempt_at, excluded.next_attempt_at)`,
  ).run(
    identity.key,
    input.sellerId,
    input.range.from,
    input.range.to,
    input.cursor.afterOccurredAt,
    input.cursor.afterSourceRecordId,
    input.reasonCode,
    timestamp + (input.retryAfterMs ?? 0),
    input.runId,
    timestamp,
    timestamp,
  );
  return identity.key;
}

/** Source health is the sole durable readiness projection and contains no raw payload. */
export function syncRecordSourceHealthInTx(
  db: Database.Database,
  input: Omit<SourceHealth, "updatedAt"> & { now?: number },
): void {
  const timestamp = input.now ?? Date.now();
  db.prepare(
    `INSERT INTO economic_source_health
     (seller_id, source, ready, reason_code, requested_at, attempts, pages, records, retryable,
      retry_at, backlog_identity_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(seller_id, source) DO UPDATE SET ready = excluded.ready, reason_code = excluded.reason_code,
       requested_at = excluded.requested_at, attempts = excluded.attempts, pages = excluded.pages,
       records = excluded.records, retryable = excluded.retryable, retry_at = excluded.retry_at,
        backlog_identity_key = excluded.backlog_identity_key, updated_at = excluded.updated_at
        WHERE excluded.requested_at >= economic_source_health.requested_at`,
  ).run(
    input.sellerId,
    input.source,
    Number(input.ready),
    input.reasonCode,
    input.requestedAt,
    input.attempts,
    input.pages,
    input.records,
    Number(input.retryable),
    input.retryAt,
    input.backlogIdentityKey,
    timestamp,
  );
}
