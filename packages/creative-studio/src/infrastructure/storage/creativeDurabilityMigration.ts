import Database from "better-sqlite3";

export const CREATIVE_DURABILITY_SCHEMA_VERSION = 4;

const TABLES = {
  creative_budget_reservations: `CREATE TABLE IF NOT EXISTS creative_budget_reservations(reservation_id TEXT PRIMARY KEY,seller_id TEXT NOT NULL,job_id TEXT NOT NULL,attempt_id TEXT NOT NULL,currency TEXT NOT NULL,utc_day TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'held',reserved_micros INTEGER NOT NULL,committed_micros INTEGER,expires_at INTEGER NOT NULL,terminal_evidence_ref TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,CHECK(currency=upper(currency) AND length(currency)=3),CHECK(status IN('held','committed','released','expired')),CHECK(reserved_micros>0),CHECK(committed_micros IS NULL OR committed_micros BETWEEN 0 AND reserved_micros),CHECK((status='committed')=(committed_micros IS NOT NULL)),CHECK(status IN('held','expired') OR terminal_evidence_ref IS NOT NULL),UNIQUE(reservation_id,seller_id,job_id,attempt_id),UNIQUE(seller_id,job_id,attempt_id))`,
  creative_generation_attempts: `CREATE TABLE IF NOT EXISTS creative_generation_attempts(attempt_id TEXT PRIMARY KEY,seller_id TEXT NOT NULL,job_id TEXT NOT NULL,reservation_id TEXT NOT NULL,message_id TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'prepared',estimated_cost_micros INTEGER NOT NULL,actual_cost_micros INTEGER,task_id TEXT,provider_request_id TEXT,request_evidence_json TEXT NOT NULL,submission_evidence_json TEXT,result_evidence_json TEXT,error_evidence_json TEXT,no_submission_proof_json TEXT,lease_owner_id TEXT,lease_token_digest TEXT,lease_generation INTEGER NOT NULL DEFAULT 0,lease_expires_at INTEGER,dispatching_at INTEGER,submitted_at INTEGER,terminal_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,CHECK(state IN('prepared','dispatching','submitted','completed','failed','ambiguous')),CHECK(length(request_hash)=64),CHECK(estimated_cost_micros>0),CHECK(actual_cost_micros IS NULL OR actual_cost_micros>=0),CHECK((lease_owner_id IS NULL AND lease_token_digest IS NULL AND lease_expires_at IS NULL AND lease_generation=0) OR (lease_owner_id IS NOT NULL AND lease_token_digest IS NOT NULL AND length(lease_token_digest)=64 AND lease_expires_at IS NOT NULL AND lease_generation>0)),CHECK(state='prepared' OR dispatching_at IS NOT NULL),CHECK(state!='submitted' OR (task_id IS NOT NULL AND submitted_at IS NOT NULL)),CHECK(state!='completed' OR (actual_cost_micros IS NOT NULL AND result_evidence_json IS NOT NULL)),CHECK(state!='failed' OR (error_evidence_json IS NOT NULL AND no_submission_proof_json IS NOT NULL)),CHECK((state IN('completed','failed'))=(terminal_at IS NOT NULL)),FOREIGN KEY(reservation_id,seller_id,job_id,attempt_id) REFERENCES creative_budget_reservations(reservation_id,seller_id,job_id,attempt_id))`,
} as const;

const INDEXES = {
  cbr_daily: `CREATE INDEX IF NOT EXISTS cbr_daily ON creative_budget_reservations(seller_id,currency,utc_day,status,expires_at)`,
  cbr_job: `CREATE INDEX IF NOT EXISTS cbr_job ON creative_budget_reservations(seller_id,job_id,currency,status,expires_at)`,
  cga_recovery: `CREATE INDEX IF NOT EXISTS cga_recovery ON creative_generation_attempts(state,lease_expires_at,updated_at)`,
  cga_provider_task: `CREATE UNIQUE INDEX IF NOT EXISTS cga_provider_task ON creative_generation_attempts(provider,task_id) WHERE task_id IS NOT NULL`,
  cga_provider_key: `CREATE UNIQUE INDEX IF NOT EXISTS cga_provider_key ON creative_generation_attempts(provider,idempotency_key)`,
  cga_message: `CREATE INDEX IF NOT EXISTS cga_message ON creative_generation_attempts(message_id)`,
} as const;

export const CREATIVE_DURABILITY_V4_DDL = [
  ...Object.values(TABLES),
  ...Object.values(INDEXES),
].join(";\n");

function normalizeSql(sql: string): string {
  return sql
    .replace(/\bIF NOT EXISTS\b/gi, "")
    .replace(/\s+/g, "")
    .replace(/;$/, "")
    .toLowerCase();
}

function schemaFingerprint(db: Database.Database): string {
  const names = [...Object.keys(TABLES), ...Object.keys(INDEXES)];
  const master = db
    .prepare(
      `SELECT name, type, sql FROM sqlite_master WHERE name IN (${names.map(() => "?").join(",")}) ORDER BY name`,
    )
    .all(...names) as Array<{ name: string; type: string; sql: string }>;
  if (master.length !== names.length) return "missing";
  const pragmas = Object.keys(TABLES).map((table) => ({
    table,
    columns: db.pragma(`table_xinfo(${table})`),
    foreignKeys: db.pragma(`foreign_key_list(${table})`),
    indexes: db.pragma(`index_list(${table})`),
  }));
  const indexColumns = Object.keys(INDEXES).map((index) => ({
    index,
    columns: db.pragma(`index_xinfo(${index})`),
  }));
  return JSON.stringify({
    master: master.map((row) => ({ ...row, sql: normalizeSql(row.sql) })),
    pragmas,
    indexColumns,
  });
}

export function applyCreativeDurabilityMigration(db: Database.Database): void {
  db.exec(CREATIVE_DURABILITY_V4_DDL);
}

export function isCreativeDurabilityMigrationApplied(db: Database.Database): boolean {
  const expected = new Database(":memory:");
  try {
    expected.pragma("foreign_keys = ON");
    applyCreativeDurabilityMigration(expected);
    return (
      schemaFingerprint(db) === schemaFingerprint(expected) &&
      (db.pragma("foreign_key_check") as unknown[]).length === 0
    );
  } finally {
    expected.close();
  }
}

export const creativeDurabilityMigration = {
  version: CREATIVE_DURABILITY_SCHEMA_VERSION,
  name: "creative_durability_v4",
  up: applyCreativeDurabilityMigration,
  isApplied: isCreativeDurabilityMigrationApplied,
} as const;
