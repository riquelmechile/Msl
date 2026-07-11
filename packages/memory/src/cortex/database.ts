import Database from "better-sqlite3";
import type { MigrationRegistry } from "../migrationRegistry.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  activation REAL NOT NULL DEFAULT 0.0,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source INTEGER NOT NULL REFERENCES nodes(id),
  target INTEGER NOT NULL REFERENCES nodes(id),
  weight REAL NOT NULL DEFAULT 0.5,
  last_activated TEXT,
  co_occurrence_count INTEGER NOT NULL DEFAULT 0,
  distilled_lesson TEXT,
  UNIQUE(source, target)
);

CREATE TABLE IF NOT EXISTS darwinian_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_node INTEGER NOT NULL,
  target_node INTEGER NOT NULL,
  lesson TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actor_simulations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL,
  query TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS probe_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL,
  probe_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

/**
 * Check whether a column exists in a table (idempotent migration guard).
 */
function columnExists(db: Database.Database, table: string, column: string): boolean {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return info.some((col) => col.name === column);
}

/**
 * Registered migration steps.  Each entry is a tuple of
 * `[targetVersion, sql]`.  Migrations are applied in version order and
 * each is wrapped in `INSERT OR IGNORE INTO schema_version`.
 */
const MIGRATIONS: Array<[number, string]> = [
  // Version 1: baseline — all tables created by SCHEMA_SQL above.
  [1, `INSERT OR IGNORE INTO schema_version (version) VALUES (1);`],
  // Version 2: seller-scoped Cortex columns (applied via columnExists guards in createDatabase).
  [2, `INSERT OR IGNORE INTO schema_version (version) VALUES (2);`],
];

/**
 * Run all pending migrations against the given database, recording
 * each completed migration in the `schema_version` table.
 *
 * The function is **idempotent**: re-running on an already-migrated
 * database is a safe no-op because each version is guarded by
 * `INSERT OR IGNORE`.
 *
 * @param db — an already-opened `better-sqlite3` Database connection.
 * @param targetVersion — migrate up to this version (default: latest available).
 *   Pass 0 to skip all migrations.  A version higher than the latest
 *   available migration is clamped to the maximum known version.
 */
export function migrate(
  db: Database.Database,
  targetVersion?: number,
): { applied: number; skipped: number } {
  const maxVersion = MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1]![0] : 0;
  const actualTarget = Math.min(targetVersion ?? maxVersion, maxVersion);

  let applied = 0;
  let skipped = 0;

  for (const [version, sql] of MIGRATIONS) {
    if (version > actualTarget) break;

    // Check if this version was already applied.
    const existing = db
      .prepare("SELECT version FROM schema_version WHERE version = ?")
      .get(version) as { version: number } | undefined;

    if (existing) {
      skipped++;
      continue;
    }

    try {
      db.exec(sql);
      applied++;
    } catch {
      skipped++;
    }
  }

  return { applied, skipped };
}

export function createDatabase(
  path = ":memory:",
  migrationRegistry?: MigrationRegistry,
): Database.Database {
  const db = new Database(path);

  // Enable WAL mode for concurrent read performance
  db.pragma("journal_mode = WAL");

  // Enforce foreign key constraints (off by default in SQLite)
  db.pragma("foreign_keys = ON");

  // Performance tunings
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -8000");
  db.pragma("temp_store = MEMORY");
  db.pragma("busy_timeout = 5000");

  // Apply schema
  db.exec(SCHEMA_SQL);

  // Additional indexes for query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label);
    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
  `);

  // Run any pending migrations
  if (migrationRegistry && process.env.MSL_MIGRATION_ENABLED === "true") {
    // Register Cortex migrations on the shared registry.
    // v1: baseline — all tables created by SCHEMA_SQL above.
    // v2: seller-scoped Cortex columns — applied via columnExists guards below.
    // Both steps are no-ops because the tables/columns are managed elsewhere;
    // the registry only records the version for future incremental migrations.
    migrationRegistry.register({
      version: 1,
      name: "cortex_baseline",
      up: () => {
        /* tables created by SCHEMA_SQL */
      },
    });
    migrationRegistry.register({
      version: 2,
      name: "cortex_seller_scoped",
      up: () => {
        /* column migrations handled by columnExists guards below */
      },
    });
    migrationRegistry.apply(db);
  } else {
    migrate(db);
  }

  // ── Idempotent column migrations: seller-scoped Cortex (PRAGMA table_info guard) ──
  if (!columnExists(db, "nodes", "seller_id")) {
    db.exec(`ALTER TABLE nodes ADD COLUMN seller_id TEXT DEFAULT 'unknown'`);
  }
  if (!columnExists(db, "edges", "seller_id")) {
    db.exec(`ALTER TABLE edges ADD COLUMN seller_id TEXT`);
  }
  if (!columnExists(db, "darwinian_lessons", "seller_id")) {
    db.exec(`ALTER TABLE darwinian_lessons ADD COLUMN seller_id TEXT`);
  }

  // Index for seller-scoped node queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_seller ON nodes(seller_id)`);

  return db;
}
