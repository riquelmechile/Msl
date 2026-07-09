import crypto from "node:crypto";
import Database from "better-sqlite3";

// ── Constants ────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const CLAIM_TIMEOUT_MINUTES = 5;

// ── Migration ────────────────────────────────────────────────────────

export function migrateBusSchema(db: Database.Database): void {
  const cols = db.pragma("table_info(agent_message_bus)") as { name: string }[];
  const existing = new Set(cols.map((c) => c.name));
  const migrations: [string, string][] = [
    ["result_json", "TEXT"],
    ["error_json", "TEXT"],
    ["cancel_reason", "TEXT"],
    ["correlation_id", "TEXT"],
    ["parent_message_id", "TEXT"],
    ["seller_id", "TEXT"],
    ["learned_at", "TEXT"],
    ["outcome_score", "REAL"],
    ["action_id", "TEXT"],
  ];
  for (const [col, type] of migrations) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE agent_message_bus ADD COLUMN ${col} ${type}`);
    }
  }
}

// ── Schema ───────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_message_bus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  sender_agent_id TEXT NOT NULL,
  receiver_agent_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 5,
  attempts INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT,
  locked_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_amb_status_priority
  ON agent_message_bus(status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_amb_receiver_status
  ON agent_message_bus(receiver_agent_id, status, created_at);
`;

// ── Row type ─────────────────────────────────────────────────────────

type AgentMessageBusRow = {
  id: number;
  message_id: string;
  sender_agent_id: string;
  receiver_agent_id: string;
  message_type: string;
  payload_json: string;
  status: "pending" | "processing" | "resolved" | "failed" | "cancelled";
  priority: number;
  attempts: number;
  dedupe_key: string | null;
  locked_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  result_json: string | null;
  error_json: string | null;
  cancel_reason: string | null;
  correlation_id: string | null;
  parent_message_id: string | null;
  seller_id: string | null;
  learned_at: string | null;
  outcome_score: number | null;
  action_id: string | null;
};

// ── Public types ─────────────────────────────────────────────────────

export type AgentMessage = {
  id: number;
  messageId: string;
  senderAgentId: string;
  receiverAgentId: string;
  messageType: string;
  payloadJson: string;
  status: AgentMessageBusRow["status"];
  priority: number;
  attempts: number;
  dedupeKey: string | null;
  lockedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  resultJson: string | null;
  errorJson: string | null;
  cancelReason: string | null;
  correlationId: string | null;
  parentMessageId: string | null;
  sellerId: string | null;
  learnedAt: string | null;
  outcomeScore: number | null;
  actionId: string | null;
};

export type EnqueueAgentMessageInput = {
  senderAgentId: string;
  receiverAgentId: string;
  messageType: string;
  payloadJson: string;
  priority?: number;
  dedupeKey?: string;
  correlationId?: string;
  parentMessageId?: string;
  sellerId?: string;
  actionId?: string;
};

export type AgentMessageBusStore = {
  enqueue(input: EnqueueAgentMessageInput): AgentMessage;
  claimNext(receiverAgentId: string, options?: { limit?: number }): AgentMessage[];
  resolve(messageId: string, result?: unknown): void;
  fail(messageId: string, error?: string): void;
  cancel(messageId: string, reason?: string): void;
  /** Look up recent messages whose dedupe_key starts with `prefix` and were created after `since` (ISO date string). */
  lookupRecentByDedupePrefix(prefix: string, since: string): AgentMessage[];
  /** Retrieve messages that have reached max attempts and are in `failed` status. */
  getFailedMessages(limit?: number): AgentMessage[];
  /** Reset a failed message back to `pending` with 0 attempts so it can be retried. */
  reenqueueFailed(messageId: string): void;
  /** Retrieve messages stuck in `processing` longer than `timeoutMinutes` (default 10). */
  getProcessingStuck(timeoutMinutes?: number): AgentMessage[];
  /** Count of messages currently in `pending` status. */
  getPendingCount(): number;
  /** Retrieve all messages sharing the same correlation ID. */
  getMessagesByCorrelationId(correlationId: string): AgentMessage[];
  /** Retrieve messages with outcome scores for learning pipeline analysis. */
  getLearningHistory(options?: { since?: string; minScore?: number }): AgentMessage[];
  /** Record an outcome score and timestamp for a resolved message. */
  recordOutcome(messageId: string, score: number, learnedAt: string): void;
  /** Retrieve messages that have outcome_score IS NULL and a terminal status (resolved, failed, cancelled). */
  getUnscoredMessages(options?: { since?: string; limit?: number }): AgentMessage[];
};

// ── Row mapper ───────────────────────────────────────────────────────

function rowToAgentMessage(row: AgentMessageBusRow): AgentMessage {
  return {
    id: row.id,
    messageId: row.message_id,
    senderAgentId: row.sender_agent_id,
    receiverAgentId: row.receiver_agent_id,
    messageType: row.message_type,
    payloadJson: row.payload_json,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    dedupeKey: row.dedupe_key,
    lockedAt: row.locked_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resultJson: row.result_json,
    errorJson: row.error_json,
    cancelReason: row.cancel_reason,
    correlationId: row.correlation_id,
    parentMessageId: row.parent_message_id,
    sellerId: row.seller_id,
    learnedAt: row.learned_at,
    outcomeScore: row.outcome_score,
    actionId: row.action_id,
  };
}

// ── Factory ──────────────────────────────────────────────────────────

export function createAgentMessageBusStore(db: Database.Database): AgentMessageBusStore {
  db.exec(SCHEMA_SQL);
  migrateBusSchema(db);

  // ── Prepared statements ────────────────────────────────────

  const selectByDedupeKeyStmt = db.prepare(`
    SELECT * FROM agent_message_bus
    WHERE dedupe_key = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const insertStmt = db.prepare(`
    INSERT INTO agent_message_bus (
      message_id, sender_agent_id, receiver_agent_id,
      message_type, payload_json, status, priority, attempts, dedupe_key,
      correlation_id, parent_message_id, seller_id, action_id
    ) VALUES (
      @messageId, @senderAgentId, @receiverAgentId,
      @messageType, @payloadJson, 'pending', @priority, 0, @dedupeKey,
      @correlationId, @parentMessageId, @sellerId, @actionId
    )
  `);

  const selectPendingForClaimStmt = db.prepare(`
    SELECT id, message_id FROM agent_message_bus
    WHERE receiver_agent_id = ?
      AND (
        status = 'pending'
        OR (status = 'processing' AND locked_at < datetime('now', @staleThreshold))
      )
    ORDER BY priority ASC, created_at ASC
    LIMIT 1
  `);

  const updateClaimStmt = db.prepare(`
    UPDATE agent_message_bus
    SET status = 'processing', locked_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `);

  const selectByMessageIdStmt = db.prepare(`
    SELECT * FROM agent_message_bus WHERE message_id = ?
  `);

  const resolveStmt = db.prepare(`
    UPDATE agent_message_bus
    SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now'),
        result_json = @result
    WHERE message_id = @messageId AND status = 'processing'
  `);

  const failStmt = db.prepare(`
    UPDATE agent_message_bus
    SET
      attempts = attempts + 1,
      status = CASE WHEN attempts + 1 >= @maxAttempts THEN 'failed' ELSE 'pending' END,
      locked_at = CASE WHEN attempts + 1 >= @maxAttempts THEN locked_at ELSE NULL END,
      updated_at = datetime('now'),
      error_json = @error
    WHERE message_id = @messageId AND status = 'processing'
  `);

  const cancelStmt = db.prepare(`
    UPDATE agent_message_bus
    SET status = 'cancelled', updated_at = datetime('now'),
        cancel_reason = @reason
    WHERE message_id = @messageId AND status IN ('pending', 'processing')
  `);

  const lookupRecentByDedupePrefixStmt = db.prepare(`
    SELECT * FROM agent_message_bus
    WHERE dedupe_key LIKE ? AND created_at > ?
    ORDER BY created_at DESC
  `);

  const getFailedMessagesStmt = db.prepare(`
    SELECT * FROM agent_message_bus
    WHERE status = 'failed'
    ORDER BY updated_at DESC
    LIMIT ?
  `);

  const reenqueueFailedStmt = db.prepare(`
    UPDATE agent_message_bus
    SET status = 'pending', attempts = 0, locked_at = NULL, updated_at = datetime('now')
    WHERE message_id = ? AND status = 'failed'
  `);

  const getProcessingStuckStmt = db.prepare(`
    SELECT * FROM agent_message_bus
    WHERE status = 'processing'
    AND locked_at < datetime('now', ?)
    ORDER BY locked_at ASC
  `);

  const getPendingCountStmt = db.prepare(`
    SELECT COUNT(*) as cnt FROM agent_message_bus WHERE status = 'pending'
  `);

  const getMessagesByCorrelationIdStmt = db.prepare(`
    SELECT * FROM agent_message_bus
    WHERE correlation_id = ?
    ORDER BY created_at ASC
  `);

  const getLearningHistoryStmt = db.prepare(`
    SELECT * FROM agent_message_bus
    WHERE outcome_score IS NOT NULL
      AND (@since IS NULL OR learned_at > @since)
      AND (@minScore IS NULL OR outcome_score >= @minScore)
    ORDER BY learned_at DESC
  `);

  const getUnscoredMessagesStmt = db.prepare(`
    SELECT * FROM agent_message_bus
    WHERE outcome_score IS NULL
      AND status IN ('resolved', 'failed', 'cancelled')
      AND (@since IS NULL OR updated_at > @since)
    ORDER BY
      CASE status WHEN 'resolved' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,
      updated_at DESC
    LIMIT @limit
  `);

  const recordOutcomeStmt = db.prepare(`
    UPDATE agent_message_bus
    SET outcome_score = @score, learned_at = @learnedAt, updated_at = datetime('now')
    WHERE message_id = @messageId
  `);

  // ── API methods ────────────────────────────────────────────

  const enqueue = (input: EnqueueAgentMessageInput): AgentMessage => {
    if (input.dedupeKey != null) {
      const existing = selectByDedupeKeyStmt.get(input.dedupeKey) as AgentMessageBusRow | undefined;
      if (existing) {
        return rowToAgentMessage(existing);
      }
    }

    const messageId = crypto.randomUUID();
    insertStmt.run({
      messageId,
      senderAgentId: input.senderAgentId,
      receiverAgentId: input.receiverAgentId,
      messageType: input.messageType,
      payloadJson: input.payloadJson,
      priority: input.priority ?? 5,
      dedupeKey: input.dedupeKey ?? null,
      correlationId: input.correlationId ?? null,
      parentMessageId: input.parentMessageId ?? null,
      sellerId: input.sellerId ?? null,
      actionId: input.actionId ?? null,
    });

    const row = selectByMessageIdStmt.get(messageId) as AgentMessageBusRow;
    return rowToAgentMessage(row);
  };

  const claimNext = (receiverAgentId: string, options?: { limit?: number }): AgentMessage[] => {
    const limit = options?.limit ?? 1;
    const results: AgentMessage[] = [];
    const staleThreshold = `-${CLAIM_TIMEOUT_MINUTES} minutes`;

    const transaction = db.transaction(() => {
      for (let i = 0; i < limit; i++) {
        const candidate = selectPendingForClaimStmt.get(receiverAgentId, { staleThreshold }) as
          { id: number; message_id: string } | undefined;
        if (!candidate) break;

        updateClaimStmt.run(candidate.id);
        const row = selectByMessageIdStmt.get(candidate.message_id) as AgentMessageBusRow;
        results.push(rowToAgentMessage(row));
      }
    });

    transaction();
    return results;
  };

  const resolve = (messageId: string, result?: unknown): void => {
    const info = resolveStmt.run({
      messageId,
      result: result != null ? JSON.stringify(result) : null,
    });
    if (info.changes === 0) {
      throw new Error(`AgentMessage "${messageId}" not found or not in a resolvable state.`);
    }
  };

  const fail = (messageId: string, error?: string): void => {
    const info = failStmt.run({
      messageId,
      maxAttempts: MAX_ATTEMPTS,
      error:
        error != null
          ? JSON.stringify({ message: error, timestamp: new Date().toISOString() })
          : null,
    });
    if (info.changes === 0) {
      throw new Error(`AgentMessage "${messageId}" not found or not in processing state.`);
    }
  };

  const cancel = (messageId: string, reason?: string): void => {
    const info = cancelStmt.run({
      messageId,
      reason: reason ?? null,
    });
    if (info.changes === 0) {
      throw new Error(`AgentMessage "${messageId}" not found or not in a cancellable state.`);
    }
  };

  const lookupRecentByDedupePrefix = (prefix: string, since: string): AgentMessage[] => {
    const rows = lookupRecentByDedupePrefixStmt.all(`${prefix}%`, since) as AgentMessageBusRow[];
    return rows.map(rowToAgentMessage);
  };

  const getFailedMessages = (limit?: number): AgentMessage[] => {
    const rows = getFailedMessagesStmt.all(limit ?? 50) as AgentMessageBusRow[];
    return rows.map(rowToAgentMessage);
  };

  const reenqueueFailed = (messageId: string): void => {
    const info = reenqueueFailedStmt.run(messageId);
    if (info.changes === 0) {
      throw new Error(`AgentMessage "${messageId}" not found or not in failed state.`);
    }
  };

  const getProcessingStuck = (timeoutMinutes?: number): AgentMessage[] => {
    const threshold = `-${timeoutMinutes ?? 10} minutes`;
    const rows = getProcessingStuckStmt.all(threshold) as AgentMessageBusRow[];
    return rows.map(rowToAgentMessage);
  };

  const getPendingCount = (): number => {
    const row = getPendingCountStmt.get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  };

  const getMessagesByCorrelationId = (correlationId: string): AgentMessage[] => {
    const rows = getMessagesByCorrelationIdStmt.all(correlationId) as AgentMessageBusRow[];
    return rows.map(rowToAgentMessage);
  };

  const getLearningHistory = (options?: { since?: string; minScore?: number }): AgentMessage[] => {
    const rows = getLearningHistoryStmt.all({
      since: options?.since ?? null,
      minScore: options?.minScore ?? null,
    }) as AgentMessageBusRow[];
    return rows.map(rowToAgentMessage);
  };

  const recordOutcome = (messageId: string, score: number, learnedAt: string): void => {
    recordOutcomeStmt.run({ messageId, score, learnedAt });
  };

  const getUnscoredMessages = (options?: { since?: string; limit?: number }): AgentMessage[] => {
    const rows = getUnscoredMessagesStmt.all({
      since: options?.since ?? null,
      limit: options?.limit ?? 100,
    }) as AgentMessageBusRow[];
    return rows.map(rowToAgentMessage);
  };

  return {
    enqueue,
    claimNext,
    resolve,
    fail,
    cancel,
    lookupRecentByDedupePrefix,
    getFailedMessages,
    reenqueueFailed,
    getProcessingStuck,
    getPendingCount,
    getMessagesByCorrelationId,
    getLearningHistory,
    recordOutcome,
    getUnscoredMessages,
  };
}
