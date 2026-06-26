import Database from "better-sqlite3";

import type { ParsedRule, Strategy } from "./types.js";

// ── Schema ───────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ceo_strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  parsed_rule TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  status TEXT DEFAULT 'active',
  replaced_by INTEGER REFERENCES ceo_strategies(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

// ── Row mapping ──────────────────────────────────────────────────────

/**
 * Raw row shape returned by SQLite queries.
 * Column names use snake_case; the public Strategy interface uses camelCase.
 */
interface StrategyRow {
  id: number;
  rule_type: string;
  rule_text: string;
  parsed_rule: string;
  confidence: number;
  status: "active" | "archived" | "superseded";
  replaced_by: number | null;
  created_at: string;
  updated_at: string;
}

/** Map a database row to the public {@link Strategy} interface. */
function rowToStrategy(row: StrategyRow): Strategy {
  return {
    id: row.id,
    ruleType: row.rule_type as Strategy["ruleType"],
    ruleText: row.rule_text,
    parsedRule: JSON.parse(row.parsed_rule) as ParsedRule,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Create the strategy store backed by SQLite.
 *
 * Follows the same factory pattern as Cortex's `createDatabase`:
 * the caller owns the `Database` handle and the store only adds
 * its own schema and prepared statements.
 *
 * @param db An existing `better-sqlite3` Database connection.
 */
export function createStrategyStore(db: Database.Database) {
  // Apply the ceo_strategies schema if it doesn't exist yet.
  db.exec(SCHEMA_SQL);

  // ── Prepared statements ──────────────────────────────────────

  const insertStmt = db.prepare(`
    INSERT INTO ceo_strategies (rule_type, rule_text, parsed_rule, confidence)
    VALUES (@ruleType, @ruleText, @parsedRule, @confidence)
  `);

  const getStmt = db.prepare(`
    SELECT * FROM ceo_strategies WHERE id = ?
  `);

  const listActiveStmt = db.prepare(`
    SELECT * FROM ceo_strategies
    WHERE status = 'active'
    ORDER BY JSON_EXTRACT(parsed_rule, '$.priority') DESC, created_at DESC
  `);

  const archiveStmt = db.prepare(`
    UPDATE ceo_strategies
    SET status = 'archived', updated_at = datetime('now')
    WHERE id = ?
  `);

  const supersedeStmt = db.prepare(`
    UPDATE ceo_strategies
    SET status = 'superseded', replaced_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  const updateStmt = db.prepare(`
    UPDATE ceo_strategies
    SET rule_text = @ruleText,
        parsed_rule = @parsedRule,
        rule_type = @ruleType,
        updated_at = datetime('now')
    WHERE id = @id
  `);

  const countStmt = db.prepare(`
    SELECT COUNT(*) as count FROM ceo_strategies
  `);

  // ── CRUD operations ───────────────────────────────────────────

  /**
   * Persist a new parsed strategy.
   *
   * @returns The created {@link Strategy} with its assigned id and timestamps.
   */
  const insertStrategy = (
    ruleText: string,
    parsedRule: ParsedRule,
    confidence: number,
  ): Strategy => {
    const result = insertStmt.run({
      ruleType: parsedRule.ruleType,
      ruleText,
      parsedRule: JSON.stringify(parsedRule),
      confidence,
    });
    // Fetch the freshly-inserted row so we get db-generated defaults.
    return getStrategy(result.lastInsertRowid as number)!;
  };

  /**
   * Return all strategies whose status is `'active'`.
   *
   * Results are ordered by {@link ParsedRule.priority} descending,
   * then by creation date descending.
   */
  const listActive = (): Strategy[] => {
    const rows = listActiveStmt.all() as StrategyRow[];
    return rows.map(rowToStrategy);
  };

  /**
   * Retrieve a single strategy by its primary key.
   *
   * @returns The {@link Strategy} or `null` if no row matches `id`.
   */
  const getStrategy = (id: number): Strategy | null => {
    const row = getStmt.get(id) as StrategyRow | undefined;
    return row ? rowToStrategy(row) : null;
  };

  /**
   * Mark a strategy as archived (soft-delete).
   *
   * The row remains in the database but is excluded from {@link listActive}.
   */
  const archiveStrategy = (id: number): void => {
    archiveStmt.run(id);
  };

  /**
   * Supersede an existing strategy with a newer version.
   *
   * Sets the old strategy's status to `'superseded'` and records
   * which strategy replaced it via `replaced_by`.
   */
  const supersedeStrategy = (oldId: number, newId: number): void => {
    supersedeStmt.run(newId, oldId);
  };

  /**
   * Update an existing strategy's rule text and parsed content.
   *
   * The `id` is preserved; `updated_at` is refreshed automatically.
   *
   * @returns The updated {@link Strategy} or `null` if `id` doesn't exist.
   */
  const updateStrategy = (
    id: number,
    ruleText: string,
    parsedRule: ParsedRule,
  ): Strategy | null => {
    const result = updateStmt.run({
      id,
      ruleText,
      parsedRule: JSON.stringify(parsedRule),
      ruleType: parsedRule.ruleType,
    });
    if (result.changes === 0) return null;
    return getStrategy(id);
  };

  /**
   * Return the total number of rows in the table.
   *
   * Useful for test assertions and health checks.
   */
  const count = (): number => {
    const row = countStmt.get() as { count: number };
    return row.count;
  };

  return {
    insertStrategy,
    listActive,
    getStrategy,
    archiveStrategy,
    supersedeStrategy,
    updateStrategy,
    count,
  };
}
