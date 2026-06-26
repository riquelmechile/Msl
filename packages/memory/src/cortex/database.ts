import Database from "better-sqlite3";

const SCHEMA_SQL = `
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

export function createDatabase(path = ":memory:"): Database.Database {
  const db = new Database(path);

  // Enable WAL mode for concurrent read performance
  db.pragma("journal_mode = WAL");

  // Enforce foreign key constraints (off by default in SQLite)
  db.pragma("foreign_keys = ON");

  // Apply schema
  db.exec(SCHEMA_SQL);

  return db;
}
