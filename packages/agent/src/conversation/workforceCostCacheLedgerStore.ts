import Database from "better-sqlite3";

import type { LaneId } from "./lanes.js";

export type WorkforceCacheStatus = "hit" | "miss" | "partial" | "unknown";

export type WorkforceCostCacheLedgerEntry = {
  entryId: string;
  agentId: string;
  laneId?: LaneId;
  departmentId?: string;
  provider: string;
  model: string;
  operation: string;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostMicros?: number;
  currency?: string;
  cacheStatus: WorkforceCacheStatus;
  metadata: Readonly<Record<string, string>>;
  measuredAt: string;
  createdAt: string;
};

export type RecordWorkforceCostCacheLedgerEntryInput = {
  entryId: string;
  agentId: string;
  laneId?: LaneId;
  departmentId?: string;
  provider: string;
  model: string;
  operation: string;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostMicros?: number;
  currency?: string;
  cacheStatus?: WorkforceCacheStatus;
  metadata?: Record<string, unknown>;
  measuredAt?: string;
  /** Optional seller attribution for per-account cost tracking. */
  sellerId?: string;
  /** Optional session attribution for work-session cost tracking. */
  sessionId?: string;
  /** Optional stable prompt hash for cache efficiency tracking. */
  stablePromptHash?: string;
  /** Optional evidence hash for cache efficiency tracking. */
  evidenceHash?: string;
};

export type ListWorkforceCostCacheLedgerEntriesFilter = {
  agentId?: string;
  laneId?: LaneId;
  from?: string;
  to?: string;
  limit?: number;
};

export type WorkforceCostAggregate = {
  byAgent: Map<
    string,
    { inputTokens: number; outputTokens: number; costMicros: number; entries: number }
  >;
  byDepartment: Map<string, { inputTokens: number; outputTokens: number; costMicros: number }>;
  byPeriod: Array<{ day: string; inputTokens: number; outputTokens: number }>;
  cacheEfficiency: number; // 0..1
};

export type WorkforceCostCacheLedgerStore = {
  insertEntry(input: RecordWorkforceCostCacheLedgerEntryInput): WorkforceCostCacheLedgerEntry;
  listEntries(
    filter?: ListWorkforceCostCacheLedgerEntriesFilter,
  ): readonly WorkforceCostCacheLedgerEntry[];
  count(): number;
  aggregateCosts(filter?: { days?: number }): WorkforceCostAggregate;
  /** Record a work session usage entry with session attribution. */
  recordAgentSessionUsage?(
    input: RecordWorkforceCostCacheLedgerEntryInput,
  ): WorkforceCostCacheLedgerEntry;
  /** Aggregate costs by agent within a seller account. */
  aggregateCostByAgentAndSeller?(
    sellerId: string,
  ): Map<
    string,
    { inputTokens: number; outputTokens: number; costMicros: number; entries: number }
  >;
  /** Compute cache efficiency ratio for a seller account. */
  aggregateCacheEfficiencyBySeller?(sellerId: string): number;
};

export type WorkforceCostCacheLedgerStoreOptions = {
  maxEntries?: number;
};

export const LEDGER_LIMITS = Object.freeze({
  minListLimit: 1,
  defaultListLimit: 20,
  maxListLimit: 50,
  defaultMaxEntries: 5_000,
  maxMetadataEntries: 12,
  maxMetadataKeyLength: 48,
  maxMetadataValueLength: 180,
  maxMetadataJsonBytes: 2_048,
  maxTimestampLength: 40,
  maxEntryIdLength: 96,
  maxAgentIdLength: 96,
  maxSlugLength: 64,
});

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workforce_cost_cache_ledger_entries (
  entry_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  lane_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  operation TEXT NOT NULL,
  prompt_cache_hit_tokens INTEGER,
  prompt_cache_miss_tokens INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_micros INTEGER,
  currency TEXT,
  cache_status TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  measured_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workforce_cost_cache_ledger_rollups (
  day TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  department_id TEXT,
  model TEXT NOT NULL,
  input_tokens_agg INTEGER NOT NULL DEFAULT 0,
  output_tokens_agg INTEGER NOT NULL DEFAULT 0,
  cache_hit_tokens_agg INTEGER NOT NULL DEFAULT 0,
  cache_miss_tokens_agg INTEGER NOT NULL DEFAULT 0,
  estimated_cost_micros_agg INTEGER NOT NULL DEFAULT 0,
  entry_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(day, agent_id, model)
);
`;

const MIGRATE_DEPARTMENT_ID_SQL = `
ALTER TABLE workforce_cost_cache_ledger_entries ADD COLUMN department_id TEXT;
`;

const MIGRATE_SESSION_COLS_SQL = [
  "ALTER TABLE workforce_cost_cache_ledger_entries ADD COLUMN seller_id TEXT",
  "ALTER TABLE workforce_cost_cache_ledger_entries ADD COLUMN session_id TEXT",
  "ALTER TABLE workforce_cost_cache_ledger_entries ADD COLUMN stable_prompt_hash TEXT",
  "ALTER TABLE workforce_cost_cache_ledger_entries ADD COLUMN evidence_hash TEXT",
];

type WorkforceCostCacheLedgerRow = {
  entry_id: string;
  agent_id: string;
  lane_id: string | null;
  department_id: string | null;
  provider: string;
  model: string;
  operation: string;
  prompt_cache_hit_tokens: number | null;
  prompt_cache_miss_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_micros: number | null;
  currency: string | null;
  cache_status: string;
  metadata: string;
  measured_at: string;
  created_at: string;
  seller_id: string | null;
  session_id: string | null;
  stable_prompt_hash: string | null;
  evidence_hash: string | null;
};

type RollupRow = {
  day: string;
  agent_id: string;
  department_id: string | null;
  model: string;
  input_tokens_agg: number;
  output_tokens_agg: number;
  cache_hit_tokens_agg: number;
  cache_miss_tokens_agg: number;
  estimated_cost_micros_agg: number;
  entry_count: number;
};

const cacheStatuses = new Set<WorkforceCacheStatus>(["hit", "miss", "partial", "unknown"]);
const entryIdPattern = new RegExp(`^[a-z][a-z0-9:_-]{2,${LEDGER_LIMITS.maxEntryIdLength - 1}}$`);
const agentIdPattern = new RegExp(`^[a-z][a-z0-9:_-]{1,${LEDGER_LIMITS.maxAgentIdLength - 1}}$`);
const slugPattern = new RegExp(`^[a-z][a-z0-9._:-]{0,${LEDGER_LIMITS.maxSlugLength - 1}}$`);
const currencyPattern = /^[A-Z]{3}$/;
const departmentIdPattern = new RegExp(`^[a-z][a-z0-9._:-]{0,${LEDGER_LIMITS.maxSlugLength - 1}}$`);
const unsafeMetadataKeyPattern =
  /prompt|response|message|conversation|secret|token|password|credential|authorization|api[_-]?key/i;
const unsafeMetadataValuePattern =
  /(?:secret|token|password|credential|authorization|api[_-]?key)\s*[:=]|\b(?:sk|ghp|gho|github_pat|xox[abprs])-[a-z0-9_-]{8,}|bearer\s+[a-z0-9._-]{12,}/i;
const promptInjectionPattern =
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|disregard\s+(?:previous|prior|above)|system\s+prompt|developer\s+message|reveal\s+(?:your\s+)?instructions|tool\s*(?:call|execution|escalation)|enable\s+admin|bypass\s+(?:auth|authorization|guardrails?)|ignora(?:r|́|á)?\s+(?:las\s+)?instrucciones|olvida\s+(?:las\s+)?instrucciones|revela\s+(?:el\s+)?prompt/i;

function normalizeText(value: unknown): string {
  if (!isMetadataScalar(value)) return "";
  const rawValue = typeof value === "string" ? value : String(value);
  return rawValue
    .replaceAll(/./gs, (char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? " " : char;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function isMetadataScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

function parseOptionalInteger(value: number | null): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parseMetadata(value: string): Readonly<Record<string, string>> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length > LEDGER_LIMITS.maxMetadataEntries) return undefined;
    const metadata: Record<string, string> = {};
    for (const [key, rawValue] of entries) {
      if (!isSafeMetadataKey(key)) return undefined;
      if (!isMetadataScalar(rawValue)) return undefined;
      const normalizedValue = normalizeText(rawValue);
      if (!isSafeMetadataValue(normalizedValue)) return undefined;
      metadata[key] = normalizedValue;
    }
    return Object.freeze(metadata);
  } catch {
    return undefined;
  }
}

function isSafeMetadataKey(key: string): boolean {
  return (
    key.length <= LEDGER_LIMITS.maxMetadataKeyLength &&
    /^[a-zA-Z][a-zA-Z0-9_.:-]*$/.test(key) &&
    !unsafeMetadataKeyPattern.test(key)
  );
}

function isSafeMetadataValue(value: string): boolean {
  return (
    value.length <= LEDGER_LIMITS.maxMetadataValueLength &&
    !promptInjectionPattern.test(value) &&
    !unsafeMetadataValuePattern.test(value)
  );
}

function sanitizeMetadata(value: Record<string, unknown> | undefined): Record<string, string> {
  if (!value) return {};
  const entries = Object.entries(value);
  if (entries.length > LEDGER_LIMITS.maxMetadataEntries)
    throw new Error("metadata too many entries");
  const metadata: Record<string, string> = {};
  for (const [key, rawValue] of entries) {
    if (!isSafeMetadataKey(key)) throw new Error("metadata contains unsafe key");
    if (!isMetadataScalar(rawValue)) {
      throw new Error("metadata values must be flat scalars");
    }
    const normalizedValue = normalizeText(rawValue);
    if (!isSafeMetadataValue(normalizedValue)) throw new Error("metadata contains unsafe value");
    metadata[key] = normalizedValue;
  }
  if (JSON.stringify(metadata).length > LEDGER_LIMITS.maxMetadataJsonBytes)
    throw new Error("metadata too large");
  return metadata;
}

function sanitizeDepartmentId(rawValue: unknown): string | undefined {
  if (rawValue === undefined || rawValue === null) return undefined;
  if (typeof rawValue !== "string") return undefined;
  const trimmed = rawValue.trim().toLowerCase();
  if (!departmentIdPattern.test(trimmed)) return undefined;
  return trimmed;
}

function extractDay(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    // Fallback: slice the first 10 characters as YYYY-MM-DD
    return timestamp.slice(0, 10);
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function assertSafeInput(input: RecordWorkforceCostCacheLedgerEntryInput): {
  metadata: Record<string, string>;
  measuredAt: string;
} {
  if (!entryIdPattern.test(input.entryId) || input.entryId.includes("..")) {
    throw new Error("invalid entryId");
  }
  if (!agentIdPattern.test(input.agentId) || input.agentId.includes("..")) {
    throw new Error("invalid agentId");
  }
  if (input.laneId && (!slugPattern.test(input.laneId) || input.laneId.includes(".."))) {
    throw new Error("invalid laneId");
  }
  for (const [field, value] of [
    ["provider", input.provider],
    ["model", input.model],
    ["operation", input.operation],
  ] as const) {
    if (!slugPattern.test(value) || value.includes("..")) throw new Error(`invalid ${field}`);
  }
  if (input.currency && !currencyPattern.test(input.currency)) throw new Error("invalid currency");
  if (input.cacheStatus && !cacheStatuses.has(input.cacheStatus))
    throw new Error("invalid cacheStatus");
  const numericFields = [
    input.promptCacheHitTokens,
    input.promptCacheMissTokens,
    input.inputTokens,
    input.outputTokens,
    input.estimatedCostMicros,
  ];
  if (
    numericFields.some(
      (value) => value !== undefined && optionalNonNegativeInteger(value) === undefined,
    )
  ) {
    throw new Error("invalid numeric ledger counter");
  }
  const measuredAt = input.measuredAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(measuredAt)) || measuredAt.length > LEDGER_LIMITS.maxTimestampLength)
    throw new Error("invalid measuredAt");
  return { metadata: sanitizeMetadata(input.metadata), measuredAt };
}

function rowToEntry(row: WorkforceCostCacheLedgerRow): WorkforceCostCacheLedgerEntry | undefined {
  if (!entryIdPattern.test(row.entry_id)) return undefined;
  if (!agentIdPattern.test(row.agent_id)) return undefined;
  if (row.lane_id && !slugPattern.test(row.lane_id)) return undefined;
  if (
    !slugPattern.test(row.provider) ||
    !slugPattern.test(row.model) ||
    !slugPattern.test(row.operation)
  ) {
    return undefined;
  }
  if (!cacheStatuses.has(row.cache_status as WorkforceCacheStatus)) return undefined;
  if (row.currency && !currencyPattern.test(row.currency)) return undefined;
  if (Number.isNaN(Date.parse(row.measured_at)) || Number.isNaN(Date.parse(row.created_at))) {
    return undefined;
  }
  const metadata = parseMetadata(row.metadata);
  if (!metadata) return undefined;

  const departmentId = row.department_id ? sanitizeDepartmentId(row.department_id) : undefined;

  const entry: WorkforceCostCacheLedgerEntry = {
    entryId: row.entry_id,
    agentId: row.agent_id,
    ...(row.lane_id ? { laneId: row.lane_id as LaneId } : {}),
    ...(departmentId ? { departmentId } : {}),
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    ...(row.currency ? { currency: row.currency } : {}),
    cacheStatus: row.cache_status as WorkforceCacheStatus,
    metadata,
    measuredAt: row.measured_at,
    createdAt: row.created_at,
  };
  const promptCacheHitTokens = parseOptionalInteger(row.prompt_cache_hit_tokens);
  const promptCacheMissTokens = parseOptionalInteger(row.prompt_cache_miss_tokens);
  const inputTokens = parseOptionalInteger(row.input_tokens);
  const outputTokens = parseOptionalInteger(row.output_tokens);
  const estimatedCostMicros = parseOptionalInteger(row.estimated_cost_micros);
  if (promptCacheHitTokens !== undefined) entry.promptCacheHitTokens = promptCacheHitTokens;
  if (promptCacheMissTokens !== undefined) entry.promptCacheMissTokens = promptCacheMissTokens;
  if (inputTokens !== undefined) entry.inputTokens = inputTokens;
  if (outputTokens !== undefined) entry.outputTokens = outputTokens;
  if (estimatedCostMicros !== undefined) entry.estimatedCostMicros = estimatedCostMicros;

  return Object.freeze(entry);
}

export function createWorkforceCostCacheLedgerStore(
  db: Database.Database,
  options: WorkforceCostCacheLedgerStoreOptions = {},
): WorkforceCostCacheLedgerStore {
  db.exec(SCHEMA_SQL);

  // A.1: Safe migration — add department_id if it does not exist yet
  try {
    db.exec(MIGRATE_DEPARTMENT_ID_SQL);
  } catch {
    // Column already exists — safe to ignore
  }

  // A.2: Safe migration — add session attribution columns via columnExists
  const columns = db.pragma("table_info(workforce_cost_cache_ledger_entries)") as {
    name: string;
  }[];
  const existingColumns = new Set(columns.map((c) => c.name));

  for (const migration of MIGRATE_SESSION_COLS_SQL) {
    // Extract column name from ALTER TABLE ... ADD COLUMN <name> ...
    const colMatch = migration.match(/ADD COLUMN (\w+)/);
    if (colMatch && colMatch[1] && !existingColumns.has(colMatch[1])) {
      try {
        db.exec(migration);
      } catch {
        // Defensive — ignore migration errors
      }
    }
  }

  const requestedMaxEntries = options.maxEntries ?? LEDGER_LIMITS.defaultMaxEntries;
  const maxEntries = Number.isFinite(requestedMaxEntries)
    ? Math.max(1, Math.floor(requestedMaxEntries))
    : LEDGER_LIMITS.defaultMaxEntries;

  const insertStmt = db.prepare(`
    INSERT INTO workforce_cost_cache_ledger_entries (
      entry_id,
      agent_id,
      lane_id,
      department_id,
      provider,
      model,
      operation,
      prompt_cache_hit_tokens,
      prompt_cache_miss_tokens,
      input_tokens,
      output_tokens,
      estimated_cost_micros,
      currency,
      cache_status,
      metadata,
      measured_at,
      seller_id,
      session_id,
      stable_prompt_hash,
      evidence_hash
    ) VALUES (
      @entryId,
      @agentId,
      @laneId,
      @departmentId,
      @provider,
      @model,
      @operation,
      @promptCacheHitTokens,
      @promptCacheMissTokens,
      @inputTokens,
      @outputTokens,
      @estimatedCostMicros,
      @currency,
      @cacheStatus,
      @metadata,
      @measuredAt,
      @sellerId,
      @sessionId,
      @stablePromptHash,
      @evidenceHash
    )
  `);
  const getStmt = db.prepare(`
    SELECT * FROM workforce_cost_cache_ledger_entries WHERE entry_id = ?
  `);
  const listStmt = db.prepare(`
    SELECT * FROM workforce_cost_cache_ledger_entries
    WHERE (@agentId IS NULL OR agent_id = @agentId)
      AND (@laneId IS NULL OR lane_id = @laneId)
      AND (@from IS NULL OR measured_at >= @from)
      AND (@to IS NULL OR measured_at <= @to)
    ORDER BY measured_at DESC, created_at DESC, entry_id ASC
    LIMIT @limit
  `);
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM workforce_cost_cache_ledger_entries`);
  const pruneStmt = db.prepare(`
    DELETE FROM workforce_cost_cache_ledger_entries
    WHERE entry_id IN (
      SELECT entry_id FROM workforce_cost_cache_ledger_entries
      ORDER BY measured_at ASC, created_at ASC, entry_id DESC
      LIMIT MAX((SELECT COUNT(*) FROM workforce_cost_cache_ledger_entries) - @maxEntries, 0)
    )
  `);

  // A.3: Rollup upsert prepared statement
  const upsertRollupStmt = db.prepare(`
    INSERT INTO workforce_cost_cache_ledger_rollups
      (day, agent_id, department_id, model, input_tokens_agg, output_tokens_agg,
       cache_hit_tokens_agg, cache_miss_tokens_agg, estimated_cost_micros_agg, entry_count)
    VALUES (@day, @agentId, @departmentId, @model, @inputTokens, @outputTokens,
            @cacheHitTokens, @cacheMissTokens, @costMicros, 1)
    ON CONFLICT(day, agent_id, model) DO UPDATE SET
      input_tokens_agg = input_tokens_agg + @inputTokens,
      output_tokens_agg = output_tokens_agg + @outputTokens,
      cache_hit_tokens_agg = cache_hit_tokens_agg + @cacheHitTokens,
      cache_miss_tokens_agg = cache_miss_tokens_agg + @cacheMissTokens,
      estimated_cost_micros_agg = estimated_cost_micros_agg + @costMicros,
      entry_count = entry_count + 1,
      department_id = COALESCE(@departmentId, department_id)
  `);

  // A.6: Read rollups for aggregateCosts
  const readRollupsStmt = db.prepare(`
    SELECT * FROM workforce_cost_cache_ledger_rollups
    WHERE (@fromDay IS NULL OR day >= @fromDay)
    ORDER BY day DESC, agent_id ASC, model ASC
  `);

  const insertEntry = (
    input: RecordWorkforceCostCacheLedgerEntryInput,
  ): WorkforceCostCacheLedgerEntry => {
    const { metadata, measuredAt } = assertSafeInput(input);
    const departmentId = sanitizeDepartmentId(input.departmentId);
    insertStmt.run({
      entryId: input.entryId,
      agentId: input.agentId,
      laneId: input.laneId ?? null,
      departmentId: departmentId ?? null,
      provider: input.provider,
      model: input.model,
      operation: input.operation,
      promptCacheHitTokens: input.promptCacheHitTokens ?? null,
      promptCacheMissTokens: input.promptCacheMissTokens ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      estimatedCostMicros: input.estimatedCostMicros ?? null,
      currency: input.currency ?? null,
      cacheStatus: input.cacheStatus ?? "unknown",
      metadata: JSON.stringify(metadata),
      measuredAt,
      sellerId: input.sellerId ?? null,
      sessionId: input.sessionId ?? null,
      stablePromptHash: input.stablePromptHash ?? null,
      evidenceHash: input.evidenceHash ?? null,
    });
    const row = getStmt.get(input.entryId) as WorkforceCostCacheLedgerRow | undefined;
    const entry = row ? rowToEntry(row) : undefined;
    if (!entry) throw new Error("ledger entry could not be read safely after insert");

    // A.3: Upsert rollup after raw insert
    const day = extractDay(measuredAt);
    upsertRollupStmt.run({
      day,
      agentId: input.agentId,
      departmentId: departmentId ?? null,
      model: input.model,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      cacheHitTokens: input.promptCacheHitTokens ?? 0,
      cacheMissTokens: input.promptCacheMissTokens ?? 0,
      costMicros: input.estimatedCostMicros ?? 0,
    });

    pruneStmt.run({ maxEntries });
    return entry;
  };

  const listEntries = (
    filter: ListWorkforceCostCacheLedgerEntriesFilter = {},
  ): readonly WorkforceCostCacheLedgerEntry[] => {
    const rows = listStmt.all({
      agentId: filter.agentId ?? null,
      laneId: filter.laneId ?? null,
      from: filter.from ?? null,
      to: filter.to ?? null,
      limit: Math.max(
        LEDGER_LIMITS.minListLimit,
        Math.min(filter.limit ?? LEDGER_LIMITS.defaultListLimit, LEDGER_LIMITS.maxListLimit),
      ),
    }) as WorkforceCostCacheLedgerRow[];
    return rows.flatMap((row) => {
      const entry = rowToEntry(row);
      return entry ? [entry] : [];
    });
  };

  const count = (): number => {
    const row = countStmt.get() as { count: number };
    return row.count;
  };

  const aggregateCosts = (filter: { days?: number } = {}): WorkforceCostAggregate => {
    const days = filter.days ?? 7;
    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - days + 1);
    const fromDay = fromDate.toISOString().slice(0, 10);

    const rows = readRollupsStmt.all({
      fromDay,
    }) as RollupRow[];

    const byAgent = new Map<
      string,
      { inputTokens: number; outputTokens: number; costMicros: number; entries: number }
    >();
    const byDepartment = new Map<
      string,
      { inputTokens: number; outputTokens: number; costMicros: number }
    >();
    const byPeriodMap = new Map<string, { inputTokens: number; outputTokens: number }>();
    let totalCacheHitTokens = 0;
    let totalCacheMissTokens = 0;

    for (const row of rows) {
      // byAgent
      const agentKey = row.agent_id;
      const agentAcc = byAgent.get(agentKey) ?? {
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
        entries: 0,
      };
      agentAcc.inputTokens += row.input_tokens_agg;
      agentAcc.outputTokens += row.output_tokens_agg;
      agentAcc.costMicros += row.estimated_cost_micros_agg;
      agentAcc.entries += row.entry_count;
      byAgent.set(agentKey, agentAcc);

      // byDepartment
      const deptKey = row.department_id ?? "unassigned";
      const deptAcc = byDepartment.get(deptKey) ?? {
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
      };
      deptAcc.inputTokens += row.input_tokens_agg;
      deptAcc.outputTokens += row.output_tokens_agg;
      deptAcc.costMicros += row.estimated_cost_micros_agg;
      byDepartment.set(deptKey, deptAcc);

      // byPeriod
      const dayKey = row.day;
      const periodAcc = byPeriodMap.get(dayKey) ?? { inputTokens: 0, outputTokens: 0 };
      periodAcc.inputTokens += row.input_tokens_agg;
      periodAcc.outputTokens += row.output_tokens_agg;
      byPeriodMap.set(dayKey, periodAcc);

      // cache efficiency accumulators
      totalCacheHitTokens += row.cache_hit_tokens_agg;
      totalCacheMissTokens += row.cache_miss_tokens_agg;
    }

    // Build sorted byPeriod array
    const byPeriod = Array.from(byPeriodMap.entries())
      .map(([day, counts]) => ({
        day,
        inputTokens: counts.inputTokens,
        outputTokens: counts.outputTokens,
      }))
      .sort((a, b) => a.day.localeCompare(b.day));

    const cacheTotal = totalCacheHitTokens + totalCacheMissTokens;
    const cacheEfficiency = cacheTotal > 0 ? totalCacheHitTokens / cacheTotal : 0;

    return { byAgent, byDepartment, byPeriod, cacheEfficiency };
  };

  // ── New: session-aware aggregates ──────────────────────────────

  const aggregateCostByAgentAndSellerStmt = db.prepare(`
    SELECT agent_id,
           COALESCE(SUM(input_tokens), 0) as total_input,
           COALESCE(SUM(output_tokens), 0) as total_output,
           COALESCE(SUM(estimated_cost_micros), 0) as total_cost,
           COUNT(*) as entry_count
    FROM workforce_cost_cache_ledger_entries
    WHERE seller_id = ?
    GROUP BY agent_id
    ORDER BY total_cost DESC
  `);

  const aggregateCacheEfficiencyBySellerStmt = db.prepare(`
    SELECT COALESCE(SUM(prompt_cache_hit_tokens), 0) as total_hit,
           COALESCE(SUM(prompt_cache_miss_tokens), 0) as total_miss
    FROM workforce_cost_cache_ledger_entries
    WHERE seller_id = ?
  `);

  const recordAgentSessionUsage = (
    input: RecordWorkforceCostCacheLedgerEntryInput,
  ): WorkforceCostCacheLedgerEntry => {
    return insertEntry(input);
  };

  const aggregateCostByAgentAndSeller = (
    sellerId: string,
  ): Map<
    string,
    { inputTokens: number; outputTokens: number; costMicros: number; entries: number }
  > => {
    const rows = aggregateCostByAgentAndSellerStmt.all(sellerId) as Array<{
      agent_id: string;
      total_input: number;
      total_output: number;
      total_cost: number;
      entry_count: number;
    }>;

    const result = new Map<
      string,
      { inputTokens: number; outputTokens: number; costMicros: number; entries: number }
    >();
    for (const row of rows) {
      result.set(row.agent_id, {
        inputTokens: row.total_input,
        outputTokens: row.total_output,
        costMicros: row.total_cost,
        entries: row.entry_count,
      });
    }
    return result;
  };

  const aggregateCacheEfficiencyBySeller = (sellerId: string): number => {
    const row = aggregateCacheEfficiencyBySellerStmt.get(sellerId) as
      | {
          total_hit: number;
          total_miss: number;
        }
      | undefined;
    if (!row) return 0;
    const total = row.total_hit + row.total_miss;
    return total > 0 ? row.total_hit / total : 0;
  };

  return {
    insertEntry,
    listEntries,
    count,
    aggregateCosts,
    recordAgentSessionUsage,
    aggregateCostByAgentAndSeller,
    aggregateCacheEfficiencyBySeller,
  };
}
