import type Database from "better-sqlite3";
import type { ConversationState, ConversationMessage } from "./types.js";

// ── Schema ───────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_active_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at DESC);
`;

// ── Session store ────────────────────────────────────────────────────

/**
 * SQLite-backed session store that makes the agent stateless.
 *
 * Conversation state, including message history and session metadata,
 * is persisted in a `sessions` table.  Multiple agent instances can
 * share the same database, enabling horizontal scaling later.
 */
export function createSessionStore(db: Database.Database) {
  db.exec(SCHEMA_SQL);

  // ── Prepared statements ──────────────────────────────────────

  const saveStmt = db.prepare(`
    INSERT INTO sessions (id, state_json, created_at, last_active_at)
    VALUES (@id, @stateJson, @createdAt, @lastActiveAt)
    ON CONFLICT(id) DO UPDATE SET
      state_json = @stateJson,
      last_active_at = @lastActiveAt
  `);

  const loadStmt = db.prepare(`
    SELECT state_json, last_active_at FROM sessions WHERE id = ?
  `);

  const deleteStmt = db.prepare(`DELETE FROM sessions WHERE id = ?`);

  const listActiveStmt = db.prepare(`
    SELECT id, last_active_at
    FROM sessions
    ORDER BY last_active_at DESC
    LIMIT ?
  `);

  // ── Public API ────────────────────────────────────────────────

  /**
   * Persist the conversation state for a session.
   *
   * Uses upsert semantics: creates a new session when `id` does not
   * exist, or atomically replaces the state on duplicate keys.
   */
  function save(sessionId: string, state: ConversationState): void {
    const now = new Date().toISOString();
    saveStmt.run({
      id: sessionId,
      stateJson: JSON.stringify(state),
      createdAt: now,
      lastActiveAt: now,
    });
  }

  /**
   * Load a previously persisted session.
   *
   * Returns `null` when the session ID has no saved state (first request
   * or expired session).
   */
  function load(sessionId: string): ConversationState | null {
    const row = loadStmt.get(sessionId) as
      { state_json: string; last_active_at: string } | undefined;
    if (!row) return null;

    try {
      const raw = JSON.parse(row.state_json) as Record<string, unknown>;
      const state: ConversationState = {
        messages: Array.isArray(raw.messages)
          ? raw.messages.map((m: ConversationMessage) => ({
              role: m.role,
              content: m.content,
              timestamp: new Date(m.timestamp),
            }))
          : [],
        contextWindowLimit:
          typeof raw.contextWindowLimit === "number" ? raw.contextWindowLimit : 50,
        sessionMetadata:
          typeof raw.sessionMetadata === "object" && raw.sessionMetadata !== null
            ? (raw.sessionMetadata as ConversationState["sessionMetadata"])
            : { sellerId: "", startedAt: new Date(), lastActivityAt: new Date() },
      };
      return state;
    } catch {
      return null;
    }
  }

  /** Remove a session and its conversation history entirely. */
  function remove(sessionId: string): void {
    deleteStmt.run(sessionId);
  }

  /**
   * List active sessions ordered by most recent activity.
   *
   * @param limit Maximum number of sessions to return (default 50).
   */
  function listActive(limit = 50): Array<{ id: string; lastActive: string }> {
    const rows = listActiveStmt.all(limit) as Array<{
      id: string;
      last_active_at: string;
    }>;
    return rows.map((r) => ({ id: r.id, lastActive: r.last_active_at }));
  }

  return { save, load, delete: remove, listActive };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
