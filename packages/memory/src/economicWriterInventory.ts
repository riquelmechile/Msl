/**
 * Executable R5 inventory.  Keep this list in lockstep with every mutation of
 * an economic or operational table; the architecture test fails on omissions.
 */
export const ECONOMIC_SQLITE_WRITERS = [
  ["outcome", "economicOutcomeStore.ts", "economic_outcomes", true, true, true, true],
  ["component", "economicOutcomeStore.ts", "economic_cost_components", true, true, true, true],
  ["snapshot", "economicOutcomeStore.ts", "unit_economics_snapshots", true, true, true, true],
  ["evidence", "economicEvidenceStore.ts", "economic_evidence_references", true, true, true, true],
  ["run", "economicIngestionRunStore.ts", "economic_ingestion_runs", true, true, true, true],
  [
    "checkpoint",
    "economicIngestionRunStore.ts",
    "economic_ingestion_checkpoints|economic_source_checkpoints",
    true,
    true,
    true,
    true,
  ],
  [
    "backlog",
    "economicIngestionRunStore.ts",
    "economic_source_retry_backlog",
    true,
    true,
    true,
    true,
  ],
  [
    "source-health",
    "economicIngestionRunStore.ts",
    "economic_source_health",
    true,
    true,
    true,
    true,
  ],
  [
    "alert-intent",
    "economicIngestionRunStore.ts",
    "economic_operational_alert_intents",
    true,
    true,
    true,
    true,
  ],
] as const;

export type EconomicSqliteWriter = (typeof ECONOMIC_SQLITE_WRITERS)[number];
