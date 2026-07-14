import type {
  DurableCumulativeMetrics,
  EconomicCostComponent,
  EconomicEvidenceReference,
  EconomicIngestionRun,
  SourceFetchResult,
  UnitEconomicsSnapshot,
} from "@msl/domain";
import Database from "better-sqlite3";
import { admitMaintenanceWrite, type MaintenanceWriteAdmission } from "./databaseWriteAdmission.js";
import {
  assertSellerLeaseOwnershipInTx,
  createSqliteEconomicIngestionRunStore,
  DEFAULT_SELLER_LEASE_CONFIG,
  syncAdvanceSourceCheckpointInTx,
  syncRecordSourceHealthInTx,
  syncUpdateCheckpointInTx,
  syncUpdateRunInTx,
  syncUpsertClaimsBacklogInTx,
  type EconomicIngestionRunStore,
  type SellerLease,
  type SourceCheckpoint,
} from "./economicIngestionRunStore.js";
import {
  createSqliteEconomicOutcomeStore,
  type EconomicOutcomeReader,
  type EconomicOutcomeStore,
} from "./economicOutcomeStore.js";
import {
  createSqliteEconomicEvidenceStore,
  type EconomicEvidenceStore,
} from "./economicEvidenceStore.js";
import {
  acquireEconomicDatabaseFence,
  consumeEconomicWriteAdmissionReceipt,
  createEconomicMigrationPlan,
  issueEconomicWriteAdmissionReceipt,
  readEconomicDatabaseFence,
  rejectEconomicWriteAdmissionReceipt,
  releaseEconomicDatabaseFence,
  renewEconomicDatabaseFence,
  validateEconomicWriteAdmissionReceipt,
  type EconomicDatabaseFenceHandle,
  type EconomicWriteAdmissionReceipt,
} from "./migrationRegistry.js";

export type EconomicRunReader = Pick<
  EconomicIngestionRunStore,
  | "getRun"
  | "getLastRunBySeller"
  | "listRunsBySeller"
  | "getActiveRun"
  | "getCheckpoint"
  | "getSourceCheckpoint"
  | "getSourceHealth"
>;

export type EconomicEvidenceReader = Pick<
  EconomicEvidenceStore,
  | "getEvidence"
  | "listBySeller"
  | "listByRun"
  | "listBySourceRecord"
  | "countByRun"
  | "countBySeller"
>;

export type EconomicMemoryReaders = {
  readonly outcomes: EconomicOutcomeReader;
  readonly runs: EconomicRunReader;
  readonly evidence: EconomicEvidenceReader;
};

export type EconomicCheckpointCommit = {
  readonly source: "orders";
  readonly cursor: { readonly occurredAt: number; readonly sourceRecordId: string };
  readonly expected: Pick<SourceCheckpoint, "version" | "occurredAt" | "sourceRecordId">;
};

export type EconomicSourceHealthUpdate = {
  readonly source: "orders" | "claims" | "product-ads";
  readonly outcome: SourceFetchResult;
};

export type EconomicIngestionCommit = {
  readonly run: EconomicIngestionRun;
  readonly evidence: readonly EconomicEvidenceReference[];
  readonly components: readonly EconomicCostComponent[];
  readonly snapshots: readonly UnitEconomicsSnapshot[];
  readonly checkpoints: readonly EconomicCheckpointCommit[];
  readonly sourceHealthUpdates: readonly EconomicSourceHealthUpdate[];
  readonly reconciliation: NonNullable<EconomicIngestionRun["reconciliation"]>;
};

export type EconomicIngestionCommitResult = {
  readonly run: EconomicIngestionRun;
  readonly snapshots: readonly UnitEconomicsSnapshot[];
  readonly cumulativeMetrics: DurableCumulativeMetrics;
};

export type EconomicIngestionFailure = {
  readonly run: EconomicIngestionRun;
  readonly error: string;
  readonly sourceHealthUpdates?: readonly EconomicSourceHealthUpdate[];
};

export type AdmittedEconomicWriteSession = {
  readonly sellerId: string;
  readonly ownerRunId: string;
  commitIngestion(command: EconomicIngestionCommit): Promise<EconomicIngestionCommitResult>;
  recordFailure(command: EconomicIngestionFailure): Promise<EconomicIngestionRun>;
};

export type OpenEconomicWriteSession = {
  readonly session: AdmittedEconomicWriteSession;
  release(): Promise<void>;
};

export type EconomicWriteSessionFactory = {
  open(input: {
    readonly sellerId: string;
    readonly ownerRunId: string;
    readonly receiptTtlMs: number;
    readonly signal?: AbortSignal;
    readonly onInvalidated?: () => void;
  }): Promise<OpenEconomicWriteSession>;
};

export type EconomicWriteSessionClock = {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
};

export type EconomicMemoryRuntime = {
  readonly readers: EconomicMemoryReaders;
  readonly writeSessionFactory: EconomicWriteSessionFactory;
  readonly maintenanceAdmission: MaintenanceWriteAdmission;
  close(): void;
};

export type EconomicMemoryRuntimeOptions = {
  readonly databasePath?: string;
  readonly applyMigrations?: boolean;
  readonly now?: () => number;
  readonly writeSessionClock?: EconomicWriteSessionClock;
  readonly writeSessionRenewalIntervalMs?: number;
};

type EconomicWriteRenewal = { stop(): Promise<void> };

function renewalDelay(
  clock: EconomicWriteSessionClock,
  delayMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    let settled = false;
    const finish = (elapsed: boolean): void => {
      if (settled) return;
      settled = true;
      clock.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(elapsed);
    };
    const abort = () => finish(false);
    const timer = clock.setTimeout(() => finish(true), delayMs);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function startEconomicWriteRenewal(input: {
  readonly clock: EconomicWriteSessionClock;
  readonly intervalMs: number;
  readonly signal?: AbortSignal;
  readonly renew: () => Promise<boolean>;
  readonly onInvalidated?: () => void;
}): EconomicWriteRenewal {
  const stopController = new AbortController();
  const stopForExternalAbort = () => stopController.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", stopForExternalAbort, { once: true });
  if (input.signal?.aborted) stopForExternalAbort();
  const loop = (async (): Promise<void> => {
    try {
      while (!stopController.signal.aborted) {
        if (!(await renewalDelay(input.clock, input.intervalMs, stopController.signal))) return;
        if (stopController.signal.aborted) return;
        if (!(await input.renew())) {
          input.onInvalidated?.();
          return;
        }
      }
    } catch (error) {
      input.onInvalidated?.();
      throw error;
    } finally {
      input.signal?.removeEventListener("abort", stopForExternalAbort);
    }
  })();
  return {
    async stop() {
      stopController.abort();
      await loop;
    },
  };
}

function immediate<T>(db: Database.Database, operation: () => T): T {
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

function insertRun(db: Database.Database, run: EconomicIngestionRun, error: string | null): void {
  db.prepare(
    `INSERT INTO economic_ingestion_runs
     (id, seller_id, status, mode, started_at, completed_at, params, result, error, checkpoint_advanced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at,
       result = excluded.result, error = excluded.error,
       checkpoint_advanced = excluded.checkpoint_advanced`,
  ).run(
    run.runId,
    run.sellerId,
    run.status,
    run.mode,
    run.startedAt,
    run.completedAt ?? null,
    JSON.stringify({ sourceKinds: run.sourceKinds }),
    JSON.stringify(run),
    error,
    Number(run.checkpointAfter !== undefined),
  );
}

function createAdmittedSession(input: {
  db: Database.Database;
  receipt: EconomicWriteAdmissionReceipt;
  getLease: () => SellerLease;
  outcomes: EconomicOutcomeStore;
  runs: EconomicIngestionRunStore;
  evidence: EconomicEvidenceStore;
  now: () => number;
  isInvalidated: () => boolean;
}): AdmittedEconomicWriteSession {
  let consumed = false;
  const write = <T>(operation: () => T): T => {
    if (input.isInvalidated()) throw new Error("Economic write session invalidated");
    if (consumed) throw new Error("Economic write admission receipt already consumed");
    try {
      const result = immediate(input.db, () => {
        const valid = validateEconomicWriteAdmissionReceipt({
          db: input.db,
          receipt: input.receipt,
          now: input.now(),
        });
        if (valid.status !== "valid") throw new Error(`Economic write admission ${valid.status}`);
        assertSellerLeaseOwnershipInTx(input.db, input.getLease());
        const value = operation();
        assertSellerLeaseOwnershipInTx(input.db, input.getLease());
        const receipt = consumeEconomicWriteAdmissionReceipt({
          db: input.db,
          receipt: input.receipt,
          now: input.now(),
        });
        if (receipt.status !== "consumed")
          throw new Error(`Economic write admission ${receipt.status}`);
        const epoch = input.db
          .prepare(
            "UPDATE economic_database_metadata SET write_epoch = write_epoch + 1, updated_at = ? WHERE singleton = 1 AND generation = ?",
          )
          .run(input.now(), input.receipt.databaseGeneration);
        if (epoch.changes !== 1) throw new Error("Economic write epoch rejected");
        return value;
      });
      consumed = true;
      return result;
    } catch (error) {
      rejectEconomicWriteAdmissionReceipt({
        db: input.db,
        receipt: input.receipt,
        now: input.now(),
      });
      throw error;
    }
  };

  return {
    sellerId: input.receipt.sellerId,
    ownerRunId: input.receipt.ownerRunId,
    commitIngestion(command) {
      return Promise.resolve().then(() => {
        if (
          command.run.sellerId !== input.receipt.sellerId ||
          command.run.runId !== input.receipt.ownerRunId
        ) {
          throw new Error("Economic ingestion commit ownership mismatch");
        }
        return write(() => {
          insertRun(input.db, command.run, null);
          let duplicatesIgnored = command.run.duplicatesIgnored;
          let componentsCreated = 0;
          const snapshots: UnitEconomicsSnapshot[] = [];
          for (const evidence of command.evidence) {
            if (input.evidence.upsertEvidence(evidence)) duplicatesIgnored++;
          }
          for (const component of command.components) {
            const persisted = input.outcomes.insertCostComponent({
              id: component.id,
              sellerId: component.sellerId,
              ingestionRunId: command.run.runId,
              type: component.type,
              amount: component.amount,
              source: component.source,
              ...(component.sourceRecordId === undefined
                ? {}
                : { sourceRecordId: component.sourceRecordId }),
              economicMeaning: component.economicMeaning ?? component.type,
              ...(component.sourceVersion === undefined
                ? {}
                : { sourceVersion: component.sourceVersion }),
              occurredAt: component.occurredAt,
              observedAt: component.observedAt,
              verification: component.verification,
              confidence: component.confidence,
              ...(component.metadata === undefined ? {} : { metadata: component.metadata }),
            });
            if (persisted.id === component.id) componentsCreated++;
            else duplicatesIgnored++;
          }
          for (const snapshot of command.snapshots) {
            const persisted = input.outcomes.insertUnitEconomicsSnapshot({
              ...snapshot,
              ingestionRunId: command.run.runId,
            });
            if (persisted.ingestionRunId !== command.run.runId) duplicatesIgnored++;
            snapshots.push(persisted);
          }
          let claimsBacklogIdentityKey: string | null = null;
          for (const update of command.sourceHealthUpdates) {
            if (update.source === "claims" && !update.outcome.status.startsWith("success")) {
              claimsBacklogIdentityKey = syncUpsertClaimsBacklogInTx(input.db, {
                sellerId: command.run.sellerId,
                range: { from: null, to: null },
                cursor: update.outcome.cursor,
                reasonCode: update.outcome.reasonCode ?? update.outcome.status,
                retryAfterMs: update.outcome.retryAfterMs,
                runId: command.run.runId,
                now: input.now(),
              });
            }
            const successful =
              update.outcome.status === "success-with-data" ||
              update.outcome.status === "success-empty";
            syncRecordSourceHealthInTx(input.db, {
              sellerId: command.run.sellerId,
              source: update.source,
              ready: successful,
              reasonCode: update.outcome.reasonCode,
              requestedAt: update.outcome.observedAt,
              attempts: update.outcome.attempts,
              pages: update.outcome.pages,
              records: update.outcome.records,
              retryable: update.outcome.retryable,
              retryAt:
                update.outcome.retryAfterMs === null
                  ? null
                  : update.outcome.observedAt + update.outcome.retryAfterMs,
              backlogIdentityKey: update.source === "claims" ? claimsBacklogIdentityKey : null,
              now: input.now(),
            });
          }
          for (const checkpoint of command.checkpoints) {
            const fence = readEconomicDatabaseFence(input.db, input.now());
            const advanced = syncAdvanceSourceCheckpointInTx(input.db, {
              sellerId: command.run.sellerId,
              source: checkpoint.source,
              ...checkpoint.cursor,
              runId: command.run.runId,
              expected: checkpoint.expected,
              fence: { generation: fence.generation, tokenDigest: fence.tokenDigest },
            });
            if (advanced.status !== "advanced" && advanced.status !== "already-applied") {
              throw new Error(`Source checkpoint CAS ${advanced.status}`);
            }
            syncUpdateCheckpointInTx(input.db, command.run.sellerId, {
              lastOrderDate: new Date(checkpoint.cursor.occurredAt).toISOString(),
              lastOrderId: checkpoint.cursor.sourceRecordId,
              lastRunId: command.run.runId,
              ...checkpoint.cursor,
            });
          }
          const cumulativeMetrics: DurableCumulativeMetrics = {
            status: "available",
            ...input.outcomes.countSellerAggregates(command.run.sellerId),
            ...input.outcomes.countSellerReconciliationAggregates!(command.run.sellerId),
            evidence: input.evidence.countBySeller!(command.run.sellerId),
            runs: input.runs.countRunsBySeller!(command.run.sellerId),
          };
          const persistedRun: EconomicIngestionRun = {
            ...command.run,
            componentsCreated,
            snapshotsCreated: snapshots.length,
            duplicatesIgnored,
            cumulativeMetrics,
            reconciliation: command.reconciliation,
          } satisfies EconomicIngestionRun;
          syncUpdateRunInTx(input.db, command.run.runId, {
            status: persistedRun.status,
            ...(persistedRun.completedAt === undefined
              ? {}
              : { completedAt: persistedRun.completedAt }),
            result: persistedRun,
            checkpointAdvanced: command.checkpoints.length > 0,
          });
          return { run: persistedRun, snapshots, cumulativeMetrics };
        });
      });
    },
    recordFailure(command) {
      return Promise.resolve().then(() => {
        if (
          command.run.sellerId !== input.receipt.sellerId ||
          command.run.runId !== input.receipt.ownerRunId
        ) {
          throw new Error("Economic ingestion failure ownership mismatch");
        }
        return write(() => {
          insertRun(input.db, command.run, command.error);
          for (const update of command.sourceHealthUpdates ?? []) {
            const successful =
              update.outcome.status === "success-with-data" ||
              update.outcome.status === "success-empty";
            syncRecordSourceHealthInTx(input.db, {
              sellerId: command.run.sellerId,
              source: update.source,
              ready: successful,
              reasonCode: update.outcome.reasonCode,
              requestedAt: update.outcome.observedAt,
              attempts: update.outcome.attempts,
              pages: update.outcome.pages,
              records: update.outcome.records,
              retryable: update.outcome.retryable,
              retryAt:
                update.outcome.retryAfterMs === null
                  ? null
                  : update.outcome.observedAt + update.outcome.retryAfterMs,
              backlogIdentityKey: null,
              now: input.now(),
            });
          }
          return command.run;
        });
      });
    },
  };
}

export function createEconomicMemoryRuntime(
  options: EconomicMemoryRuntimeOptions = {},
): EconomicMemoryRuntime {
  const db = new Database(options.databasePath ?? ":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  const now = options.now ?? Date.now;
  const writeSessionClock = options.writeSessionClock ?? {
    setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
  };
  const writeSessionRenewalIntervalMs =
    options.writeSessionRenewalIntervalMs ?? DEFAULT_SELLER_LEASE_CONFIG.renewIntervalMs;
  if (!Number.isSafeInteger(writeSessionRenewalIntervalMs) || writeSessionRenewalIntervalMs <= 0) {
    throw new Error("Economic write session renewal interval must be a positive safe integer");
  }
  const metadataExists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'economic_database_metadata'",
    )
    .get();
  const maintenanceAdmission = admitMaintenanceWrite(
    db,
    metadataExists ? "migration" : "bootstrap",
    now,
  );
  if (options.applyMigrations !== false) {
    maintenanceAdmission.run(() => createEconomicMigrationPlan().apply(db));
  }
  const outcomes = createSqliteEconomicOutcomeStore(db, { skipMigration: true });
  const runs = createSqliteEconomicIngestionRunStore(db, { skipMigration: true });
  const evidence = createSqliteEconomicEvidenceStore(db, { skipMigration: true });
  const writeSessionFactory: EconomicWriteSessionFactory = {
    async open({ sellerId, ownerRunId, receiptTtlMs, signal, onInvalidated }) {
      const acquiredFence = acquireEconomicDatabaseFence({ db, ownerRunId, now: now() });
      if (acquiredFence.status !== "acquired" && acquiredFence.status !== "recovered") {
        throw new Error(`Economic database fence ${acquiredFence.status}`);
      }
      let fence: EconomicDatabaseFenceHandle = acquiredFence.fence;
      const fenceProjection = readEconomicDatabaseFence(db, now());
      const acquiredLease = await runs.acquireSellerLease!({
        sellerId,
        ownerRunId,
        fence: {
          generation: fenceProjection.fenceGeneration,
          tokenDigest: fenceProjection.tokenDigest,
          databaseGeneration: fenceProjection.generation,
        },
      });
      if (acquiredLease.status !== "acquired" && acquiredLease.status !== "recovered") {
        releaseEconomicDatabaseFence({ db, fence, now: now() });
        throw new Error(`Economic seller lease ${acquiredLease.status}`);
      }
      let lease = acquiredLease.lease;
      const releaseLease = async (): Promise<void> => {
        const projection = readEconomicDatabaseFence(db, now());
        const released = await runs.releaseSellerLease!({
          sellerId,
          ownerRunId,
          token: lease.token,
          generation: lease.generation,
          fence: {
            generation: projection.fenceGeneration,
            tokenDigest: projection.tokenDigest,
            databaseGeneration: projection.generation,
          },
        });
        if (released.status !== "released" && released.status !== "already-released") {
          throw new Error(`Economic seller lease release ${released.status}`);
        }
      };
      const releaseFence = (): void => {
        const released = releaseEconomicDatabaseFence({ db, fence, now: now() });
        if (released.status !== "released") {
          throw new Error(`Economic database fence release ${released.status}`);
        }
      };
      let issued: ReturnType<typeof issueEconomicWriteAdmissionReceipt>;
      try {
        issued = issueEconomicWriteAdmissionReceipt({
          db,
          sellerId,
          writerKind: "economic-ingestion",
          ownerRunId,
          fence,
          leaseGeneration: lease.generation,
          ttlMs: receiptTtlMs,
          now: now(),
        });
        if (issued.status !== "issued") throw new Error(`Economic admission ${issued.status}`);
      } catch (primaryError) {
        const cleanupErrors: unknown[] = [];
        try {
          await releaseLease();
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        } finally {
          try {
            releaseFence();
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
        }
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [primaryError, ...cleanupErrors],
            "Economic admission failed and ownership cleanup was incomplete",
            { cause: primaryError },
          );
        }
        throw primaryError;
      }
      let invalidated = false;
      const session = createAdmittedSession({
        db,
        receipt: issued.receipt,
        getLease: () => lease,
        outcomes,
        runs,
        evidence,
        now,
        isInvalidated: () => invalidated,
      });
      const renewal = startEconomicWriteRenewal({
        clock: writeSessionClock,
        intervalMs: writeSessionRenewalIntervalMs,
        ...(signal === undefined ? {} : { signal }),
        onInvalidated: () => {
          invalidated = true;
          onInvalidated?.();
        },
        renew: async () => {
          const renewedFence = renewEconomicDatabaseFence({ db, fence, now: now() });
          if (renewedFence.status !== "renewed") {
            invalidated = true;
            return false;
          }
          fence = renewedFence.fence;
          const projection = readEconomicDatabaseFence(db, now());
          const renewedLease = await runs.renewSellerLease!({
            sellerId,
            ownerRunId,
            token: lease.token,
            generation: lease.generation,
            fence: {
              generation: projection.fenceGeneration,
              tokenDigest: projection.tokenDigest,
              databaseGeneration: projection.generation,
            },
          });
          if (renewedLease.status !== "renewed") {
            invalidated = true;
            return false;
          }
          lease = renewedLease.lease;
          return true;
        },
      });
      return {
        session,
        async release() {
          const cleanupErrors: unknown[] = [];
          try {
            await renewal.stop();
          } catch (error) {
            cleanupErrors.push(error);
          }
          try {
            await releaseLease();
          } catch (error) {
            cleanupErrors.push(error);
          } finally {
            try {
              releaseFence();
            } catch (error) {
              cleanupErrors.push(error);
            }
          }
          if (cleanupErrors.length === 1) throw cleanupErrors[0];
          if (cleanupErrors.length > 1) {
            throw new AggregateError(cleanupErrors, "Economic write session release failed", {
              cause: cleanupErrors[0],
            });
          }
        },
      };
    },
  };
  const outcomeReader: EconomicOutcomeReader = {
    getOutcome: (...args) => outcomes.getOutcome(...args),
    listOutcomesBySeller: (...args) => outcomes.listOutcomesBySeller(...args),
    listOutcomesByProposal: (...args) => outcomes.listOutcomesByProposal(...args),
    listOutcomesByOrder: (...args) => outcomes.listOutcomesByOrder(...args),
    listOutcomesByCorrelationId: (...args) => outcomes.listOutcomesByCorrelationId(...args),
    listMissingInputs: (...args) => outcomes.listMissingInputs(...args),
    listSnapshotsByRun: (...args) => outcomes.listSnapshotsByRun(...args),
    countSnapshotsByRun: (...args) => outcomes.countSnapshotsByRun(...args),
    listUnitEconomicsSnapshots: (...args) => outcomes.listUnitEconomicsSnapshots(...args),
    summarizeProfit: (...args) => outcomes.summarizeProfit(...args),
    listComponentsByRun: (...args) => outcomes.listComponentsByRun(...args),
    countComponentsByRun: (...args) => outcomes.countComponentsByRun(...args),
    countSellerAggregates: (...args) => outcomes.countSellerAggregates(...args),
    countSellerReconciliationAggregates: (...args) =>
      outcomes.countSellerReconciliationAggregates!(...args),
    listCostComponents: (...args) => outcomes.listCostComponents(...args),
    listBySourceRecord: (...args) => outcomes.listBySourceRecord(...args),
  };
  const runReader: EconomicRunReader = {
    getRun: (...args) => runs.getRun(...args),
    getLastRunBySeller: (...args) => runs.getLastRunBySeller(...args),
    listRunsBySeller: (...args) => runs.listRunsBySeller(...args),
    getActiveRun: (...args) => runs.getActiveRun(...args),
    getCheckpoint: (...args) => runs.getCheckpoint(...args),
    getSourceCheckpoint: (...args) => runs.getSourceCheckpoint!(...args),
    getSourceHealth: (...args) => runs.getSourceHealth!(...args),
  };
  const evidenceReader: EconomicEvidenceReader = {
    getEvidence: (...args) => evidence.getEvidence(...args),
    listBySeller: (...args) => evidence.listBySeller(...args),
    listByRun: (...args) => evidence.listByRun(...args),
    listBySourceRecord: (...args) => evidence.listBySourceRecord(...args),
    countByRun: (...args) => evidence.countByRun(...args),
    countBySeller: (...args) => evidence.countBySeller!(...args),
  };
  return {
    readers: { outcomes: outcomeReader, runs: runReader, evidence: evidenceReader },
    writeSessionFactory,
    maintenanceAdmission,
    close: () => db.close(),
  };
}
