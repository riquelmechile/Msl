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
  /** Unit 2B-1 only proves preparation; promotion is deliberately unavailable. */
  readonly outcome: "prepared";
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
    const target = bindRegularFile(this.dbPath, "target");
    let backup!: BoundRegularFile;
    let stage: BoundRegularFile | undefined;
    let handleProtocolFailure: ((error: Error) => Promise<void>) | undefined;
    try {
      backup = bindRegularFile(input.backupPath, "backup");
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
        rejectExistingArtifacts(stagePath, priorPath, manifestPath);
        let journalDb: Database.Database | undefined;
        let stageCreated = false;
        let quiesced = false;
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
          phase: "draining" | "staged" | "quiesced" | "failed",
        ): void => {
          assertTargetBinding();
          db.prepare(
            "UPDATE economic_restore_journal SET phase = ?, updated_at = unixepoch() WHERE restore_id = ?",
          ).run(phase, restoreId);
          const receipt = db.pragma("wal_checkpoint(TRUNCATE)");
          if (!isZeroCheckpointReceipt(receipt))
            throw new Error("Economic restore journal checkpoint did not reach zero frames");
          syncJournalArtifacts(targetPath, { syncFile, syncDirectory }); // Journal is durable before its matching manifest.
        };
        handleProtocolFailure = async (rootError: Error): Promise<void> => {
          const detail = rootError.message;
          const targetStillBound = sameBoundPathObjectIdentity(target);
          const backupStillBound = sameBoundPathObjectIdentity(backup);
          const stageStillBound = !stage || sameBoundPathObjectIdentity(stage);
          try {
            if (!targetStillBound) throw new Error("Economic restore target binding was lost");
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
          if (stageCreated) {
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
        journalDb = this.openDb();
        assertBoundFence(journalDb);
        assertBackupPathBinding();
        const backupSha256 = backupIdentity.sha256;
        const identity = `${backupSha256}:${verifiedBackup.pages}`;
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
        // Unit 2B-2 owns every rename, final verification, and completed outcome.
        assertTargetBinding();
        assertBoundFence();
        await reopen(fence);
        quiesced = false;
        assertBackupPathBinding();
        assertStagePathBinding();
        assertBoundFence();
        assertBackupPathBinding();
        assertStagePathBinding();
        if (!sameBoundFileIdentity(backup))
          throw new Error("Backup changed before economic restore reached prepared boundary");
        return { outcome: "prepared", stagePath, priorPath, manifestPath };
      } catch (error) {
        const rootError = error instanceof Error ? error : new Error(String(error));
        await handleProtocolFailure?.(rootError);
        throw rootError;
      } finally {
        // The inner protocol owns failure evidence. The outer boundary owns the
        // descriptors even when binding, lifecycle validation, or preflight fails.
      }
    } finally {
      target.close();
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
    if (!completed && published) {
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
