import Database from "better-sqlite3";

import type { LaneId } from "./lanes.js";

export type WorkforceCacheStatus = "hit" | "miss" | "partial" | "unknown";

export type WorkforceCostCacheLedgerEntry = {
  entryId: string;
  agentId: string;
  laneId?: LaneId;
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
};

export type ListWorkforceCostCacheLedgerEntriesFilter = {
  agentId?: string;
  laneId?: LaneId;
  limit?: number;
};

export type WorkforceCostCacheLedgerStore = {
  insertEntry(input: RecordWorkforceCostCacheLedgerEntryInput): WorkforceCostCacheLedgerEntry;
  listEntries(
    filter?: ListWorkforceCostCacheLedgerEntriesFilter,
  ): readonly WorkforceCostCacheLedgerEntry[];
  count(): number;
};

export type WorkforceCostCacheLedgerStoreOptions = {
  maxEntries?: number;
};

export const LEDGER_LIMITS = Object.freeze({
  minListLimit: 1,
  defaultListLimit: 20,
  maxListLimit: 50,
  defaultMaxEntries: 1_000,
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
`;

type WorkforceCostCacheLedgerRow = {
  entry_id: string;
  agent_id: string;
  lane_id: string | null;
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
};

const cacheStatuses = new Set<WorkforceCacheStatus>(["hit", "miss", "partial", "unknown"]);
const entryIdPattern = new RegExp(`^[a-z][a-z0-9:_-]{2,${LEDGER_LIMITS.maxEntryIdLength - 1}}$`);
const agentIdPattern = new RegExp(`^[a-z][a-z0-9:_-]{1,${LEDGER_LIMITS.maxAgentIdLength - 1}}$`);
const slugPattern = new RegExp(`^[a-z][a-z0-9._:-]{0,${LEDGER_LIMITS.maxSlugLength - 1}}$`);
const currencyPattern = /^[A-Z]{3}$/;
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

  const entry: WorkforceCostCacheLedgerEntry = {
    entryId: row.entry_id,
    agentId: row.agent_id,
    ...(row.lane_id ? { laneId: row.lane_id as LaneId } : {}),
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
  const requestedMaxEntries = options.maxEntries ?? LEDGER_LIMITS.defaultMaxEntries;
  const maxEntries = Number.isFinite(requestedMaxEntries)
    ? Math.max(1, Math.floor(requestedMaxEntries))
    : LEDGER_LIMITS.defaultMaxEntries;

  const insertStmt = db.prepare(`
    INSERT INTO workforce_cost_cache_ledger_entries (
      entry_id,
      agent_id,
      lane_id,
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
      measured_at
    ) VALUES (
      @entryId,
      @agentId,
      @laneId,
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
      @measuredAt
    )
  `);
  const getStmt = db.prepare(`
    SELECT * FROM workforce_cost_cache_ledger_entries WHERE entry_id = ?
  `);
  const listStmt = db.prepare(`
    SELECT * FROM workforce_cost_cache_ledger_entries
    WHERE (@agentId IS NULL OR agent_id = @agentId)
      AND (@laneId IS NULL OR lane_id = @laneId)
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

  const insertEntry = (
    input: RecordWorkforceCostCacheLedgerEntryInput,
  ): WorkforceCostCacheLedgerEntry => {
    const { metadata, measuredAt } = assertSafeInput(input);
    insertStmt.run({
      entryId: input.entryId,
      agentId: input.agentId,
      laneId: input.laneId ?? null,
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
    });
    const row = getStmt.get(input.entryId) as WorkforceCostCacheLedgerRow | undefined;
    const entry = row ? rowToEntry(row) : undefined;
    if (!entry) throw new Error("ledger entry could not be read safely after insert");
    pruneStmt.run({ maxEntries });
    return entry;
  };

  const listEntries = (
    filter: ListWorkforceCostCacheLedgerEntriesFilter = {},
  ): readonly WorkforceCostCacheLedgerEntry[] => {
    const rows = listStmt.all({
      agentId: filter.agentId ?? null,
      laneId: filter.laneId ?? null,
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

  return { insertEntry, listEntries, count };
}
