import Database from "better-sqlite3";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { backupDatabase } from "./backup.js";
import { closeSharedDb } from "./connectionPool.js";
import type {
  EconomicDatabaseLifecycle,
  EconomicDatabaseFenceIdentity,
} from "./economicDatabaseLifecycle.js";
import {
  readEconomicDatabaseFence,
  type MigrationApplyResult,
  type MigrationRegistry,
} from "./migrationRegistry.js";

// ── Types ──────────────────────────────────────────────────────────────

export type BackupVerifyResult = {
  /** Whether the backup passes integrity check. */
  ok: boolean;
  /** Error detail when `ok` is `false`. */
  error?: string;
  /** Page count of the verified backup file. */
  pages: number;
};

export type IntegrityResult = {
  /** Whether integrity check returns "ok". */
  ok: boolean;
  /** Error messages from PRAGMA integrity_check (empty when ok). */
  errors: string[];
};

export type WalCheckpointResult = {
  /** WAL pages before checkpoint. */
  pagesBefore: number;
  /** WAL pages after checkpoint. */
  pagesAfter: number;
};

export type EconomicRestoreResult = {
  /** The only successful terminal state for an economic restore. */
  readonly outcome: "completed";
  readonly stagePath: string;
  readonly priorPath: string;
  readonly manifestPath: string;
};

export type EconomicRestoreInput = {
  readonly backupPath: string;
  readonly fence: EconomicDatabaseFenceIdentity;
  readonly lifecycle: EconomicDatabaseLifecycle;
  readonly migrationRegistry: MigrationRegistry;
  readonly restoreId?: string;
  /** Deterministic fault seam for the SQLite checkpoint receipt. */
  readonly checkpoint?: () => {
    readonly busy: number;
    readonly log: number;
    readonly checkpointed: number;
  };
  /** Test seam invoked by the descriptor-bound production copy after its first chunk. */
  readonly onCopyChunk?: () => void;
  /** Test seam invoked after stage migrations but before economic identity proof. */
  readonly afterStageMigration?: (stagePath: string) => void;
  /** Test seam for strict staged WAL checkpoint receipts. */
  readonly stageCheckpoint?: (stageDb: Database.Database) => unknown;
  /** Test-only durability seam; production uses file and parent-directory fsync. */
  readonly durability?: {
    readonly syncFile?: (path: string) => void;
    readonly syncDirectory?: (path: string) => void;
    readonly rename?: (from: string, to: string) => void;
    readonly writeTemporaryFile?: (descriptor: number, contents: string) => void;
    readonly syncTemporaryFile?: (descriptor: number) => void;
  };
};

export type DatabaseManager = {
  /**
   * Create a backup of the managed database to `targetPath` using
   * SQLite's online backup API. Delegates to {@link backupDatabase}.
   *
   * @returns the number of pages copied.
   */
  backup(targetPath: string): Promise<number>;

  /**
   * Verify a backup file by opening it and running
   * `PRAGMA integrity_check`.
   */
  verifyBackup(backupPath: string): BackupVerifyResult;

  /**
   * Restore the managed database from a verified backup file.
   *
   * **Atomic**: copies the backup to a staging directory under
   * `os.tmpdir()`, then uses `fs.renameSync` to replace the live
   * database file. On failure the original file is preserved.
   *
   * Requires coordination with {@link closeSharedDb} / {@link getSharedDb}
   * — the managed connection is closed before the restore and reopened
   * afterwards.
   */
  restoreFrom(backupPath: string): Promise<void>;

  /** Restore an economic database through its lifecycle fence and 1013 journal. */
  restoreEconomicFrom(input: EconomicRestoreInput): Promise<EconomicRestoreResult>;

  /**
   * Run `PRAGMA integrity_check` on the managed database.
   */
  checkIntegrity(): IntegrityResult;

  /**
   * Run `PRAGMA wal_checkpoint(TRUNCATE)` on the managed database.
   * Returns WAL page counts before and after the checkpoint.
   */
  checkpointWAL(): WalCheckpointResult;

  /**
   * Apply pending migrations from the given registry against the
   * managed database.
   */
  migrate(registry: MigrationRegistry): MigrationApplyResult;
};

// ── No-op manager (returned when durability is disabled) ───────────────

function createNoopDatabaseManager(): DatabaseManager {
  return {
    backup(): Promise<number> {
      return Promise.resolve(0);
    },
    verifyBackup(): BackupVerifyResult {
      return { ok: true, pages: 0 };
    },
    restoreFrom(): Promise<void> {
      return Promise.resolve();
    },
    restoreEconomicFrom(): Promise<EconomicRestoreResult> {
      return Promise.reject(
        new Error("Economic restore is unavailable when durability is disabled"),
      );
    },
    checkIntegrity(): IntegrityResult {
      return { ok: true, errors: [] };
    },
    checkpointWAL(): WalCheckpointResult {
      return { pagesBefore: 0, pagesAfter: 0 };
    },
    migrate(): MigrationApplyResult {
      return { applied: 0, skipped: 0 };
    },
  };
}

// ── Real manager ───────────────────────────────────────────────────────

/**
 * Wraps a `better-sqlite3` Database handle with durability operations.
 * Intended to be created via {@link getSharedManager} so the managed
 * database is the shared connection pool singleton for the given path.
 */
class LiveDatabaseManager implements DatabaseManager {
  /** Absolute path to the live SQLite database file. */
  private dbPath: string;
  private openDb: () => Database.Database;

  constructor(dbPath: string, openDb: () => Database.Database) {
    this.dbPath = dbPath;
    this.openDb = openDb;
  }

  backup(targetPath: string): Promise<number> {
    const db = this.openDb();
    return backupDatabase(db, targetPath);
  }

  verifyBackup(backupPath: string): BackupVerifyResult {
    if (!existsSync(backupPath)) {
      return { ok: false, error: "Backup file does not exist", pages: 0 };
    }

    let backupDb: Database.Database;
    try {
      backupDb = new Database(backupPath, { readonly: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Cannot open backup: ${message}`, pages: 0 };
    }

    try {
      const result = backupDb.pragma("integrity_check") as Array<{ integrity_check: string }>;
      const ok = result.length === 1 && result[0]!.integrity_check === "ok";

      const pages =
        (
          backupDb.prepare("SELECT page_count FROM pragma_page_count").get() as {
            page_count: number;
          }
        )?.page_count ?? 0;

      if (!ok) {
        const errors = result.map((r) => r.integrity_check).filter((s) => s !== "ok");
        return { ok: false, error: errors.join("; "), pages };
      }

      return { ok: true, pages };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Verification failed: ${message}`, pages: 0 };
    } finally {
      backupDb.close();
    }
  }

  restoreFrom(backupPath: string): Promise<void> {
    try {
      this.restoreFromSync(backupPath);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async restoreEconomicFrom(input: EconomicRestoreInput): Promise<EconomicRestoreResult> {
    // Snapshot every caller-controlled input before the first await.  Later checks
    // bind these values to filesystem and economic identities rather than paths.
    const restoreId = input.restoreId ?? randomUUID();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(restoreId))
      throw new Error("Economic restore ID is not filesystem-safe");
    const lexicalTargetPath = resolve(this.dbPath);
    const recoveryDir = realpathSync(dirname(lexicalTargetPath));
    const recoveryTargetPath = join(recoveryDir, basename(lexicalTargetPath));
    const recoveryPriorPath = join(
      recoveryDir,
      `.${basename(recoveryTargetPath)}.${restoreId}.prior`,
    );
    const recoveryManifestPath = join(
      recoveryDir,
      `.${basename(recoveryTargetPath)}.${restoreId}.manifest.json`,
    );
    let target!: BoundRegularFile;
    let backup!: BoundRegularFile;
    let stage: BoundRegularFile | undefined;
    let handleProtocolFailure: ((error: Error) => Promise<void>) | undefined;
    let existingJournal: EconomicRestoreJournalRow | undefined;
    try {
      backup = bindRegularFile(input.backupPath, "backup");
      if (!existsSync(recoveryTargetPath) && existsSync(recoveryPriorPath)) {
        const prior = bindRegularFile(recoveryPriorPath, "recovery prior");
        try {
          const verifiedBackup = verifyBoundBackup(backup);
          const descriptorPath = `/proc/self/fd/${prior.descriptor}`;
          const priorDb = new Database(descriptorPath, { readonly: true });
          try {
            const live = readEconomicDatabaseFence(priorDb);
            const journal = readExistingRestoreJournal(descriptorPath, restoreId);
            const expected: EconomicRestoreJournalBinding = {
              restoreId,
              databaseId: live.databaseId,
              databaseGeneration: live.generation,
              backupIdentity: `${backup.identity.sha256}:${verifiedBackup.pages}`,
              backupSha256: backup.identity.sha256,
              backupPageCount: verifiedBackup.pages,
              ownerRunId: input.fence.ownerRunId,
              fenceGeneration: input.fence.generation,
              fenceTokenDigest: createHash("sha256").update(input.fence.token).digest("hex"),
              writeEpoch: live.writeEpoch,
            };
            const manifest = bindExistingRestoreManifest(recoveryManifestPath, {
              restoreId,
              targetPath: recoveryTargetPath,
              backupPath: backup.path,
            });
            if (
              !verifiedBackup.ok ||
              !journal ||
              journal.outcome !== null ||
              !sameEconomicRestoreJournalBinding(journal, expected) ||
              manifest?.phase !== "prior-preservation-intent" ||
              !sameBoundFileIdentity(prior)
            )
              throw new Error("Economic restore interrupted prior identity is ambiguous");
          } finally {
            priorDb.close();
          }
          (input.durability?.rename ?? renameSync)(recoveryPriorPath, recoveryTargetPath);
          (input.durability?.syncDirectory ?? fsyncDirectory)(recoveryDir);
          if (!samePathFileIdentity(recoveryTargetPath, prior.identity))
            throw new Error("Economic restore interrupted prior recovery failed");
        } finally {
          prior.close();
        }
      }
      target = bindRegularFile(recoveryTargetPath, "target");
      try {
        if (
          target.identity.device === backup.identity.device &&
          target.identity.inode === backup.identity.inode
        )
          throw new Error("Economic restore target and backup must not share an inode");
        const targetPath = target.path;
        const backupPath = backup.path;
        const lifecycle = input.lifecycle;
        // Capture callable seams now. Objects passed to restore are untrusted mutable
        // containers and lifecycle hooks run asynchronously.
        const enterDraining = lifecycle.enterDraining.bind(lifecycle);
        const reopen = lifecycle.reopen.bind(lifecycle);
        const prepareReopen = lifecycle.prepareReopen.bind(lifecycle);
        const commitReopen = lifecycle.commitReopen.bind(lifecycle);
        const blockLifecycle = lifecycle.block.bind(lifecycle);
        const recover = lifecycle.recover.bind(lifecycle);
        const lifecycleState = (): EconomicDatabaseLifecycle["state"] => lifecycle.state;
        const applyMigrations = input.migrationRegistry.apply.bind(input.migrationRegistry);
        const lifecyclePath = canonicalRegularFile(lifecycle.path, "lifecycle target");
        if (lifecyclePath !== targetPath)
          throw new Error("Economic restore lifecycle path is not bound to target");
        const fence = { ...input.fence };
        const artifactDir = realpathSync(dirname(targetPath));
        const stagePath = join(artifactDir, `.${basename(targetPath)}.${restoreId}.stage`);
        const priorPath = join(artifactDir, `.${basename(targetPath)}.${restoreId}.prior`);
        const manifestPath = join(
          artifactDir,
          `.${basename(targetPath)}.${restoreId}.manifest.json`,
        );
        const failedStagePath = `${stagePath}.failed`;
        existingJournal = readExistingRestoreJournal(targetPath, restoreId);
        if (!existingJournal)
          rejectExistingArtifacts(stagePath, priorPath, manifestPath, failedStagePath);
        let journalDb: Database.Database | undefined;
        let journalOwned = false;
        let manifestIdentity: FileIdentity | undefined;
        let stageCreated = false;
        let quiesced = false;
        let priorPreserved = false;
        let priorIdentity: FileIdentity | undefined;
        const journalBinding = {
          current: undefined as EconomicRestoreJournalBinding | undefined,
        };
        const checkpoint = input.checkpoint;
        const onCopyChunk = input.onCopyChunk;
        const afterStageMigration = input.afterStageMigration;
        const stageCheckpoint = input.stageCheckpoint;
        const sync = { ...(input.durability ?? {}) };
        const syncFile = sync.syncFile ?? fsyncPath;
        const syncDirectory = sync.syncDirectory ?? fsyncDirectory;
        const writeTemporaryFile = sync.writeTemporaryFile ?? writeFileSync;
        const syncTemporaryFile = sync.syncTemporaryFile ?? fsyncSync;
        const renameArtifact = sync.rename ?? renameSync;
        const assertTargetBinding = (): void => {
          if (!sameBoundPathObjectIdentity(target))
            throw new Error("Economic restore target path is no longer bound to its descriptor");
        };
        const assertBackupPathBinding = (): void => {
          if (!sameBoundPathObjectIdentity(backup))
            throw new Error("Economic restore backup path is no longer bound to its descriptor");
        };
        const assertStagePathBinding = (): void => {
          if (!stage || !sameBoundPathObjectIdentity(stage))
            throw new Error("Economic restore stage path is no longer bound to its descriptor");
        };
        const syncArtifacts = (path: string): void => {
          syncFile(path);
          syncDirectory(dirname(path));
        };
        const writeManifest = (phase: string, extra: object = {}): void => {
          if (!journalOwned) throw new Error("Economic restore journal row is not owned");
          if (manifestIdentity && !samePathFileIdentity(manifestPath, manifestIdentity))
            throw new Error("Economic restore manifest path is no longer owned");
          if (!manifestIdentity) rejectExistingArtifacts(manifestPath);
          if (phase === "quiesced") {
            assertBackupPathBinding();
            if (stage) assertStagePathBinding();
          }
          writeDurableJson(
            manifestPath,
            {
              restoreId,
              targetPath,
              backupPath,
              databaseGeneration: fence.databaseGeneration,
              fenceGeneration: fence.generation,
              phase,
              stagePath,
              priorPath,
              ...extra,
            },
            {
              syncFile,
              syncDirectory,
              writeTemporaryFile,
              syncTemporaryFile,
              renameArtifact,
              syncArtifacts,
            },
          );
          manifestIdentity = fileIdentity(manifestPath);
        };
        const assertBoundFence = (db?: Database.Database): void => {
          const owned = db ?? new Database(targetPath, { readonly: true });
          try {
            const live = readEconomicDatabaseFence(owned);
            if (
              fence.expiresAt <= Date.now() ||
              live.ownerRunId !== fence.ownerRunId ||
              live.fenceGeneration !== fence.generation ||
              live.generation !== fence.databaseGeneration ||
              live.tokenDigest !== createHash("sha256").update(fence.token).digest("hex") ||
              live.expiresAt !== fence.expiresAt ||
              live.lifecycle !== "active"
            )
              throw new Error("Economic restore fence rejected");
          } finally {
            if (!db) owned.close();
          }
        };
        const targetCanReopen = (): boolean => {
          try {
            assertTargetBinding();
            assertBoundFence();
            return true;
          } catch {
            return false;
          }
        };
        const recordPhase = (
          db: Database.Database,
          phase:
            | "draining"
            | "staged"
            | "quiesced"
            | "prior-preserved"
            | "promotion-intent"
            | "promoted"
            | "verifying"
            | "completed"
            | "rolled-back"
            | "failed",
          journalPath = targetPath,
        ): void => {
          if (!journalOwned) throw new Error("Economic restore journal row is not owned");
          db.prepare(
            "UPDATE economic_restore_journal SET phase = ?, updated_at = unixepoch() WHERE restore_id = ?",
          ).run(phase, restoreId);
          const receipt = db.pragma("wal_checkpoint(TRUNCATE)");
          if (!isZeroCheckpointReceipt(receipt))
            throw new Error("Economic restore journal checkpoint did not reach zero frames");
          syncJournalArtifacts(journalPath, { syncFile, syncDirectory }); // Journal is durable before its matching manifest.
        };
        const restorePrior = async (rootError: Error): Promise<Error | undefined> => {
          const failures: Error[] = [];
          try {
            journalDb?.close();
            journalDb = undefined;
            assertBackupPathBinding();
            if (!priorIdentity) throw new Error("Economic restore prior evidence is unavailable");
            if (!samePathFileIdentity(priorPath, priorIdentity)) {
              if (!samePathBoundObjectIdentity(priorPath, target))
                throw new Error("Economic restore prior evidence is no longer bound");
              // Journal writes legitimately mutate the original descriptor after
              // rename. Refresh full-byte evidence only while that exact descriptor
              // still owns the prior pathname.
              priorIdentity = verifyDatabaseIdentity(priorPath, "mutated prior");
            }
            if (existsSync(targetPath)) {
              const targetOwnedByStage = stage
                ? samePathBoundObjectIdentity(targetPath, stage)
                : false;
              const targetJournal = readExistingRestoreJournal(targetPath, restoreId);
              if (
                stage
                  ? !targetOwnedByStage
                  : !journalBinding.current ||
                    !targetJournal ||
                    !sameEconomicRestoreJournalBinding(targetJournal, journalBinding.current)
              )
                throw new Error("Economic restore rollback target is not the promoted stage");
              if (existsSync(failedStagePath))
                throw new Error("Economic restore rollback failed-stage artifact already exists");
              renameArtifact(targetPath, failedStagePath);
            }
            if (!existsSync(targetPath)) renameArtifact(priorPath, targetPath);
            syncDirectory(artifactDir);
            if (!samePathFileIdentity(targetPath, priorIdentity))
              throw new Error("Economic restore rollback target identity verification failed");
            assertDatabaseIntegrity(targetPath, "rollback");
            assertBoundFence();
            if (lifecycleState() === "quiesced" || lifecycleState() === "blocked") {
              // A completion failure may leave an earlier prepareReopen pending.
              // Reset that attempt, rebuild once, and keep admission closed until
              // rollback evidence is durable.
              blockLifecycle();
              await prepareReopen(fence);
            }
            const rollbackJournal = new Database(targetPath);
            try {
              rollbackJournal
                .prepare(
                  "UPDATE economic_restore_journal SET phase = 'rolled-back', outcome = 'rolled-back', failure_detail = ?, updated_at = unixepoch() WHERE restore_id = ?",
                )
                .run(rootError.message, restoreId);
              if (!isZeroCheckpointReceipt(rollbackJournal.pragma("wal_checkpoint(TRUNCATE)")))
                throw new Error(
                  "Economic restore rollback journal checkpoint did not reach zero frames",
                );
              syncJournalArtifacts(targetPath, { syncFile, syncDirectory });
            } finally {
              rollbackJournal.close();
            }
            writeManifest("rolled-back", { failureDetail: rootError.message, failedStagePath });
            // Admission changes only after all terminal evidence is durable.
            if (lifecycleState() === "quiesced" || lifecycleState() === "blocked")
              commitReopen(fence);
            quiesced = false;
            return undefined;
          } catch (error) {
            failures.push(asError(error));
            try {
              blockLifecycle();
            } catch (blockError) {
              failures.push(asError(blockError));
            }
            try {
              if (existsSync(targetPath) && journalOwned)
                recordFailedRollback(targetPath, restoreId, rootError, syncFile, syncDirectory);
            } catch (journalError) {
              failures.push(asError(journalError));
            }
            return combinedError(rootError, failures);
          }
        };
        handleProtocolFailure = async (rootError: Error): Promise<void> => {
          if (priorPreserved) {
            const rollbackError = await restorePrior(rootError);
            if (rollbackError) throw rollbackError;
            return;
          }
          const detail = rootError.message;
          const targetStillBound = sameBoundPathObjectIdentity(target);
          const backupStillBound = sameBoundPathObjectIdentity(backup);
          const stageStillBound = !stage || sameBoundPathObjectIdentity(stage);
          try {
            if (!targetStillBound) throw new Error("Economic restore target binding was lost");
            if (!journalOwned) throw new Error("Economic restore journal row is not owned");
            const failureJournal = journalDb ?? new Database(targetPath);
            try {
              failureJournal
                .prepare(
                  "UPDATE economic_restore_journal SET phase = 'failed', outcome = 'failed', failure_detail = ?, updated_at = unixepoch() WHERE restore_id = ?",
                )
                .run(detail, restoreId);
              recordPhase(failureJournal, "failed");
            } finally {
              if (failureJournal !== journalDb) failureJournal.close();
            }
          } catch {
            // The original failure is authoritative.
          } finally {
            journalDb?.close();
          }
          if (journalOwned) {
            try {
              writeManifest("failed", {
                failureDetail: detail,
                targetStillBound,
                backupStillBound,
                stageStillBound,
              });
            } catch {
              // Earlier durable phase evidence remains authoritative.
            }
          }
          if (stageCreated && stage && sameBoundPathObjectIdentity(stage)) {
            try {
              unlinkSync(stagePath);
            } catch {
              // Cleanup must not mask the root cause.
            }
          }
          if ((quiesced || lifecycle.state === "blocked") && targetCanReopen()) {
            try {
              if (lifecycleState() === "quiesced") await reopen(fence);
              else if (lifecycleState() === "blocked") await recover(fence);
            } catch {
              // Recovery is attempted only through lifecycle-safe transition gates.
            }
          }
        };

        const backupIdentity = backup.identity;
        const verifiedBackup = verifyBoundBackup(backup);
        if (!verifiedBackup.ok)
          throw new Error(`Backup verification failed: ${verifiedBackup.error ?? "unknown error"}`);

        const targetProof = new Database(targetPath, { readonly: true });
        let live: ReturnType<typeof readEconomicDatabaseFence>;
        try {
          assertBoundFence(targetProof);
          if (!economicRestoreTargetSchemaIsApplied(targetProof))
            throw new Error("Economic restore target journal schema is not applied");
          live = readEconomicDatabaseFence(targetProof);
        } finally {
          targetProof.close();
        }
        const expectedEconomicIdentity = {
          databaseId: live.databaseId,
          databaseGeneration: live.generation,
        };
        const backupSha256 = backupIdentity.sha256;
        const identity = `${backupSha256}:${verifiedBackup.pages}`;
        journalBinding.current = {
          restoreId,
          databaseId: live.databaseId,
          databaseGeneration: live.generation,
          backupIdentity: identity,
          backupSha256,
          backupPageCount: verifiedBackup.pages,
          ownerRunId: fence.ownerRunId,
          fenceGeneration: fence.generation,
          fenceTokenDigest: live.tokenDigest,
          writeEpoch: live.writeEpoch,
        };
        if (existingJournal) {
          journalOwned = true;
          if (!sameEconomicRestoreJournalBinding(existingJournal, journalBinding.current)) {
            blockLifecycle();
            throw new Error(
              `Economic restore ${restoreId} journal identity does not match request`,
            );
          }
          let existingManifest: ReturnType<typeof bindExistingRestoreManifest>;
          try {
            existingManifest = bindExistingRestoreManifest(manifestPath, {
              restoreId,
              targetPath,
              backupPath,
            });
            manifestIdentity = existingManifest?.identity;
          } catch (error) {
            blockLifecycle();
            throw error;
          }
          if (existingJournal.outcome === "completed") {
            const completedTarget = new Database(targetPath, { readonly: true });
            try {
              assertFinalEconomicProof(completedTarget, expectedEconomicIdentity, fence);
            } catch (error) {
              blockLifecycle();
              throw error;
            } finally {
              completedTarget.close();
            }
            try {
              priorIdentity = verifyDatabaseIdentity(priorPath, "completed prior");
              const completedPriorJournal = readExistingRestoreJournal(priorPath, restoreId);
              if (
                !completedPriorJournal ||
                !sameEconomicRestoreJournalBinding(completedPriorJournal, journalBinding.current)
              )
                throw new Error("Economic restore completed prior journal identity is ambiguous");
            } catch (error) {
              blockLifecycle();
              throw error;
            }
            if (existingManifest?.phase !== "completed")
              writeManifest("completed", { priorSha256: priorIdentity.sha256 });
            if (lifecycleState() === "quiesced") await reopen(fence);
            else if (lifecycleState() === "blocked") await recover(fence);
            return { outcome: "completed", stagePath, priorPath, manifestPath };
          }
          if (existingJournal.outcome === "rolled-back") {
            if (lifecycleState() === "quiesced") await reopen(fence);
            else if (lifecycleState() === "blocked") await recover(fence);
            throw new Error(`Economic restore ${restoreId} already rolled back`);
          }
          if (existingJournal.outcome === "failed") {
            throw new Error(`Economic restore ${restoreId} already failed`);
          }
          if (existsSync(priorPath)) {
            const priorJournal = readExistingRestoreJournal(priorPath, restoreId);
            if (
              !priorJournal ||
              !sameEconomicRestoreJournalBinding(priorJournal, journalBinding.current)
            ) {
              blockLifecycle();
              throw new Error(`Economic restore ${restoreId} prior identity is ambiguous`);
            }
            priorIdentity = verifyDatabaseIdentity(priorPath, "recovery prior");
            priorPreserved = true;
            if (lifecycleState() === "open") {
              await enterDraining(fence);
              quiesced = true;
            }
            const recoveryError = new Error(
              `Economic restore ${restoreId} recovered nonterminal phase ${existingJournal.phase}`,
            );
            const rollbackError = await restorePrior(recoveryError);
            if (rollbackError) throw rollbackError;
            throw recoveryError;
          }
          recordFailedRollback(
            targetPath,
            restoreId,
            new Error(`nonterminal phase ${existingJournal.phase} has no verified prior`),
            syncFile,
            syncDirectory,
          );
          if (lifecycleState() === "quiesced") await reopen(fence);
          else if (lifecycleState() === "blocked") await recover(fence);
          throw new Error(`Economic restore ${restoreId} recovered as failed`);
        }
        journalDb = this.openDb();
        assertBoundFence(journalDb);
        assertBackupPathBinding();
        insertJournal(journalDb, {
          restoreId,
          databaseId: live.databaseId,
          databaseGeneration: live.generation,
          backupIdentity: identity,
          backupSha256,
          backupPageCount: verifiedBackup.pages,
          ownerRunId: fence.ownerRunId,
          fenceGeneration: fence.generation,
          fenceTokenDigest: live.tokenDigest,
          writeEpoch: live.writeEpoch,
          phase: "fence-acquired",
        });
        journalOwned = true;
        assertTargetBinding();
        syncJournalArtifacts(targetPath, { syncFile, syncDirectory });
        writeManifest("fence-acquired", {
          backupIdentity: identity,
          backupSha256,
          databaseId: live.databaseId,
        });
        recordPhase(journalDb, "draining");
        writeManifest("draining", { backupIdentity: identity, backupSha256 });

        stage = copyBoundFile(backup, stagePath, onCopyChunk);
        stageCreated = true;
        assertBackupPathBinding();
        assertStagePathBinding();
        if (!sameBoundFileIdentity(backup))
          throw new Error("Backup changed while economic restore was preparing");
        const staged = this.verifyBackup(stagePath);
        const copiedStageIdentity = fileIdentity(stagePath);
        if (
          !staged.ok ||
          staged.pages !== verifiedBackup.pages ||
          copiedStageIdentity.size !== backupIdentity.size ||
          copiedStageIdentity.sha256 !== backupSha256
        )
          throw new Error("Independent staged backup verification failed");
        const stageDb = new Database(stagePath);
        try {
          applyMigrations(stageDb);
          assertBackupPathBinding();
          assertStagePathBinding();
          afterStageMigration?.(stagePath);
          assertBackupPathBinding();
          assertStagePathBinding();
          const stageCheckpointReceipt =
            stageCheckpoint?.(stageDb) ?? stageDb.pragma("wal_checkpoint(TRUNCATE)");
          assertBackupPathBinding();
          assertStagePathBinding();
          if (!isZeroCheckpointReceipt(stageCheckpointReceipt))
            throw new Error("Economic restore staged checkpoint did not reach zero frames");
          const stageIntegrity = stageDb.pragma("integrity_check") as Array<{
            integrity_check: string;
          }>;
          const stagedFence = readEconomicDatabaseFence(stageDb);
          if (
            stageIntegrity.length !== 1 ||
            stageIntegrity[0]?.integrity_check !== "ok" ||
            stagedFence.databaseId !== expectedEconomicIdentity.databaseId ||
            stagedFence.generation !== expectedEconomicIdentity.databaseGeneration
          )
            throw new Error("Post-migration staged economic identity verification failed");
        } finally {
          stageDb.close();
        }
        assertStagePathBinding();
        const verifiedStageIdentity = identityFromDescriptor(stage.descriptor);
        syncArtifacts(stagePath);
        fsyncSync(stage.descriptor);
        assertStagePathBinding();
        if (!samePathFileIdentity(stagePath, verifiedStageIdentity))
          throw new Error("Verified staged database changed before durable evidence");
        const stageSha256 = verifiedStageIdentity.sha256;
        recordPhase(journalDb, "staged");
        writeManifest("staged", { backupIdentity: identity, backupSha256, stageSha256 });

        // Participants own managed handles and may close them while draining. Keep
        // the pre-drain receipt durable, then release this handle before they run.
        journalDb.close();
        journalDb = undefined;
        // Journal writes intentionally change target size/mtime. Snapshot the
        // resulting authoritative object immediately before the first await so
        // the drain boundary still rejects every external replacement or mutation.
        const targetBeforeDrain = fileIdentity(targetPath);
        await enterDraining(fence);
        quiesced = true;
        assertBackupPathBinding();
        assertStagePathBinding();
        if (
          !samePathFileIdentity(targetPath, targetBeforeDrain) ||
          !sameBoundPathObjectIdentity(target)
        )
          throw new Error("Economic restore target identity changed while preparing");
        // A journal handle obtained before the drain is no longer valid. Reopen by
        // the canonical target path only after the lifecycle reports quiescence.
        journalDb = new Database(targetPath);
        assertBoundFence(journalDb);
        // Do not hold the journal open across the target checkpoint: SQLite must be
        // able to truncate its WAL before the post-checkpoint evidence is written.
        journalDb.close();
        journalDb = undefined;
        const checkpointReceipt = checkpoint?.() ?? checkpointTruncate(targetPath);
        assertBackupPathBinding();
        assertStagePathBinding();
        if (!isZeroCheckpoint(checkpointReceipt))
          throw new Error("Economic restore checkpoint did not reach zero frames");
        journalDb = new Database(targetPath);
        assertBoundFence(journalDb);
        recordPhase(journalDb, "quiesced");
        writeManifest("quiesced", { backupIdentity: identity, backupSha256, stageSha256 });
        journalDb.close();
        journalDb = undefined;
        // Preserve the original only after every prepared artifact is durable.  The
        // intent manifest is the crash boundary while the authoritative row remains
        // in the original target until it is independently proven as `prior`.
        assertTargetBinding();
        assertBackupPathBinding();
        if (!sameBoundFileIdentity(backup))
          throw new Error("Backup changed before prior preservation");
        assertStagePathBinding();
        assertBoundFence();
        writeManifest("prior-preservation-intent", { backupIdentity: identity, stageSha256 });
        priorIdentity = fileIdentity(targetPath);
        if (!samePathFileIdentity(targetPath, priorIdentity))
          throw new Error("Economic restore target changed before prior preservation");
        try {
          renameArtifact(targetPath, priorPath);
          if (!samePathFileIdentity(priorPath, priorIdentity))
            throw new Error("Economic restore prior identity verification failed");
          priorPreserved = true;
        } catch (error) {
          if (
            samePathBoundObjectIdentity(priorPath, target) &&
            samePathFileIdentity(priorPath, priorIdentity)
          )
            priorPreserved = true;
          throw error;
        }
        syncDirectory(artifactDir);
        const priorDb = new Database(priorPath, { readonly: true });
        try {
          const integrity = priorDb.pragma("integrity_check") as Array<{ integrity_check: string }>;
          if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok")
            throw new Error("Economic restore prior integrity verification failed");
          assertBoundFence(priorDb);
        } finally {
          priorDb.close();
        }
        const priorJournal = new Database(priorPath);
        try {
          recordPhase(priorJournal, "prior-preserved", priorPath);
        } finally {
          priorJournal.close();
        }
        // The journal update/checkpoint mutates the prior. Re-hash and re-verify
        // those final bytes before either promotion or any rollback reliance.
        priorIdentity = verifyDatabaseIdentity(priorPath, "prior final");
        writeManifest("prior-preserved", { priorSha256: priorIdentity.sha256, stageSha256 });

        // The promoted database must carry the same immutable operation row: the
        // original row now belongs to prior evidence and cannot survive replacement.
        const stagedJournal = new Database(stagePath);
        try {
          insertJournal(stagedJournal, {
            restoreId,
            databaseId: live.databaseId,
            databaseGeneration: live.generation,
            backupIdentity: identity,
            backupSha256,
            backupPageCount: verifiedBackup.pages,
            ownerRunId: fence.ownerRunId,
            fenceGeneration: fence.generation,
            fenceTokenDigest: live.tokenDigest,
            writeEpoch: live.writeEpoch,
            phase: "staged",
          });
          recordPhase(stagedJournal, "promotion-intent", stagePath);
        } finally {
          stagedJournal.close();
        }
        syncArtifacts(stagePath);
        assertBackupPathBinding();
        if (!sameBoundFileIdentity(backup)) throw new Error("Backup changed before promotion");
        assertStagePathBinding();
        const priorFence = new Database(priorPath, { readonly: true });
        try {
          assertBoundFence(priorFence);
        } finally {
          priorFence.close();
        }
        writeManifest("promotion-intent", { priorSha256: priorIdentity.sha256, stageSha256 });
        renameArtifact(stagePath, targetPath);
        stageCreated = false;
        syncDirectory(artifactDir);
        if (!samePathBoundObjectIdentity(targetPath, stage))
          throw new Error("Economic restore promoted target identity verification failed");
        const promoted = new Database(targetPath);
        try {
          recordPhase(promoted, "promoted");
          recordPhase(promoted, "verifying");
          assertFinalEconomicProof(promoted, expectedEconomicIdentity, fence);
        } finally {
          promoted.close();
        }
        const promotedIdentity = verifyDatabaseIdentity(targetPath, "promoted target");
        assertBoundFence();
        await prepareReopen(fence);
        if (
          !samePathBoundObjectIdentity(targetPath, stage) ||
          !samePathFileIdentity(targetPath, promotedIdentity)
        )
          throw new Error("Economic restore promoted target changed during participant reopen");
        assertBoundFence();
        const completed = new Database(targetPath);
        try {
          assertFinalEconomicProof(completed, expectedEconomicIdentity, fence);
          completed
            .prepare(
              "UPDATE economic_restore_journal SET phase = 'completed', outcome = 'completed', failure_detail = NULL, updated_at = unixepoch() WHERE restore_id = ?",
            )
            .run(restoreId);
          if (!isZeroCheckpointReceipt(completed.pragma("wal_checkpoint(TRUNCATE)")))
            throw new Error("Economic restore completion checkpoint did not reach zero frames");
          syncJournalArtifacts(targetPath, { syncFile, syncDirectory });
        } finally {
          completed.close();
        }
        writeManifest("completed", { priorSha256: priorIdentity.sha256, stageSha256 });
        // This is deliberately synchronous: no write permit can be issued between
        // participant reopening and durable completion evidence.
        commitReopen(fence);
        quiesced = false;
        return { outcome: "completed", stagePath, priorPath, manifestPath };
      } catch (error) {
        const rootError = error instanceof Error ? error : new Error(String(error));
        if (!existingJournal) {
          try {
            await handleProtocolFailure?.(rootError);
          } catch (failureError) {
            throw asError(failureError);
          }
        }
        throw rootError;
      } finally {
        // The inner protocol owns failure evidence. The outer boundary owns the
        // descriptors even when binding, lifecycle validation, or preflight fails.
      }
    } finally {
      target?.close();
      backup?.close();
      stage?.close();
    }
  }

  private restoreFromSync(backupPath: string): void {
    if (!existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    // 1. Verify the backup before attempting restore.
    const verification = this.verifyBackup(backupPath);
    if (!verification.ok) {
      throw new Error(`Backup verification failed: ${verification.error ?? "unknown error"}`);
    }

    // 2. Close the managed connection so the file is not locked.
    closeSharedDb();

    // 3. Copy backup to a staging file under os.tmpdir() for atomic rename.
    const stageDir = join(tmpdir(), "msl-restore");
    mkdirSync(stageDir, { recursive: true });
    const stageFile = join(stageDir, basename(this.dbPath));

    try {
      copyFileSync(backupPath, stageFile);
    } catch (err) {
      this.openDb(); // reopen before throwing
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to stage backup: ${message}`);
    }

    // 4. Atomically replace the live database with the staged backup.
    try {
      renameSync(stageFile, this.dbPath);
    } catch (err) {
      // Clean up the stage file and reopen.
      try {
        unlinkSync(stageFile);
      } catch {
        // Best effort cleanup.
      }
      this.openDb();
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Atomic restore failed: ${message}`);
    }

    // 5. Reopen the shared connection against the restored file.
    this.openDb();

    // 6. Final verification of the restored database.
    const restoredVerification = this.checkIntegrity();
    if (!restoredVerification.ok) {
      throw new Error(
        `Restored database fails integrity check: ${restoredVerification.errors.join("; ")}`,
      );
    }
  }

  checkIntegrity(): IntegrityResult {
    const db = this.openDb();
    const result = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
    const ok = result.length === 1 && result[0]!.integrity_check === "ok";
    const errors = result.map((r) => r.integrity_check).filter((s) => s !== "ok");
    return { ok, errors };
  }

  checkpointWAL(): WalCheckpointResult {
    const db = this.openDb();

    // Read WAL page count before checkpoint.
    const before = this.readWalPages(db);

    // Force a blocking checkpoint that truncates the WAL.
    db.pragma("wal_checkpoint(TRUNCATE)");

    const after = this.readWalPages(db);

    return { pagesBefore: before, pagesAfter: after };
  }

  migrate(registry: MigrationRegistry): MigrationApplyResult {
    const db = this.openDb();
    return registry.apply(db);
  }

  /**
   * Query the number of pages in the WAL file.
   * Returns 0 when the database is not in WAL mode or the WAL file
   * does not exist.
   */
  private readWalPages(db: Database.Database): number {
    try {
      const row = db.pragma("wal_checkpoint(PASSIVE)") as Array<{
        busy: number;
        log: number;
        checkpointed: number;
      }>;
      // The log column of a PASSIVE checkpoint call reports the total
      // number of frames in the WAL.
      return row[0]?.log ?? 0;
    } catch {
      return 0;
    }
  }
}

type FileObjectIdentity = {
  readonly device: number;
  readonly inode: number;
  readonly links: number;
};
type FileIdentity = FileObjectIdentity & {
  readonly size: number;
  readonly mtimeMs: number;
  readonly sha256: string;
};
type BoundRegularFile = {
  readonly path: string;
  /** Original resolved pathname whose lstat must continue to name this descriptor. */
  readonly bindingPath: string;
  readonly descriptor: number;
  readonly identity: FileIdentity;
  close(): void;
};

type EconomicRestoreJournalBinding = {
  readonly restoreId: string;
  readonly databaseId: string;
  readonly databaseGeneration: number;
  readonly backupIdentity: string;
  readonly backupSha256: string;
  readonly backupPageCount: number;
  readonly ownerRunId: string;
  readonly fenceGeneration: number;
  readonly fenceTokenDigest: string;
  readonly writeEpoch: number;
};

type EconomicRestoreJournalRow = EconomicRestoreJournalBinding & {
  readonly phase: string;
  readonly outcome: "completed" | "rolled-back" | "failed" | null;
};

function canonicalRegularFile(path: string, label: string): string {
  const bound = bindRegularFile(path, label);
  try {
    return bound.path;
  } finally {
    bound.close();
  }
}

function identityFromDescriptor(descriptor: number): FileIdentity {
  const metadata = fstatSync(descriptor);
  return {
    device: metadata.dev,
    inode: metadata.ino,
    links: metadata.nlink,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    sha256: sha256Descriptor(descriptor),
  };
}

function bindRegularFile(path: string, label: string): BoundRegularFile {
  const lexicalPath = resolve(path);
  // Open the caller path first.  Resolving it before opening creates a window in
  // which a renamed symlink can redirect the object we later bind.
  let descriptor: number;
  try {
    descriptor = openSync(lexicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    // lstat deliberately sees dangling symlinks, while open() only reports ENOENT.
    const metadata = lstatSync(lexicalPath);
    if (metadata.isSymbolicLink() || !metadata.isFile())
      throw new Error(`Economic restore ${label} must be a regular non-symlink file`);
    throw error;
  }
  try {
    const identity = identityFromDescriptor(descriptor);
    const canonicalPath = realpathSync(`/proc/self/fd/${descriptor}`);
    const pathMetadata = lstatSync(canonicalPath);
    if (
      pathMetadata.isSymbolicLink() ||
      !pathMetadata.isFile() ||
      pathMetadata.dev !== identity.device ||
      pathMetadata.ino !== identity.inode ||
      pathMetadata.nlink !== identity.links ||
      identity.links !== 1
    )
      throw new Error(
        identity.links !== 1
          ? `Economic restore ${label} must not be hard-linked`
          : `Economic restore ${label} changed while binding`,
      );
    return {
      path: canonicalPath,
      bindingPath: lexicalPath,
      descriptor,
      identity,
      close: () => closeSync(descriptor),
    };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function sha256Descriptor(descriptor: number): string {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (true) {
    const read = readSync(descriptor, chunk, 0, chunk.length, position);
    if (read === 0) return hash.digest("hex");
    hash.update(chunk.subarray(0, read));
    position += read;
  }
}

function fileIdentity(path: string): FileIdentity {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return identityFromDescriptor(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function sameBoundFileIdentity(bound: BoundRegularFile): boolean {
  try {
    const actual = identityFromDescriptor(bound.descriptor);
    return (
      actual.device === bound.identity.device &&
      actual.inode === bound.identity.inode &&
      actual.links === bound.identity.links &&
      actual.size === bound.identity.size &&
      actual.mtimeMs === bound.identity.mtimeMs &&
      actual.sha256 === bound.identity.sha256
    );
  } catch {
    return false;
  }
}

function samePathFileIdentity(path: string, expected: FileIdentity): boolean {
  try {
    const actual = fileIdentity(path);
    return (
      actual.device === expected.device &&
      actual.inode === expected.inode &&
      actual.links === expected.links &&
      actual.size === expected.size &&
      actual.mtimeMs === expected.mtimeMs &&
      actual.sha256 === expected.sha256
    );
  } catch {
    return false;
  }
}

function sameBoundPathObjectIdentity(bound: BoundRegularFile): boolean {
  try {
    const metadata = lstatSync(bound.bindingPath);
    return (
      !metadata.isSymbolicLink() &&
      metadata.isFile() &&
      metadata.dev === bound.identity.device &&
      metadata.ino === bound.identity.inode &&
      metadata.nlink === bound.identity.links
    );
  } catch {
    return false;
  }
}

function samePathBoundObjectIdentity(path: string, bound: BoundRegularFile): boolean {
  try {
    const pathMetadata = lstatSync(path);
    const descriptorMetadata = fstatSync(bound.descriptor);
    return (
      !pathMetadata.isSymbolicLink() &&
      pathMetadata.isFile() &&
      pathMetadata.dev === descriptorMetadata.dev &&
      pathMetadata.ino === descriptorMetadata.ino &&
      pathMetadata.nlink === descriptorMetadata.nlink &&
      descriptorMetadata.nlink === 1
    );
  } catch {
    return false;
  }
}

function verifyBoundBackup(backup: BoundRegularFile): BackupVerifyResult {
  // Linux exposes an open descriptor through procfs. The SQLite reader therefore
  // verifies the exact no-follow object that copyBoundFile will read, not a later
  // path lookup that an attacker can replace between validation and staging.
  const descriptorPath = `/proc/self/fd/${backup.descriptor}`;
  let backupDb: Database.Database;
  try {
    backupDb = new Database(descriptorPath, { readonly: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Cannot open bound backup: ${message}`, pages: 0 };
  }
  try {
    const result = backupDb.pragma("integrity_check") as Array<{ integrity_check: string }>;
    const ok = result.length === 1 && result[0]?.integrity_check === "ok";
    const pages =
      (
        backupDb.prepare("SELECT page_count FROM pragma_page_count").get() as {
          page_count: number;
        }
      )?.page_count ?? 0;
    if (!ok) {
      const errors = result.map((row) => row.integrity_check).filter((value) => value !== "ok");
      return { ok: false, error: errors.join("; "), pages };
    }
    return { ok: true, pages };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Bound backup verification failed: ${message}`, pages: 0 };
  } finally {
    backupDb.close();
  }
}

function rejectExistingArtifacts(...paths: string[]): void {
  for (const path of paths) {
    try {
      // lstat is mandatory: existsSync follows links and treats a dangling alias as absent.
      const metadata = lstatSync(path);
      const reason = metadata.nlink > 1 ? "hard-linked artifact" : "artifact already exists";
      throw new Error(`Economic restore ${reason}: ${path}`);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        // Absent is the only safe state. Every other lstat outcome is rejected.
      } else if (error instanceof Error && error.message.startsWith("Economic restore")) {
        throw error;
      } else {
        throw error;
      }
    }
    const tempPrefix = `${basename(path)}.`;
    for (const entry of readdirSync(dirname(path))) {
      if (!entry.startsWith(tempPrefix) || !entry.endsWith(".tmp")) continue;
      const temporaryPath = join(dirname(path), entry);
      const metadata = lstatSync(temporaryPath);
      const reason =
        metadata.nlink > 1 ? "hard-linked temporary artifact" : "temporary artifact already exists";
      throw new Error(`Economic restore ${reason} for: ${path}`);
    }
  }
}

function copyBoundFile(
  source: BoundRegularFile,
  destination: string,
  onCopyChunk?: () => void,
): BoundRegularFile {
  const destinationDescriptor = openSync(
    destination,
    constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  let bound = false;
  try {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    let invokedCopySeam = false;
    while (true) {
      const read = readSync(source.descriptor, chunk, 0, chunk.length, position);
      if (read === 0) break;
      let written = 0;
      while (written < read)
        written += writeSync(
          destinationDescriptor,
          chunk,
          written,
          read - written,
          position + written,
        );
      position += read;
      if (!invokedCopySeam) {
        invokedCopySeam = true;
        onCopyChunk?.();
      }
    }
    fsyncSync(destinationDescriptor);
    const identity = identityFromDescriptor(destinationDescriptor);
    const metadata = lstatSync(destination);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.dev !== identity.device ||
      metadata.ino !== identity.inode ||
      metadata.nlink !== identity.links ||
      identity.links !== 1
    )
      throw new Error("Economic restore stage path is no longer bound to its descriptor");
    bound = true;
    return {
      path: destination,
      bindingPath: destination,
      descriptor: destinationDescriptor,
      identity,
      close: () => closeSync(destinationDescriptor),
    };
  } catch (error) {
    try {
      unlinkSync(destination);
    } catch {
      // The copy failure is authoritative.
    }
    throw error;
  } finally {
    // A successful return transfers exclusive ownership to the stage binding.
    // The descriptor remains open so later lifecycle callbacks can be checked
    // against the exact object created with O_EXCL.
    if (!bound) closeSync(destinationDescriptor);
  }
}

function syncJournalArtifacts(
  targetPath: string,
  sync: NonNullable<EconomicRestoreInput["durability"]>,
): void {
  const syncFile = sync.syncFile ?? fsyncPath;
  syncFile(targetPath);
  const walPath = `${targetPath}-wal`;
  if (existsSync(walPath)) syncFile(walPath);
  (sync.syncDirectory ?? fsyncDirectory)(dirname(targetPath));
}

function writeDurableJson(
  path: string,
  value: object,
  durability: {
    readonly syncFile: (path: string) => void;
    readonly syncDirectory: (path: string) => void;
    readonly writeTemporaryFile: (descriptor: number, contents: string) => void;
    readonly syncTemporaryFile: (descriptor: number) => void;
    readonly renameArtifact: (from: string, to: string) => void;
    readonly syncArtifacts: (path: string) => void;
  },
): void {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  let temporaryCreated = false;
  let published = false;
  let publishedIdentity: FileIdentity | undefined;
  let completed = false;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    temporaryCreated = true;
    durability.writeTemporaryFile(descriptor, JSON.stringify(value));
    durability.syncTemporaryFile(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    durability.renameArtifact(temporaryPath, path);
    temporaryCreated = false;
    published = true;
    publishedIdentity = fileIdentity(path);
    // A manifest only claims a phase after the final file and parent are durable.
    durability.syncArtifacts(path);
    completed = true;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (temporaryCreated) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Preserve the root write/fsync/rename/directory-sync error.
      }
    }
    if (
      !completed &&
      published &&
      publishedIdentity &&
      samePathFileIdentity(path, publishedIdentity)
    ) {
      try {
        unlinkSync(path);
        durability.syncDirectory(dirname(path));
      } catch {
        // Preserve the root directory-sync error.
      }
    }
  }
}

function fsyncPath(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function isZeroCheckpoint(value: unknown): value is { busy: 0; log: 0; checkpointed: 0 } {
  if (typeof value !== "object" || value === null) return false;
  const receipt = value as Record<string, unknown>;
  return (
    Object.keys(receipt).length === 3 &&
    receipt.busy === 0 &&
    receipt.log === 0 &&
    receipt.checkpointed === 0
  );
}

function isZeroCheckpointReceipt(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && isZeroCheckpoint(value[0]);
}

function checkpointTruncate(path: string): { busy: number; log: number; checkpointed: number } {
  const db = new Database(path);
  try {
    const rows = db.pragma("wal_checkpoint(TRUNCATE)") as Array<{
      busy?: number;
      log?: number;
      checkpointed?: number;
    }>;
    const row: unknown = rows[0];
    if (!isZeroCheckpoint(row)) throw new Error("Economic restore checkpoint receipt is malformed");
    return row;
  } finally {
    db.close();
  }
}

function insertJournal(
  db: Database.Database,
  row: {
    restoreId: string;
    databaseId: string;
    databaseGeneration: number;
    backupIdentity: string;
    backupSha256: string;
    backupPageCount: number;
    ownerRunId: string;
    fenceGeneration: number;
    fenceTokenDigest: string;
    writeEpoch: number;
    phase: "fence-acquired" | "staged";
  },
): void {
  db.prepare(
    `INSERT INTO economic_restore_journal (
       restore_id, database_id, database_generation, backup_identity, backup_sha256,
       backup_page_count, owner_run_id, fence_generation, fence_token_digest, write_epoch, phase
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.restoreId,
    row.databaseId,
    row.databaseGeneration,
    row.backupIdentity,
    row.backupSha256,
    row.backupPageCount,
    row.ownerRunId,
    row.fenceGeneration,
    row.fenceTokenDigest,
    row.writeEpoch,
    row.phase,
  );
}

function readExistingRestoreJournal(
  targetPath: string,
  restoreId: string,
): EconomicRestoreJournalRow | undefined {
  const db = new Database(targetPath, { readonly: true });
  try {
    return db
      .prepare(
        `SELECT restore_id AS restoreId, database_id AS databaseId,
                database_generation AS databaseGeneration, backup_identity AS backupIdentity,
                backup_sha256 AS backupSha256, backup_page_count AS backupPageCount,
                owner_run_id AS ownerRunId, fence_generation AS fenceGeneration,
                fence_token_digest AS fenceTokenDigest, write_epoch AS writeEpoch,
                phase, outcome
         FROM economic_restore_journal WHERE restore_id = ?`,
      )
      .get(restoreId) as EconomicRestoreJournalRow | undefined;
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

function sameEconomicRestoreJournalBinding(
  actual: EconomicRestoreJournalBinding,
  expected: EconomicRestoreJournalBinding,
): boolean {
  return (
    actual.restoreId === expected.restoreId &&
    actual.databaseId === expected.databaseId &&
    actual.databaseGeneration === expected.databaseGeneration &&
    actual.backupIdentity === expected.backupIdentity &&
    actual.backupSha256 === expected.backupSha256 &&
    actual.backupPageCount === expected.backupPageCount &&
    actual.ownerRunId === expected.ownerRunId &&
    actual.fenceGeneration === expected.fenceGeneration &&
    actual.fenceTokenDigest === expected.fenceTokenDigest &&
    actual.writeEpoch === expected.writeEpoch
  );
}

function bindExistingRestoreManifest(
  manifestPath: string,
  expected: {
    readonly restoreId: string;
    readonly targetPath: string;
    readonly backupPath: string;
  },
): { readonly identity: FileIdentity; readonly phase: string } | undefined {
  if (!existsSync(manifestPath)) return undefined;
  const identity = fileIdentity(manifestPath);
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("Economic restore manifest is not valid JSON");
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    (manifest as Record<string, unknown>).restoreId !== expected.restoreId ||
    (manifest as Record<string, unknown>).targetPath !== expected.targetPath ||
    (manifest as Record<string, unknown>).backupPath !== expected.backupPath ||
    !samePathFileIdentity(manifestPath, identity)
  )
    throw new Error("Economic restore manifest identity does not match request");
  const phase = (manifest as Record<string, unknown>).phase;
  if (typeof phase !== "string") throw new Error("Economic restore manifest phase is invalid");
  return { identity, phase };
}

function assertDatabaseIntegrity(path: string, label: string): void {
  const db = new Database(path, { readonly: true });
  try {
    const integrity = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok")
      throw new Error(`Economic restore ${label} integrity verification failed`);
  } finally {
    db.close();
  }
}

function verifyDatabaseIdentity(path: string, label: string): FileIdentity {
  const identity = fileIdentity(path);
  assertDatabaseIntegrity(path, label);
  if (!samePathFileIdentity(path, identity))
    throw new Error(`Economic restore ${label} identity verification failed`);
  return identity;
}

function recordFailedRollback(
  targetPath: string,
  restoreId: string,
  rootError: Error,
  syncFile: (path: string) => void,
  syncDirectory: (path: string) => void,
): void {
  const db = new Database(targetPath);
  try {
    db.prepare(
      "UPDATE economic_restore_journal SET phase = 'failed', outcome = 'failed', failure_detail = ?, updated_at = unixepoch() WHERE restore_id = ?",
    ).run(`rollback blocked: ${rootError.message}`, restoreId);
    if (!isZeroCheckpointReceipt(db.pragma("wal_checkpoint(TRUNCATE)")))
      throw new Error("Economic restore failed journal checkpoint did not reach zero frames");
    syncJournalArtifacts(targetPath, { syncFile, syncDirectory });
  } finally {
    db.close();
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function combinedError(root: Error, failures: readonly Error[]): Error {
  if (failures.length === 0) return root;
  return new AggregateError([root, ...failures], `Economic restore failed: ${root.message}`);
}

function economicRestoreTargetSchemaIsApplied(db: Database.Database): boolean {
  const migration = db
    .prepare("SELECT 1 AS applied FROM schema_version WHERE version = 1013")
    .get() as { applied: number } | undefined;
  const objects = db
    .prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master WHERE
         (type = 'table' AND name = 'economic_restore_journal') OR
         (type = 'index' AND name IN ('idx_economic_restore_journal_phase', 'idx_economic_restore_journal_database')) OR
         (type = 'trigger' AND name = 'trg_economic_restore_journal_immutable_identity')`,
    )
    .get() as { count: number };
  const columns = db.pragma("table_info(economic_restore_journal)") as Array<{ name: string }>;
  const required =
    "restore_id database_id database_generation backup_identity backup_sha256 backup_page_count owner_run_id " +
    "fence_generation fence_token_digest write_epoch phase outcome failure_detail created_at updated_at";
  return (
    migration?.applied === 1 &&
    objects.count === 4 &&
    columns.map(({ name }) => name).join(" ") === required
  );
}

function assertFinalEconomicProof(
  db: Database.Database,
  expected: { readonly databaseId: string; readonly databaseGeneration: number },
  fence: EconomicDatabaseFenceIdentity,
): void {
  const integrity = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok")
    throw new Error("Economic restore final integrity verification failed");
  if (!economicRestoreTargetSchemaIsApplied(db))
    throw new Error("Economic restore final migration verification failed");
  const metadata = readEconomicDatabaseFence(db);
  if (
    metadata.databaseId !== expected.databaseId ||
    metadata.generation !== expected.databaseGeneration ||
    metadata.ownerRunId !== fence.ownerRunId ||
    metadata.fenceGeneration !== fence.generation ||
    metadata.tokenDigest !== createHash("sha256").update(fence.token).digest("hex") ||
    metadata.lifecycle !== "active"
  )
    throw new Error("Economic restore final economic identity or fence verification failed");
  const versions = db
    .prepare(
      "SELECT version FROM schema_version WHERE version BETWEEN 1007 AND 1011 ORDER BY version",
    )
    .all() as Array<{ version: number }>;
  if (versions.map(({ version }) => version).join(",") !== "1007,1008,1009,1010,1011")
    throw new Error("Economic restore final relational migration verification failed");
  assertAdmissionReceiptContract(db);
  const violations = db.pragma("foreign_key_check") as unknown[];
  if (violations.length !== 0)
    throw new Error("Economic restore final relational constraint verification failed");
}

function assertAdmissionReceiptContract(db: Database.Database): void {
  const columns = db.pragma("table_info(economic_database_write_admission_receipts)") as Array<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>;
  const expectedColumns = [
    "receipt_id:TEXT:1:1",
    "receipt_token_digest:TEXT:1:0",
    "seller_id:TEXT:1:0",
    "writer_kind:TEXT:1:0",
    "owner_run_id:TEXT:1:0",
    "database_generation:INTEGER:1:0",
    "fence_generation:INTEGER:1:0",
    "lease_generation:INTEGER:1:0",
    "status:TEXT:1:0",
    "issued_at:INTEGER:1:0",
    "expires_at:INTEGER:1:0",
    "consumed_at:INTEGER:0:0",
    "rejected_at:INTEGER:0:0",
  ];
  if (
    columns
      .map((column) => `${column.name}:${column.type}:${column.notnull}:${column.pk}`)
      .join("|") !== expectedColumns.join("|")
  )
    throw new Error("Economic restore final admission receipt column verification failed");
  const objects = db
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE name IN (?, ?, ?) ORDER BY name")
    .all(
      "economic_database_write_admission_receipts",
      "idx_economic_write_admission_receipts_binding",
      "idx_economic_write_admission_receipts_expiry",
    ) as Array<{ type: string; name: string; sql: string | null }>;
  const normalized = new Map(
    objects.map((object) => [object.name, (object.sql ?? "").toLowerCase().replace(/\s+/g, " ")]),
  );
  const tableSql = normalized.get("economic_database_write_admission_receipts") ?? "";
  const requiredTableSql = [
    "receipt_id text primary key not null",
    "receipt_token_digest text not null unique",
    "seller_id text not null",
    "writer_kind text not null",
    "owner_run_id text not null",
    "database_generation integer not null check(database_generation >= 1)",
    "fence_generation integer not null check(fence_generation >= 1)",
    "lease_generation integer not null check(lease_generation >= 1)",
    "status text not null check(status in ('issued', 'consumed', 'expired', 'rejected'))",
    "issued_at integer not null",
    "expires_at integer not null check(expires_at > issued_at)",
    "check((status = 'consumed') = (consumed_at is not null))",
    "check((status = 'rejected') = (rejected_at is not null))",
  ];
  if (
    objects.find((object) => object.name === "economic_database_write_admission_receipts")?.type !==
      "table" ||
    !requiredTableSql.every((fragment) => tableSql.includes(fragment))
  )
    throw new Error("Economic restore final admission receipt constraint verification failed");
  if (
    objects.length !== 3 ||
    objects.some((object) =>
      object.name === "economic_database_write_admission_receipts"
        ? object.type !== "table"
        : object.type !== "index",
    ) ||
    !normalized
      .get("idx_economic_write_admission_receipts_binding")
      ?.includes(
        "(seller_id, writer_kind, owner_run_id, database_generation, fence_generation, lease_generation, status, expires_at)",
      ) ||
    !normalized
      .get("idx_economic_write_admission_receipts_expiry")
      ?.includes("(status, expires_at)")
  )
    throw new Error("Economic restore final admission receipt index verification failed");
  const bindings = db
    .prepare(
      "SELECT COUNT(*) AS count FROM economic_database_write_admission_receipts WHERE database_generation < 1 OR fence_generation < 1 OR lease_generation < 1 OR expires_at <= issued_at",
    )
    .get() as { count: number };
  if (bindings.count !== 0)
    throw new Error("Economic restore final admission receipt binding verification failed");
}

// ── Factory ────────────────────────────────────────────────────────────

/**
 * Create a `DatabaseManager` wrapping the shared connection pool for
 * the given database path.
 *
 * When `MSL_DURABILITY_ENABLED` is `"true"`, returns a fully
 * operational manager. Otherwise returns a no-op implementation that
 * performs no mutations.
 *
 * @param dbPath — absolute path to the SQLite database file.
 * @param openDb — factory that returns (or reopens) the shared
 *   `better-sqlite3` Database handle.
 */
export function createDatabaseManager(
  dbPath: string,
  openDb: () => Database.Database,
): DatabaseManager {
  if (process.env.MSL_DURABILITY_ENABLED === "true") {
    return new LiveDatabaseManager(dbPath, openDb);
  }
  return createNoopDatabaseManager();
}
