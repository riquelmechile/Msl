import type {
  CostComponentType,
  CostDataSource,
  CostVerification,
  EconomicCostComponent,
  EconomicOutcome,
  EconomicOutcomeStatus,
  UnitEconomicsSnapshot,
} from "@msl/domain";
import { transitionOutcome } from "@msl/domain";
import type { Currency } from "@msl/domain";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

// ── Row types ──────────────────────────────────────────────────────────────

type OutcomeRow = {
  outcome_id: string;
  seller_id: string;
  account_id: string | null;
  channel: string | null;
  proposal_id: string | null;
  prepared_action_id: string | null;
  execution_id: string | null;
  correlation_id: string | null;
  work_session_id: string | null;
  originating_agent_id: string | null;
  order_id: string | null;
  item_id: string | null;
  sku: string | null;
  expected_economic_impact: string | null;
  observed_economic_impact_id: string | null;
  observation_window_start: number | null;
  observation_window_end: number | null;
  baseline_reference: string | null;
  status: string;
  confidence: number;
  completeness: number;
  evidence_ids_json: string;
  created_at: number;
  observed_at: number | null;
  verified_at: number | null;
  disputed_at: number | null;
  invalidated_at: number | null;
  verification_reason: string | null;
  no_mutation_executed: number;
};

type UnitEconomicsRow = {
  snapshot_id: string;
  seller_id: string;
  account_id: string | null;
  channel: string | null;
  order_id: string | null;
  item_id: string | null;
  sku: string | null;
  product: string | null;
  period: string | null;
  currency: string;
  snapshot_json: string;
  calculated_at: number;
  ingestion_run_id: string | null;
  source_version: string | null;
  economic_meaning: string | null;
  economic_algorithm_version: string | null;
  economic_checksum: string | null;
};

type CostComponentRow = {
  id: string;
  seller_id: string;
  type: string;
  amount_minor: number;
  currency: string;
  source: string;
  source_record_id: string | null;
  economic_meaning: string | null;
  source_version: string | null;
  occurred_at: number;
  observed_at: number;
  verification: string;
  confidence: number;
  metadata_json: string | null;
  superseded_at: number | null;
  reversed_at: number | null;
  reversed_reason: string | null;
  ingestion_run_id: string | null;
};

// ── Public types ───────────────────────────────────────────────────────────

export type ProfitSummary = {
  sellerId: string;
  currency: Currency;
  totalRevenue: number;
  totalCosts: number;
  netProfit: number;
  netMargin: number;
  snapshotCount: number;
  periodStart?: number;
  periodEnd?: number;
};

export type CostComponentInsertInput = {
  /** Optional domain UUID; absent only for legacy callers. */
  id?: string;
  sellerId: string;
  type: CostComponentType;
  amount: { amountMinor: number; currency: Currency };
  source: CostDataSource;
  sourceRecordId?: string;
  economicMeaning?: string;
  sourceVersion?: string;
  ingestionRunId?: string;
  occurredAt: number;
  observedAt: number;
  verification: CostVerification;
  confidence: number;
  metadata?: Readonly<Record<string, unknown>>;
};

export type ListCostComponentsOptions = {
  type?: CostComponentType;
  includeReversed?: boolean;
  limit?: number;
  offset?: number;
};

export type EconomicOutcomeStore = {
  // ── Transaction ─────────────────────────────────────────────────────
  /** Wrap multiple writes in a single atomic transaction.
   *  Since the outcome store and the run store share the same Database
   *  instance, writes to both stores are rolled back together on failure. */
  transaction<T>(fn: () => T): T;

  /** Return the shared Database handle for use with sync update helpers. */
  getDb(): Database.Database;

  // ── Outcome methods ─────────────────────────────────────────────────
  insertOutcome(outcome: EconomicOutcome): EconomicOutcome;
  updateOutcomeStatus(outcomeId: string, newStatus: EconomicOutcomeStatus): EconomicOutcome;
  verifyOutcome(outcomeId: string, reason: string): EconomicOutcome;
  disputeOutcome(outcomeId: string, reason: string): EconomicOutcome;
  getOutcome(outcomeId: string, sellerId: string): EconomicOutcome | null;
  listOutcomesBySeller(sellerId: string, opts?: { limit?: number }): EconomicOutcome[];
  listOutcomesByProposal(proposalId: string, sellerId: string): EconomicOutcome[];
  listOutcomesByOrder(orderId: string, sellerId: string): EconomicOutcome[];
  listOutcomesByCorrelationId(correlationId: string, sellerId: string): EconomicOutcome[];
  listMissingInputs(
    sellerId: string,
  ): Array<{ outcomeId: string; missingTypes: CostComponentType[] }>;
  insertUnitEconomicsSnapshot(snapshot: UnitEconomicsSnapshot): UnitEconomicsSnapshot;
  listSnapshotsByRun(sellerId: string, ingestionRunId: string): UnitEconomicsSnapshot[];
  countSnapshotsByRun(sellerId: string, ingestionRunId: string): number;
  listUnitEconomicsSnapshots(
    sellerId: string,
    opts?: { snapshotId?: string; orderId?: string; itemId?: string; sku?: string; limit?: number },
  ): UnitEconomicsSnapshot[];
  summarizeProfit(
    sellerId: string,
    currency: Currency,
    opts?: { startDate?: number; endDate?: number },
  ): ProfitSummary;

  // ── Cost component methods ──────────────────────────────────────────
  insertCostComponent(input: CostComponentInsertInput): EconomicCostComponent;
  upsertCostComponent(input: CostComponentInsertInput): EconomicCostComponent;
  listComponentsByRun(sellerId: string, ingestionRunId: string): EconomicCostComponent[];
  countComponentsByRun(sellerId: string, ingestionRunId: string): number;
  countSellerAggregates(sellerId: string): { components: number; snapshots: number };
  countSellerReconciliationAggregates?(sellerId: string): {
    partialSnapshots: number;
    disputedSnapshots: number;
  };
  listCostComponents(sellerId: string, opts?: ListCostComponentsOptions): EconomicCostComponent[];
  listBySourceRecord(sellerId: string, sourceRecordId: string): EconomicCostComponent[];
  reverseCostComponent(id: string, reason: string): EconomicCostComponent | null;
};

/** Read-only public projection; writers are internal admission-only capabilities. */
export type EconomicOutcomeReader = Pick<
  EconomicOutcomeStore,
  | "getOutcome"
  | "listOutcomesBySeller"
  | "listOutcomesByProposal"
  | "listOutcomesByOrder"
  | "listOutcomesByCorrelationId"
  | "listMissingInputs"
  | "listSnapshotsByRun"
  | "countSnapshotsByRun"
  | "listUnitEconomicsSnapshots"
  | "summarizeProfit"
  | "listComponentsByRun"
  | "countComponentsByRun"
  | "countSellerAggregates"
  | "countSellerReconciliationAggregates"
  | "listCostComponents"
  | "listBySourceRecord"
>;

// ── Helpers ────────────────────────────────────────────────────────────────

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is string => typeof v === "string");
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

function outcomeFromRow(row: OutcomeRow): EconomicOutcome {
  return {
    outcomeId: row.outcome_id,
    sellerId: row.seller_id,
    ...(row.account_id === null ? {} : { accountId: row.account_id }),
    ...(row.channel === null ? {} : { channel: row.channel }),
    ...(row.proposal_id === null ? {} : { proposalId: row.proposal_id }),
    ...(row.prepared_action_id === null ? {} : { preparedActionId: row.prepared_action_id }),
    ...(row.execution_id === null ? {} : { executionId: row.execution_id }),
    ...(row.correlation_id === null ? {} : { correlationId: row.correlation_id }),
    ...(row.work_session_id === null ? {} : { workSessionId: row.work_session_id }),
    ...(row.originating_agent_id === null ? {} : { originatingAgentId: row.originating_agent_id }),
    ...(row.order_id === null ? {} : { orderId: row.order_id }),
    ...(row.item_id === null ? {} : { itemId: row.item_id }),
    ...(row.sku === null ? {} : { sku: row.sku }),
    ...(row.expected_economic_impact === null
      ? {}
      : { expectedEconomicImpact: row.expected_economic_impact }),
    ...(row.observed_economic_impact_id === null
      ? {}
      : { observedEconomicImpactId: row.observed_economic_impact_id }),
    ...(row.observation_window_start === null || row.observation_window_end === null
      ? {}
      : {
          observationWindow: {
            start: row.observation_window_start,
            end: row.observation_window_end,
          },
        }),
    ...(row.baseline_reference === null ? {} : { baselineReference: row.baseline_reference }),
    status: row.status as EconomicOutcomeStatus,
    confidence: row.confidence,
    completeness: row.completeness,
    evidenceIds: parseJsonArray(row.evidence_ids_json),
    createdAt: row.created_at,
    ...(row.observed_at === null ? {} : { observedAt: row.observed_at }),
    ...(row.verified_at === null ? {} : { verifiedAt: row.verified_at }),
    ...(row.disputed_at === null ? {} : { disputedAt: row.disputed_at }),
    ...(row.invalidated_at === null ? {} : { invalidatedAt: row.invalidated_at }),
    ...(row.verification_reason === null ? {} : { verificationReason: row.verification_reason }),
  };
}

function snapshotFromRow(row: UnitEconomicsRow): UnitEconomicsSnapshot {
  const parsed = parseJsonObject(row.snapshot_json);
  return {
    ...parsed,
    snapshotId: row.snapshot_id,
    sellerId: row.seller_id,
    currency: row.currency as Currency,
    ...(row.ingestion_run_id === null ? {} : { ingestionRunId: row.ingestion_run_id }),
    ...(row.source_version === null ? {} : { sourceVersion: row.source_version }),
    ...(row.economic_algorithm_version === null
      ? {}
      : { economicAlgorithmVersion: row.economic_algorithm_version }),
    ...(row.economic_checksum === null ? {} : { economicChecksum: row.economic_checksum }),
    calculatedAt: row.calculated_at,
  } as unknown as UnitEconomicsSnapshot;
}

function costComponentFromRow(row: CostComponentRow): EconomicCostComponent {
  return {
    id: row.id,
    sellerId: row.seller_id,
    type: row.type as CostComponentType,
    amount: { amountMinor: row.amount_minor, currency: row.currency as Currency },
    currency: row.currency as Currency,
    source: row.source as CostDataSource,
    ...(row.ingestion_run_id === null ? {} : { ingestionRunId: row.ingestion_run_id }),
    ...(row.source_record_id ? { sourceRecordId: row.source_record_id } : {}),
    ...(row.source_version === null ? {} : { sourceVersion: row.source_version }),
    ...(row.economic_meaning === null ? {} : { economicMeaning: row.economic_meaning }),
    occurredAt: row.occurred_at,
    observedAt: row.observed_at,
    verification: row.verification as CostVerification,
    confidence: row.confidence,
    ...(row.metadata_json
      ? { metadata: JSON.parse(row.metadata_json) as Readonly<Record<string, unknown>> }
      : {}),
  };
}

// ── ID generation ──────────────────────────────────────────────────────────

function nextCostComponentId(): string {
  return `costcomp-db-${randomUUID()}`;
}

// ── Idempotency key ────────────────────────────────────────────────────────

function buildIdempotencyKey(input: CostComponentInsertInput): {
  sellerId: string;
  source: string;
  sourceRecordId: string;
  economicMeaning: string;
  sourceVersion: string;
} {
  return {
    sellerId: input.sellerId,
    source: input.source,
    sourceRecordId: input.sourceRecordId ?? "",
    economicMeaning: input.economicMeaning ?? "",
    sourceVersion: input.sourceVersion ?? "",
  };
}

// ── Migration ──────────────────────────────────────────────────────────────

export function migrateEconomicOutcomeStore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS economic_outcomes (
      outcome_id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      account_id TEXT,
      channel TEXT,
      proposal_id TEXT,
      prepared_action_id TEXT,
      execution_id TEXT,
      correlation_id TEXT,
      work_session_id TEXT,
      originating_agent_id TEXT,
      order_id TEXT,
      item_id TEXT,
      sku TEXT,
      expected_economic_impact TEXT,
      observed_economic_impact_id TEXT,
      observation_window_start INTEGER,
      observation_window_end INTEGER,
      baseline_reference TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      confidence REAL NOT NULL DEFAULT 0,
      completeness REAL NOT NULL DEFAULT 0,
      evidence_ids_json TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      observed_at INTEGER,
      verified_at INTEGER,
      disputed_at INTEGER,
      invalidated_at INTEGER,
      verification_reason TEXT,
      no_mutation_executed INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_economic_outcomes_seller ON economic_outcomes(seller_id);
    CREATE INDEX IF NOT EXISTS idx_economic_outcomes_proposal ON economic_outcomes(proposal_id);
    CREATE INDEX IF NOT EXISTS idx_economic_outcomes_order ON economic_outcomes(order_id);
    CREATE INDEX IF NOT EXISTS idx_economic_outcomes_correlation ON economic_outcomes(correlation_id);

    CREATE TABLE IF NOT EXISTS economic_cost_components (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      source TEXT NOT NULL,
      source_record_id TEXT,
      occurred_at INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      verification TEXT NOT NULL DEFAULT 'unverified',
      confidence REAL NOT NULL DEFAULT 0,
       metadata_json TEXT DEFAULT '{}'
       ,identity_enforced INTEGER NOT NULL DEFAULT 1,
       ingestion_run_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_economic_cost_components_seller ON economic_cost_components(seller_id);

    CREATE TABLE IF NOT EXISTS unit_economics_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      account_id TEXT,
      channel TEXT,
      order_id TEXT,
      item_id TEXT,
      sku TEXT,
      product TEXT,
      period TEXT,
       currency TEXT NOT NULL,
       snapshot_json TEXT NOT NULL,
       calculated_at INTEGER NOT NULL,
       ingestion_run_id TEXT,
       source_version TEXT,
       economic_algorithm_version TEXT,
       economic_checksum TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_unit_economics_seller ON unit_economics_snapshots(seller_id);
    CREATE INDEX IF NOT EXISTS idx_unit_economics_order ON unit_economics_snapshots(order_id);
  `);

  // ── Add new columns to economic_cost_components (idempotent via try/catch) ─

  const newColumns = [
    { name: "source_version", type: "TEXT" },
    { name: "economic_meaning", type: "TEXT" },
    { name: "superseded_at", type: "INTEGER" },
    { name: "reversed_at", type: "INTEGER" },
    { name: "reversed_reason", type: "TEXT" },
    { name: "identity_enforced", type: "INTEGER NOT NULL DEFAULT 1" },
  ];

  for (const col of newColumns) {
    try {
      db.exec(`ALTER TABLE economic_cost_components ADD COLUMN ${col.name} ${col.type}`);
    } catch {
      // Column already exists from a prior migration — ignore.
    }
  }

  // ── Composite unique index for idempotency ───────────────────────────────
  db.exec(`
    DROP INDEX IF EXISTS idx_cost_component_idempotency;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_component_idempotency
      ON economic_cost_components(seller_id, source, source_record_id, economic_meaning, source_version, currency, amount_minor)
      WHERE reversed_at IS NULL AND superseded_at IS NULL;
  `);
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createSqliteEconomicOutcomeStore(
  db: Database.Database,
  options: { readonly skipMigration?: boolean } = {},
): EconomicOutcomeStore {
  if (!options.skipMigration && process.env.MSL_MIGRATION_ENABLED !== "true") {
    migrateEconomicOutcomeStore(db);
  }

  // ── Prepared statements ───────────────────────────────────────────────

  const insertOutcomeStmt = db.prepare(`
    INSERT OR REPLACE INTO economic_outcomes
      (outcome_id, seller_id, account_id, channel, proposal_id, prepared_action_id,
       execution_id, correlation_id, work_session_id, originating_agent_id,
       order_id, item_id, sku, expected_economic_impact, observed_economic_impact_id,
       observation_window_start, observation_window_end, baseline_reference,
       status, confidence, completeness, evidence_ids_json, created_at,
       observed_at, verified_at, disputed_at, invalidated_at,
       verification_reason, no_mutation_executed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateOutcomeStatusStmt = db.prepare(`
    UPDATE economic_outcomes
    SET status = ?,
        observed_at = ?,
        verified_at = ?,
        disputed_at = ?,
        invalidated_at = ?,
        verification_reason = ?
    WHERE outcome_id = ? AND seller_id = ?
  `);

  const getOutcomeStmt = db.prepare(
    "SELECT * FROM economic_outcomes WHERE outcome_id = ? AND seller_id = ?",
  );

  const getOutcomeByIdStmt = db.prepare("SELECT * FROM economic_outcomes WHERE outcome_id = ?");

  const listBySellerStmt = db.prepare(`
    SELECT * FROM economic_outcomes
    WHERE seller_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const listByProposalStmt = db.prepare(`
    SELECT * FROM economic_outcomes
    WHERE proposal_id = ? AND seller_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `);

  const listByOrderStmt = db.prepare(`
    SELECT * FROM economic_outcomes
    WHERE order_id = ? AND seller_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `);

  const listByCorrelationStmt = db.prepare(`
    SELECT * FROM economic_outcomes
    WHERE correlation_id = ? AND seller_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `);

  const listAllSnapshotsBySellerStmt = db.prepare(`
    SELECT * FROM unit_economics_snapshots
    WHERE seller_id = ?
    ORDER BY calculated_at DESC
  `);

  const profitSummaryStmt = db.prepare(`
    SELECT
      us.seller_id,
      us.currency,
      json_extract(us.snapshot_json, '$.grossRevenue') as gross_revenue,
      json_extract(us.snapshot_json, '$.netProfit') as net_profit,
      us.calculated_at
    FROM unit_economics_snapshots us
    WHERE us.seller_id = ? AND us.currency = ?
    ORDER BY us.calculated_at DESC
  `);

  const insertSnapshotStmt = db.prepare(`
    INSERT INTO unit_economics_snapshots
      (snapshot_id, seller_id, account_id, channel, order_id, item_id, sku,
       product, period, currency, snapshot_json, calculated_at, ingestion_run_id,
       source_version, economic_algorithm_version, economic_checksum)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `);

  const getSnapshotByIdStmt = db.prepare(
    "SELECT * FROM unit_economics_snapshots WHERE snapshot_id = ? AND seller_id = ?",
  );

  const listSnapshotsBySellerStmt = db.prepare(`
    SELECT * FROM unit_economics_snapshots
    WHERE seller_id = ?
    ORDER BY calculated_at DESC
    LIMIT ?
  `);

  const listSnapshotsBySellerAndOrderStmt = db.prepare(`
    SELECT * FROM unit_economics_snapshots
    WHERE seller_id = ? AND order_id = ?
    ORDER BY calculated_at DESC
    LIMIT ?
  `);

  const listSnapshotsBySellerAndItemStmt = db.prepare(`
    SELECT * FROM unit_economics_snapshots
    WHERE seller_id = ? AND item_id = ?
    ORDER BY calculated_at DESC
    LIMIT ?
  `);

  const listSnapshotsBySellerAndSkuStmt = db.prepare(`
    SELECT * FROM unit_economics_snapshots
    WHERE seller_id = ? AND sku = ?
    ORDER BY calculated_at DESC
    LIMIT ?
  `);
  const listSnapshotsByRunStmt = db.prepare(
    "SELECT * FROM unit_economics_snapshots WHERE seller_id = ? AND ingestion_run_id = ? ORDER BY calculated_at DESC",
  );
  const countSnapshotsByRunStmt = db.prepare(
    "SELECT COUNT(*) AS count FROM unit_economics_snapshots WHERE seller_id = ? AND ingestion_run_id = ?",
  );
  const findSnapshotByBusinessKeyStmt = db.prepare(`
    SELECT * FROM unit_economics_snapshots
    WHERE seller_id = ? AND order_id = ? AND item_id = ? AND currency = ?
      AND source_version = ? AND economic_algorithm_version = ? AND economic_checksum = ?
    LIMIT 1
  `);

  // ── Cost component prepared statements ────────────────────────────────

  const findActiveByDedupBaseStmt = db.prepare(`
    SELECT * FROM economic_cost_components
    WHERE seller_id = ?
      AND source = ?
      AND COALESCE(source_record_id, '') = ?
      AND COALESCE(economic_meaning, '') = ?
      AND reversed_at IS NULL
      AND superseded_at IS NULL
    LIMIT 1
  `);

  const findActiveExactStmt = db.prepare(`
    SELECT * FROM economic_cost_components
    WHERE seller_id = ?
      AND source = ?
      AND COALESCE(source_record_id, '') = ?
      AND COALESCE(economic_meaning, '') = ?
      AND COALESCE(source_version, '') = ?
      AND reversed_at IS NULL
      AND superseded_at IS NULL
    LIMIT 1
  `);

  const findComponentByBusinessKeyStmt = db.prepare(`
    SELECT * FROM economic_cost_components
    WHERE seller_id = ?
      AND source = ?
      AND COALESCE(source_record_id, '') = ?
      AND COALESCE(economic_meaning, '') = ?
      AND COALESCE(source_version, '') = ?
      AND currency = ?
      AND amount_minor = ?
      AND reversed_at IS NULL
      AND superseded_at IS NULL
    LIMIT 1
  `);

  const supersedeByDedupBaseStmt = db.prepare(`
    UPDATE economic_cost_components
    SET superseded_at = ?
    WHERE seller_id = ?
      AND source = ?
      AND COALESCE(source_record_id, '') = ?
      AND COALESCE(economic_meaning, '') = ?
      AND reversed_at IS NULL
      AND superseded_at IS NULL
  `);

  const insertCostCompStmt = db.prepare(`
    INSERT INTO economic_cost_components
       (id, seller_id, type, amount_minor, currency, source, source_record_id,
         economic_meaning, source_version, occurred_at, observed_at,
         verification, confidence, metadata_json, ingestion_run_id, identity_enforced, superseded_at, reversed_at, reversed_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL)
     ON CONFLICT DO NOTHING
  `);

  const getCostCompByIdStmt = db.prepare("SELECT * FROM economic_cost_components WHERE id = ?");

  const reverseCostCompStmt = db.prepare(`
    UPDATE economic_cost_components
    SET reversed_at = ?, reversed_reason = ?
    WHERE id = ? AND reversed_at IS NULL
  `);

  const listCostCompsBySourceRecordStmt = db.prepare(`
    SELECT * FROM economic_cost_components
    WHERE seller_id = ? AND source_record_id = ?
    ORDER BY occurred_at DESC
  `);
  const listComponentsByRunStmt = db.prepare(
    "SELECT * FROM economic_cost_components WHERE seller_id = ? AND ingestion_run_id = ? ORDER BY occurred_at DESC",
  );
  const countComponentsByRunStmt = db.prepare(
    "SELECT COUNT(*) AS count FROM economic_cost_components WHERE seller_id = ? AND ingestion_run_id = ?",
  );
  const countSellerAggregatesStmt = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM economic_cost_components WHERE seller_id = ?) AS components,
      (SELECT COUNT(*) FROM unit_economics_snapshots WHERE seller_id = ?) AS snapshots
  `);
  const countSellerReconciliationAggregatesStmt = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM unit_economics_snapshots
        WHERE seller_id = ? AND json_extract(snapshot_json, '$.calculationStatus') = 'partial') AS partial_snapshots,
      (SELECT COUNT(*) FROM unit_economics_snapshots
        WHERE seller_id = ? AND json_extract(snapshot_json, '$.calculationStatus') = 'disputed') AS disputed_snapshots
  `);

  return {
    transaction<T>(fn: () => T): T {
      return db.transaction(fn).immediate();
    },

    getDb(): Database.Database {
      return db;
    },

    insertOutcome(outcome) {
      const tx = db.transaction(() => {
        insertOutcomeStmt.run(
          outcome.outcomeId,
          outcome.sellerId,
          outcome.accountId ?? null,
          outcome.channel ?? null,
          outcome.proposalId ?? null,
          outcome.preparedActionId ?? null,
          outcome.executionId ?? null,
          outcome.correlationId ?? null,
          outcome.workSessionId ?? null,
          outcome.originatingAgentId ?? null,
          outcome.orderId ?? null,
          outcome.itemId ?? null,
          outcome.sku ?? null,
          outcome.expectedEconomicImpact ?? null,
          outcome.observedEconomicImpactId ?? null,
          outcome.observationWindow?.start ?? null,
          outcome.observationWindow?.end ?? null,
          outcome.baselineReference ?? null,
          outcome.status,
          outcome.confidence,
          outcome.completeness,
          JSON.stringify(outcome.evidenceIds),
          outcome.createdAt,
          outcome.observedAt ?? null,
          outcome.verifiedAt ?? null,
          outcome.disputedAt ?? null,
          outcome.invalidatedAt ?? null,
          outcome.verificationReason ?? null,
          1,
        );
      });

      tx();
      return outcome;
    },

    updateOutcomeStatus(outcomeId, newStatus) {
      const existing = getOutcomeByIdStmt.get(outcomeId) as OutcomeRow | undefined;
      if (!existing) {
        throw new Error(`Outcome ${outcomeId} not found`);
      }

      const current = outcomeFromRow(existing);
      const updated = transitionOutcome(current, newStatus);

      updateOutcomeStatusStmt.run(
        updated.status,
        updated.observedAt ?? null,
        updated.verifiedAt ?? null,
        updated.disputedAt ?? null,
        updated.invalidatedAt ?? null,
        updated.verificationReason ?? null,
        outcomeId,
        existing.seller_id,
      );

      return updated;
    },

    verifyOutcome(outcomeId, reason) {
      const existing = getOutcomeByIdStmt.get(outcomeId) as OutcomeRow | undefined;
      if (!existing) {
        throw new Error(`Outcome ${outcomeId} not found`);
      }

      const current = outcomeFromRow(existing);
      const verified = {
        ...transitionOutcome(current, "verified"),
        verificationReason: reason,
      };

      updateOutcomeStatusStmt.run(
        verified.status,
        verified.observedAt ?? null,
        verified.verifiedAt ?? null,
        verified.disputedAt ?? null,
        verified.invalidatedAt ?? null,
        verified.verificationReason ?? null,
        outcomeId,
        existing.seller_id,
      );

      return verified;
    },

    disputeOutcome(outcomeId, reason) {
      const existing = getOutcomeByIdStmt.get(outcomeId) as OutcomeRow | undefined;
      if (!existing) {
        throw new Error(`Outcome ${outcomeId} not found`);
      }

      const current = outcomeFromRow(existing);
      const disputed = {
        ...transitionOutcome(current, "disputed"),
        verificationReason: reason,
      };

      updateOutcomeStatusStmt.run(
        disputed.status,
        disputed.observedAt ?? null,
        disputed.verifiedAt ?? null,
        disputed.disputedAt ?? null,
        disputed.invalidatedAt ?? null,
        disputed.verificationReason ?? null,
        outcomeId,
        existing.seller_id,
      );

      return disputed;
    },

    getOutcome(outcomeId, sellerId) {
      const row = getOutcomeStmt.get(outcomeId, sellerId) as OutcomeRow | undefined;
      return row ? outcomeFromRow(row) : null;
    },

    listOutcomesBySeller(sellerId, opts = {}) {
      const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
      return (listBySellerStmt.all(sellerId, limit) as OutcomeRow[]).map(outcomeFromRow);
    },

    listOutcomesByProposal(proposalId, sellerId) {
      return (listByProposalStmt.all(proposalId, sellerId) as OutcomeRow[]).map(outcomeFromRow);
    },

    listOutcomesByOrder(orderId, sellerId) {
      return (listByOrderStmt.all(orderId, sellerId) as OutcomeRow[]).map(outcomeFromRow);
    },

    listOutcomesByCorrelationId(correlationId, sellerId) {
      return (listByCorrelationStmt.all(correlationId, sellerId) as OutcomeRow[]).map(
        outcomeFromRow,
      );
    },

    listMissingInputs(sellerId) {
      const rows = listAllSnapshotsBySellerStmt.all(sellerId) as UnitEconomicsRow[];

      // Collect missing inputs per snapshot, deduplicate by snapshot
      const result: Array<{ outcomeId: string; missingTypes: CostComponentType[] }> = [];

      for (const row of rows) {
        const parsed = parseJsonObject(row.snapshot_json);
        const missingInputs = (parsed.missingInputs as string[] | undefined) ?? [];
        if (missingInputs.length > 0) {
          result.push({
            outcomeId: row.snapshot_id,
            missingTypes: [...new Set(missingInputs)] as CostComponentType[],
          });
        }
      }

      return result;
    },

    insertUnitEconomicsSnapshot(snapshot) {
      const periodStart = snapshot.period?.start ?? null;
      const periodEnd = snapshot.period?.end ?? null;
      const periodJson =
        periodStart !== null && periodEnd !== null
          ? JSON.stringify({ start: periodStart, end: periodEnd })
          : null;

      const snapshotJson = JSON.stringify(snapshot);

      insertSnapshotStmt.run(
        snapshot.snapshotId,
        snapshot.sellerId,
        snapshot.accountId ?? null,
        snapshot.channel ?? null,
        snapshot.orderId ?? null,
        snapshot.itemId ?? null,
        snapshot.sku ?? null,
        snapshot.product ?? null,
        periodJson,
        snapshot.currency,
        snapshotJson,
        snapshot.calculatedAt,
        snapshot.ingestionRunId ?? null,
        snapshot.sourceVersion ?? null,
        snapshot.economicAlgorithmVersion ?? null,
        snapshot.economicChecksum ?? null,
      );

      const row =
        snapshot.orderId &&
        snapshot.itemId &&
        snapshot.sourceVersion &&
        snapshot.economicAlgorithmVersion &&
        snapshot.economicChecksum
          ? (findSnapshotByBusinessKeyStmt.get(
              snapshot.sellerId,
              snapshot.orderId,
              snapshot.itemId,
              snapshot.currency,
              snapshot.sourceVersion,
              snapshot.economicAlgorithmVersion,
              snapshot.economicChecksum,
            ) as UnitEconomicsRow | undefined)
          : (getSnapshotByIdStmt.get(snapshot.snapshotId, snapshot.sellerId) as
              UnitEconomicsRow | undefined);
      if (!row) throw new Error("Failed to persist unit economics snapshot");
      return snapshotFromRow(row);
    },

    listUnitEconomicsSnapshots(sellerId, opts = {}) {
      const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));

      let rows: UnitEconomicsRow[];

      if (opts.snapshotId) {
        const row = getSnapshotByIdStmt.get(opts.snapshotId, sellerId) as
          UnitEconomicsRow | undefined;
        rows = row ? [row] : [];
      } else if (opts.orderId) {
        rows = listSnapshotsBySellerAndOrderStmt.all(
          sellerId,
          opts.orderId,
          limit,
        ) as UnitEconomicsRow[];
      } else if (opts.itemId) {
        rows = listSnapshotsBySellerAndItemStmt.all(
          sellerId,
          opts.itemId,
          limit,
        ) as UnitEconomicsRow[];
      } else if (opts.sku) {
        rows = listSnapshotsBySellerAndSkuStmt.all(sellerId, opts.sku, limit) as UnitEconomicsRow[];
      } else {
        rows = listSnapshotsBySellerStmt.all(sellerId, limit) as UnitEconomicsRow[];
      }

      return rows.map(snapshotFromRow);
    },

    listSnapshotsByRun(sellerId, ingestionRunId) {
      return (listSnapshotsByRunStmt.all(sellerId, ingestionRunId) as UnitEconomicsRow[]).map(
        snapshotFromRow,
      );
    },

    countSnapshotsByRun(sellerId, ingestionRunId) {
      return (countSnapshotsByRunStmt.get(sellerId, ingestionRunId) as { count: number }).count;
    },

    summarizeProfit(sellerId, currency, opts = {}) {
      const rows = profitSummaryStmt.all(sellerId, currency) as Array<{
        seller_id: string;
        currency: string;
        gross_revenue: number | null;
        net_profit: number | null;
        calculated_at: number;
      }>;

      if (rows.length === 0) {
        return {
          sellerId,
          currency,
          totalRevenue: 0,
          totalCosts: 0,
          netProfit: 0,
          netMargin: 0,
          snapshotCount: 0,
          ...(opts.startDate !== undefined ? { periodStart: opts.startDate } : {}),
          ...(opts.endDate !== undefined ? { periodEnd: opts.endDate } : {}),
        };
      }

      // Filter by date range if provided
      const filtered =
        opts.startDate !== undefined || opts.endDate !== undefined
          ? rows.filter((r) => {
              if (opts.startDate !== undefined && r.calculated_at < opts.startDate) return false;
              if (opts.endDate !== undefined && r.calculated_at > opts.endDate) return false;
              return true;
            })
          : rows;

      let totalRevenue = 0;
      for (const r of filtered) {
        totalRevenue += r.gross_revenue ?? 0;
      }

      // Net profit is aggregated directly
      let totalNetProfit = 0;
      for (const r of filtered) {
        totalNetProfit += r.net_profit ?? 0;
      }

      const totalCosts = totalRevenue - totalNetProfit;
      const netMargin = totalRevenue === 0 ? 0 : totalNetProfit / totalRevenue;

      return {
        sellerId,
        currency,
        totalRevenue,
        totalCosts,
        netProfit: totalNetProfit,
        netMargin,
        snapshotCount: filtered.length,
        ...(opts.startDate !== undefined ? { periodStart: opts.startDate } : {}),
        ...(opts.endDate !== undefined ? { periodEnd: opts.endDate } : {}),
      };
    },

    // ── Cost component methods ──────────────────────────────────────────

    insertCostComponent(input) {
      const key = buildIdempotencyKey(input);

      // Check if ANY active component exists with the same dedup base
      // (same seller, source, sourceRecordId, economicMeaning — regardless of sourceVersion)
      const existingByBase = findActiveByDedupBaseStmt.get(
        key.sellerId,
        key.source,
        key.sourceRecordId,
        key.economicMeaning,
      ) as CostComponentRow | undefined;

      if (existingByBase) {
        // Component exists — check if it's an exact match (same version)
        const existingExact = findActiveExactStmt.get(
          key.sellerId,
          key.source,
          key.sourceRecordId,
          key.economicMeaning,
          key.sourceVersion,
        ) as CostComponentRow | undefined;

        if (existingExact) {
          // Exact key match — check if business data is the same
          const sameData =
            existingExact.type === input.type &&
            existingExact.amount_minor === input.amount.amountMinor &&
            existingExact.currency === input.amount.currency &&
            existingExact.occurred_at === input.occurredAt &&
            existingExact.verification === input.verification &&
            existingExact.confidence === input.confidence;

          if (sameData) {
            return costComponentFromRow(existingExact);
          }

          // Same key, different data → call upsert
          return this.upsertCostComponent(input);
        }

        // Different sourceVersion — call upsert to supersede old and insert new
        return this.upsertCostComponent(input);
      }

      // No active component exists — insert a new one
      const id = input.id ?? nextCostComponentId();
      const now = Date.now();

      insertCostCompStmt.run(
        id,
        input.sellerId,
        input.type,
        input.amount.amountMinor,
        input.amount.currency,
        input.source,
        input.sourceRecordId ?? null,
        input.economicMeaning ?? null,
        input.sourceVersion ?? null,
        input.occurredAt,
        input.observedAt ?? now,
        input.verification,
        input.confidence,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.ingestionRunId ?? null,
      );

      const row =
        (getCostCompByIdStmt.get(id) as CostComponentRow | undefined) ??
        (findComponentByBusinessKeyStmt.get(
          key.sellerId,
          key.source,
          key.sourceRecordId,
          key.economicMeaning,
          key.sourceVersion,
          input.amount.currency,
          input.amount.amountMinor,
        ) as CostComponentRow | undefined);
      if (!row) throw new Error("Failed to persist economic cost component");
      return costComponentFromRow(row);
    },

    upsertCostComponent(input) {
      const key = buildIdempotencyKey(input);
      const now = Date.now();

      const exact = findComponentByBusinessKeyStmt.get(
        key.sellerId,
        key.source,
        key.sourceRecordId,
        key.economicMeaning,
        key.sourceVersion,
        input.amount.currency,
        input.amount.amountMinor,
      ) as CostComponentRow | undefined;
      if (exact) return costComponentFromRow(exact);

      // Supersede all active versions matching the dedup base
      supersedeByDedupBaseStmt.run(
        now,
        key.sellerId,
        key.source,
        key.sourceRecordId,
        key.economicMeaning,
      );

      // Insert the new version
      const id = input.id ?? nextCostComponentId();
      insertCostCompStmt.run(
        id,
        input.sellerId,
        input.type,
        input.amount.amountMinor,
        input.amount.currency,
        input.source,
        input.sourceRecordId ?? null,
        input.economicMeaning ?? null,
        input.sourceVersion ?? null,
        input.occurredAt,
        input.observedAt ?? now,
        input.verification,
        input.confidence,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.ingestionRunId ?? null,
      );

      const row =
        (getCostCompByIdStmt.get(id) as CostComponentRow | undefined) ??
        (findComponentByBusinessKeyStmt.get(
          key.sellerId,
          key.source,
          key.sourceRecordId,
          key.economicMeaning,
          key.sourceVersion,
          input.amount.currency,
          input.amount.amountMinor,
        ) as CostComponentRow | undefined);
      if (!row) throw new Error("Failed to persist economic cost component");
      return costComponentFromRow(row);
    },

    listCostComponents(sellerId, opts = {}) {
      const limit = Math.max(1, Math.min(opts.limit ?? 1000, 5000));
      const offset = opts.offset ?? 0;

      // Build WHERE clause dynamically
      let sql =
        "SELECT * FROM economic_cost_components WHERE seller_id = ? AND reversed_at IS NULL AND superseded_at IS NULL";
      const params: (string | number)[] = [sellerId];

      if (opts.type !== undefined) {
        sql += " AND type = ?";
        params.push(opts.type);
      }

      if (opts.includeReversed !== true) {
        // reversed_at IS NULL is already in the base query
        // Only add reversed if explicitly requested
      } else {
        // If includeReversed, remove the reversed_at IS NULL filter
        sql = sql.replace("AND reversed_at IS NULL ", "");
      }

      sql += " ORDER BY occurred_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as CostComponentRow[];
      return rows.map(costComponentFromRow);
    },

    listBySourceRecord(sellerId, sourceRecordId) {
      const rows = listCostCompsBySourceRecordStmt.all(
        sellerId,
        sourceRecordId,
      ) as CostComponentRow[];
      return rows.map(costComponentFromRow);
    },

    listComponentsByRun(sellerId, ingestionRunId) {
      return (listComponentsByRunStmt.all(sellerId, ingestionRunId) as CostComponentRow[]).map(
        costComponentFromRow,
      );
    },

    countComponentsByRun(sellerId, ingestionRunId) {
      return (countComponentsByRunStmt.get(sellerId, ingestionRunId) as { count: number }).count;
    },

    countSellerAggregates(sellerId) {
      return countSellerAggregatesStmt.get(sellerId, sellerId) as {
        components: number;
        snapshots: number;
      };
    },

    countSellerReconciliationAggregates(sellerId) {
      const counts = countSellerReconciliationAggregatesStmt.get(sellerId, sellerId) as {
        partial_snapshots: number;
        disputed_snapshots: number;
      };
      return {
        partialSnapshots: counts.partial_snapshots,
        disputedSnapshots: counts.disputed_snapshots,
      };
    },

    reverseCostComponent(id, reason) {
      const now = Date.now();

      const existing = getCostCompByIdStmt.get(id) as CostComponentRow | undefined;
      if (!existing) return null;
      if (existing.reversed_at !== null) return costComponentFromRow(existing); // Already reversed

      reverseCostCompStmt.run(now, reason, id);

      const updated = getCostCompByIdStmt.get(id) as CostComponentRow;
      return costComponentFromRow(updated);
    },
  };
}
