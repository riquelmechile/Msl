import crypto from "node:crypto";
import Database from "better-sqlite3";
import { createMigrationRegistry } from "@msl/memory";
import { computeDeferralDigest, computeSettlementDigest } from "./jcsCanonicalize.js";

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

type SchemaColumn = {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  dflt_value: string | null;
};

const DEFERRED_COLUMNS = [
  ["deferral_id", "TEXT"],
  ["deferral_generation", "INTEGER"],
  ["deferred_until", "TEXT"],
  ["deferred_at", "TEXT"],
  ["defer_reason", "TEXT"],
  ["defer_reason_detail", "TEXT"],
  ["defer_evidence_ref", "TEXT"],
  ["settlement_id", "TEXT"],
  ["settlement_digest", "TEXT"],
  ["deferral_digest", "TEXT"],
] as const;

// prettier-ignore
const AUDIT_COLUMNS = [
  ["operationId", "TEXT", 1, 1], ["operation", "TEXT", 1, 0], ["scopeJson", "TEXT", 1, 0],
  ["reason", "TEXT", 1, 0], ["evidenceRef", "TEXT", 1, 0], ["messageId", "TEXT", 0, 0],
  ["queryAsOf", "TEXT", 0, 0], ["queryCursorJson", "TEXT", 0, 0], ["queryLimit", "INTEGER", 0, 0],
  ["resultMessageIdsJson", "TEXT", 0, 0], ["nextCursorJson", "TEXT", 0, 0], ["createdAt", "TEXT", 1, 0],
] as const;

// prettier-ignore
function isDeferredLifecycleV3Applied(db: Database.Database): boolean {
  const bus = db.pragma("table_info(agent_message_bus)") as SchemaColumn[];
  const additions = bus.filter((column) => DEFERRED_COLUMNS.some(([name]) => name === column.name));
  const busOwned = DEFERRED_COLUMNS.every(([name, type], index) => {
    const column = additions[index];
    return column?.name === name && column.type === type && column.notnull === 0 &&
      column.pk === 0 && column.dflt_value === null;
  });
  const audit = db.pragma("table_info(agent_message_bus_operation_audit)") as SchemaColumn[];
  return busOwned && audit.length === AUDIT_COLUMNS.length && AUDIT_COLUMNS.every(
    ([name, type, notnull, pk], index) => {
      const column = audit[index];
      return column?.name === name && column.type === type && column.notnull === notnull &&
        column.pk === pk && column.dflt_value === null;
    },
  );
}

function migrateDeferredLifecycleV3(db: Database.Database): void {
  const existing = new Set(
    (db.pragma("table_info(agent_message_bus)") as SchemaColumn[]).map((column) => column.name),
  );
  for (const [name, type] of DEFERRED_COLUMNS) {
    if (!existing.has(name)) db.exec(`ALTER TABLE agent_message_bus ADD COLUMN ${name} ${type}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS agent_message_bus_operation_audit (
    operationId TEXT PRIMARY KEY NOT NULL, operation TEXT NOT NULL, scopeJson TEXT NOT NULL,
    reason TEXT NOT NULL, evidenceRef TEXT NOT NULL, messageId TEXT, queryAsOf TEXT,
    queryCursorJson TEXT, queryLimit INTEGER, resultMessageIdsJson TEXT,
    nextCursorJson TEXT, createdAt TEXT NOT NULL)`);
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
  status: "pending" | "processing" | "resolved" | "failed" | "cancelled" | "deferred";
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
  deferral_id: string | null;
  deferral_generation: number | null;
  deferred_until: string | null;
  deferred_at: string | null;
  defer_reason: string | null;
  defer_reason_detail: string | null;
  defer_evidence_ref: string | null;
  settlement_id: string | null;
  settlement_digest: string | null;
  deferral_digest: string | null;
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
  deferralId?: string | null;
  deferralGeneration?: number | null;
  deferredUntil?: string | null;
  deferredAt?: string | null;
  deferReason?: string | null;
  deferReasonDetail?: string | null;
  deferEvidenceRef?: string | null;
  settlementId?: string | null;
  settlementDigest?: string | null;
  deferralDigest?: string | null;
};

export type SellerScope = { kind: "seller"; sellerId: string };
// prettier-ignore
export type SystemScope = { kind: "system"; operationId: string; reason: string; evidenceRef: string };
export type MutationScope = SellerScope | SystemScope;
// prettier-ignore
export type DeferOptions = { deferralId: string; deferralGeneration: number; deferredUntil?: string | null; reason: string; detail?: string | null; evidenceRef?: string | null; scope: MutationScope };
// prettier-ignore
export type ResumeDeferredOptions = { deferralId: string; deferralGeneration: number; scope: MutationScope };
export type SettlementOutcome = "resolved" | "failed" | "cancelled";
// prettier-ignore
export type ResolvedSettlementOptions = { settlementId: string; scope: MutationScope; evidence?: unknown; result?: unknown };
// prettier-ignore
export type FailedSettlementOptions = { settlementId: string; scope: MutationScope; evidence?: unknown; error?: unknown };
// prettier-ignore
export type CancelledSettlementOptions = { settlementId: string; scope: MutationScope; evidence?: unknown; reason?: string };
export type SettlementOptions =
  ResolvedSettlementOptions | FailedSettlementOptions | CancelledSettlementOptions;
export type DeferralCursor = { deferredUntil: string; createdAt: string; messageId: string };
// prettier-ignore
export type ExpiredDeferralsOptions = { scope: MutationScope; limit?: number; cursor?: DeferralCursor | null };
// prettier-ignore
export type ExpiredDeferralsResult = { messages: AgentMessage[]; queryAsOf: string; nextCursor: DeferralCursor | null };

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
  defer(messageId: string, options: DeferOptions): AgentMessage;
  resumeDeferred(messageId: string, options: ResumeDeferredOptions): AgentMessage;
  settle(messageId: string, outcome: SettlementOutcome, options: SettlementOptions): AgentMessage;
  getExpiredDeferrals(options: ExpiredDeferralsOptions): ExpiredDeferralsResult;
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
    deferralId: row.deferral_id,
    deferralGeneration: row.deferral_generation,
    deferredUntil: row.deferred_until,
    deferredAt: row.deferred_at,
    deferReason: row.defer_reason,
    deferReasonDetail: row.defer_reason_detail,
    deferEvidenceRef: row.defer_evidence_ref,
    settlementId: row.settlement_id,
    settlementDigest: row.settlement_digest,
    deferralDigest: row.deferral_digest,
  };
}

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${label} must be non-empty.`);
}

function assertScope(scope: MutationScope): void {
  if (!scope || (scope.kind !== "seller" && scope.kind !== "system")) {
    throw new Error("A valid mutation scope is required.");
  }
  if (scope.kind === "seller") return assertNonEmpty(scope.sellerId, "scope.sellerId");
  assertNonEmpty(scope.operationId, "scope.operationId");
  assertNonEmpty(scope.reason, "scope.reason");
  assertNonEmpty(scope.evidenceRef, "scope.evidenceRef");
}

function assertJson(value: unknown, label: string, seen = new WeakSet<object>()): void {
  if (value == null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || seen.has(value)) throw new Error(`${label} must be JSON.`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item) => assertJson(item, label, seen));
  else {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error(`${label} must be JSON.`);
    Object.values(value).forEach((item) => assertJson(item, label, seen));
  }
  seen.delete(value);
}

// ── Factory ──────────────────────────────────────────────────────────

export function createAgentMessageBusStore(db: Database.Database): AgentMessageBusStore {
  if (process.env.MSL_MIGRATION_ENABLED === "true") {
    const registry = createMigrationRegistry();
    registry.register({
      version: 1,
      name: "agent_message_bus_base",
      up: (d) => {
        d.exec(SCHEMA_SQL);
      },
    });
    registry.register({
      version: 2,
      name: "agent_message_bus_extensions",
      up: (d) => {
        migrateBusSchema(d);
      },
    });
    registry.register({
      version: 3,
      name: "agent_message_bus_deferred_lifecycle",
      isApplied: isDeferredLifecycleV3Applied,
      up: migrateDeferredLifecycleV3,
    });
    registry.apply(db);
  } else {
    // Legacy path (MSL_MIGRATION_ENABLED !== "true")
    db.exec(SCHEMA_SQL);
    migrateBusSchema(db);
    migrateDeferredLifecycleV3(db);
  }

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

  const selectScopedMessageStmt = db.prepare(`
    SELECT * FROM agent_message_bus
    WHERE message_id = @messageId AND (@sellerId IS NULL OR seller_id = @sellerId)
  `);

  const deferStmt = db.prepare(`
    UPDATE agent_message_bus SET
      status = 'deferred', deferral_id = @deferralId,
      deferral_generation = @deferralGeneration, deferred_until = @deferredUntil,
      deferred_at = datetime('now'), defer_reason = @reason,
      defer_reason_detail = @detail, defer_evidence_ref = @evidenceRef,
      deferral_digest = @digest, locked_at = NULL, updated_at = datetime('now')
    WHERE message_id = @messageId AND status = 'processing'
      AND @deferralGeneration > COALESCE(deferral_generation, 0)
      AND (@sellerId IS NULL OR seller_id = @sellerId)
  `);

  const resumeDeferredStmt = db.prepare(`
    UPDATE agent_message_bus SET status = 'pending', locked_at = NULL, updated_at = datetime('now')
    WHERE message_id = @messageId AND status = 'deferred'
      AND deferral_id = @deferralId AND deferral_generation = @deferralGeneration
      AND (@sellerId IS NULL OR seller_id = @sellerId)
  `);

  const settleStmt = db.prepare(`
    UPDATE agent_message_bus SET
      status = @outcome, settlement_id = @settlementId, settlement_digest = @digest,
      resolved_at = datetime('now'), updated_at = datetime('now'), locked_at = NULL,
      result_json = @result, error_json = @error, cancel_reason = @reason
    WHERE message_id = @messageId AND status IN ('processing', 'deferred')
      AND (@sellerId IS NULL OR seller_id = @sellerId)
  `);

  const queryAsOfStmt = db.prepare(`SELECT datetime('now') queryAsOf`);
  const selectExpiredDeferralsStmt = db.prepare(`
    SELECT * FROM agent_message_bus
    WHERE status = 'deferred' AND deferred_until IS NOT NULL
      AND datetime(deferred_until) <= datetime(@queryAsOf)
      AND (@sellerId IS NULL OR seller_id = @sellerId)
      AND (@cursorDeferredUntil IS NULL OR
        (datetime(deferred_until), datetime(created_at), message_id) >
        (datetime(@cursorDeferredUntil), datetime(@cursorCreatedAt), @cursorMessageId))
    ORDER BY datetime(deferred_until) ASC, datetime(created_at) ASC, message_id ASC
    LIMIT @limit
  `);

  const insertMutationAuditStmt = db.prepare(`
    INSERT INTO agent_message_bus_operation_audit (
      operationId, operation, scopeJson, reason, evidenceRef, messageId,
      queryAsOf, queryCursorJson, queryLimit, resultMessageIdsJson, nextCursorJson, createdAt
    ) VALUES (
      @operationId, @operation, @scopeJson, @reason, @evidenceRef, @messageId,
      NULL, NULL, NULL, NULL, NULL, datetime('now')
    )
  `);

  const insertQueryAuditStmt = db.prepare(`
    INSERT INTO agent_message_bus_operation_audit (
      operationId, operation, scopeJson, reason, evidenceRef, messageId,
      queryAsOf, queryCursorJson, queryLimit, resultMessageIdsJson, nextCursorJson, createdAt
    ) VALUES (
      @operationId, 'getExpiredDeferrals', @scopeJson, @reason, @evidenceRef, NULL,
      @queryAsOf, @queryCursorJson, @queryLimit, @resultMessageIdsJson,
      @nextCursorJson, datetime('now')
    )
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

  const auditMutation = (operation: string, messageId: string, scope: MutationScope): void => {
    if (scope.kind === "seller") return;
    insertMutationAuditStmt.run({
      operationId: scope.operationId,
      operation,
      scopeJson: JSON.stringify(scope),
      reason: scope.reason,
      evidenceRef: scope.evidenceRef,
      messageId,
    });
  };

  // prettier-ignore
  const defer = (messageId: string, options: DeferOptions): AgentMessage => {
    assertNonEmpty(messageId, "messageId");
    assertScope(options.scope);
    assertNonEmpty(options.deferralId, "deferralId");
    if (!Number.isInteger(options.deferralGeneration) || options.deferralGeneration < 1)
      throw new Error("deferralGeneration must be a positive integer.");
    assertNonEmpty(options.reason, "reason");
    if (options.detail != null && (typeof options.detail !== "string" || options.detail.length > 1000))
      throw new Error("detail must be a string of at most 1000 characters.");
    if (options.evidenceRef != null && typeof options.evidenceRef !== "string")
      throw new Error("evidenceRef must be a string.");
    const digest = computeDeferralDigest(messageId, options);
    return db.transaction(() => {
      const sellerId = options.scope.kind === "seller" ? options.scope.sellerId : null;
      const input = { messageId, ...options, deferredUntil: options.deferredUntil ?? null,
        detail: options.detail ?? null, evidenceRef: options.evidenceRef ?? null, digest, sellerId };
      const changed = deferStmt.run(input).changes;
      const row = selectScopedMessageStmt.get({ messageId, sellerId }) as AgentMessageBusRow | undefined;
      if (!row) throw new Error(`AgentMessage "${messageId}" is missing from the mutation scope.`);
      const exact = row.status === "deferred" && row.deferral_id === options.deferralId &&
        row.deferral_generation === options.deferralGeneration && row.deferral_digest === digest;
      if (changed === 0 && !exact) {
        if (options.deferralGeneration < (row.deferral_generation ?? 0))
          throw new Error(`AgentMessage "${messageId}" has a stale deferral generation.`);
        if (row.status === "deferred") throw new Error(`AgentMessage "${messageId}" has a conflicting deferral.`);
        throw new Error(`AgentMessage "${messageId}" is ${row.status}, not processing.`);
      }
      auditMutation("defer", messageId, options.scope);
      return rowToAgentMessage(row);
    })();
  };

  // prettier-ignore
  const resumeDeferred = (messageId: string, options: ResumeDeferredOptions): AgentMessage => {
    assertNonEmpty(messageId, "messageId");
    assertScope(options.scope);
    assertNonEmpty(options.deferralId, "deferralId");
    if (!Number.isInteger(options.deferralGeneration) || options.deferralGeneration < 1)
      throw new Error("deferralGeneration must be a positive integer.");
    return db.transaction(() => {
      const sellerId = options.scope.kind === "seller" ? options.scope.sellerId : null;
      const input = { messageId, deferralId: options.deferralId,
        deferralGeneration: options.deferralGeneration, sellerId };
      const changed = resumeDeferredStmt.run(input).changes;
      const row = selectScopedMessageStmt.get({ messageId, sellerId }) as AgentMessageBusRow | undefined;
      if (!row) throw new Error(`AgentMessage "${messageId}" is missing from the mutation scope.`);
      const exact = row.status === "pending" && row.deferral_id === options.deferralId &&
        row.deferral_generation === options.deferralGeneration;
      if (changed === 0 && !exact) {
        if (options.deferralGeneration < (row.deferral_generation ?? 0))
          throw new Error(`AgentMessage "${messageId}" has a stale deferral token.`);
        if (row.status === "deferred" || row.status === "pending")
          throw new Error(`AgentMessage "${messageId}" has a conflicting deferral token.`);
        throw new Error(`AgentMessage "${messageId}" is ${row.status}, not deferred.`);
      }
      auditMutation("resumeDeferred", messageId, options.scope);
      return rowToAgentMessage(row);
    })();
  };

  // prettier-ignore
  const settle = (messageId: string, outcome: SettlementOutcome, options: SettlementOptions): AgentMessage => {
    assertNonEmpty(messageId, "messageId");
    assertScope(options.scope);
    assertNonEmpty(options.settlementId, "settlementId");
    if (!(["resolved", "failed", "cancelled"] as const).includes(outcome))
      throw new Error("Invalid settlement outcome.");
    const values = options as SettlementOptions & Record<string, unknown>;
    assertJson(values.evidence, "evidence");
    if (outcome === "resolved") assertJson(values.result, "result");
    if (outcome === "failed") assertJson(values.error, "error");
    if (outcome === "cancelled" && values.reason != null && typeof values.reason !== "string")
      throw new Error("reason must be a string.");
    const digest = computeSettlementDigest(messageId, outcome, options);
    return db.transaction(() => {
      const sellerId = options.scope.kind === "seller" ? options.scope.sellerId : null;
      const changed = settleStmt.run({ messageId, outcome, settlementId: options.settlementId,
        digest, sellerId, result: outcome === "resolved" && values.result != null
          ? JSON.stringify(values.result) : null, error: outcome === "failed" && values.error != null
          ? JSON.stringify(values.error) : null,
        reason: outcome === "cancelled" ? (values.reason ?? null) : null }).changes;
      const row = selectScopedMessageStmt.get({ messageId, sellerId }) as AgentMessageBusRow | undefined;
      if (!row) throw new Error(`AgentMessage "${messageId}" is missing from the mutation scope.`);
      const exact = row.status === outcome && row.settlement_id === options.settlementId &&
        row.settlement_digest === digest;
      if (changed === 0 && !exact) {
        if (row.settlement_id != null)
          throw new Error(`AgentMessage "${messageId}" has a conflicting settlement.`);
        throw new Error(`AgentMessage "${messageId}" is ${row.status}, not settleable.`);
      }
      auditMutation("settle", messageId, options.scope);
      return rowToAgentMessage(row);
    })();
  };

  // prettier-ignore
  const getExpiredDeferrals = (options: ExpiredDeferralsOptions): ExpiredDeferralsResult => {
    assertScope(options.scope);
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("limit must be an integer from 1 to 100.");
    if (options.cursor) {
      assertNonEmpty(options.cursor.deferredUntil, "cursor.deferredUntil");
      assertNonEmpty(options.cursor.createdAt, "cursor.createdAt");
      assertNonEmpty(options.cursor.messageId, "cursor.messageId");
    }
    return db.transaction(() => {
      const queryAsOf = (queryAsOfStmt.get() as { queryAsOf: string }).queryAsOf;
      const sellerId = options.scope.kind === "seller" ? options.scope.sellerId : null;
      const cursor = options.cursor ?? null;
      const rows = selectExpiredDeferralsStmt.all({ queryAsOf, sellerId,
        cursorDeferredUntil: cursor?.deferredUntil ?? null, cursorCreatedAt: cursor?.createdAt ?? null,
        cursorMessageId: cursor?.messageId ?? null, limit }) as AgentMessageBusRow[];
      const last = rows.at(-1);
      const nextCursor = last ? { deferredUntil: last.deferred_until!, createdAt: last.created_at,
        messageId: last.message_id } : null;
      if (options.scope.kind === "system") insertQueryAuditStmt.run({
        operationId: options.scope.operationId, scopeJson: JSON.stringify(options.scope),
        reason: options.scope.reason, evidenceRef: options.scope.evidenceRef, queryAsOf,
        queryCursorJson: JSON.stringify(cursor), queryLimit: limit,
        resultMessageIdsJson: JSON.stringify(rows.map((row) => row.message_id)),
        nextCursorJson: JSON.stringify(nextCursor),
      });
      return { messages: rows.map(rowToAgentMessage), queryAsOf, nextCursor };
    })();
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
    defer,
    resumeDeferred,
    settle,
    getExpiredDeferrals,
  };
}
