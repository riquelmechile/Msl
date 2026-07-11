import Database from "better-sqlite3";

// ── Types ──────────────────────────────────────────────────────────────

export interface MigrationStep {
  /** Monotonically increasing version number. */
  version: number;
  /** Human-readable label for diagnostics. */
  name: string;
  /** The migration function. Executed inside a transaction by the registry. */
  up: (db: Database.Database) => void;
}

export interface MigrationApplyResult {
  /** Number of migrations freshly applied in this run. */
  applied: number;
  /** Number of migrations already recorded and skipped. */
  skipped: number;
}

export interface MigrationRegistry {
  /** Register a migration step. Steps must be registered in version order. */
  register(step: MigrationStep): void;
  /**
   * Apply all pending migrations against the given database.
   *
   * Creates `schema_version` if absent, reads current version, and
   * executes each unapplied step inside a transaction.
   *
   * Idempotent — safe to call on an already-migrated database.
   */
  apply(db: Database.Database): MigrationApplyResult;
  /** Return the highest registered version (0 if none). */
  expectedVersion(): number;
}

// ── Internal helpers ───────────────────────────────────────────────────

/** SQL for the `schema_version` tracking table. */
const SCHEMA_VERSION_DDL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/**
 * Read the current schema version from the database.
 * Returns 0 when the table does not exist (fresh DB).
 */
function currentVersion(db: Database.Database): number {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get() as { name: string } | undefined;
  if (!exists) return 0;

  const row = db
    .prepare("SELECT MAX(version) as v FROM schema_version")
    .get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

// ── Factory ────────────────────────────────────────────────────────────

export function createMigrationRegistry(): MigrationRegistry {
  const steps: MigrationStep[] = [];

  const register = (step: MigrationStep): void => {
    // Validate monotonicity.
    if (steps.length > 0) {
      const last = steps[steps.length - 1]!;
      if (step.version <= last.version) {
        throw new Error(
          `Migration version must be monotonically increasing. Got ${step.version} after ${last.version}.`,
        );
      }
    }
    steps.push(step);
  };

  const apply = (db: Database.Database): MigrationApplyResult => {
    // Ensure tracking table exists.
    db.exec(SCHEMA_VERSION_DDL);

    const from = currentVersion(db);
    const pending = steps.filter((s) => s.version > from);

    if (pending.length === 0) {
      return { applied: 0, skipped: steps.length };
    }

    let applied = 0;
    let skipped = steps.filter((s) => s.version <= from).length;

    for (const step of pending) {
      // Double-check idempotency — version may have been recorded by an
      // earlier migration step inside this transaction.
      const already = db
        .prepare("SELECT version FROM schema_version WHERE version = ?")
        .get(step.version) as { version: number } | undefined;

      if (already) {
        skipped++;
        continue;
      }

      // Run the migration step inside a transaction.
      const runStep = db.transaction(() => {
        step.up(db);
        db.prepare("INSERT OR IGNORE INTO schema_version (version) VALUES (?)").run(step.version);
      });

      try {
        runStep();
        applied++;
      } catch (err) {
        // Transaction rolled back by SQLite. Log and rethrow so the
        // caller can decide how to handle the failure.
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Migration v${step.version} ("${step.name}") failed: ${message}`,
        );
      }
    }

    return { applied, skipped };
  };

  const expectedVersion = (): number => {
    if (steps.length === 0) return 0;
    return steps[steps.length - 1]!.version;
  };

  return { register, apply, expectedVersion };
}
