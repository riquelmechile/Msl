import type {
  CostComponentType,
  EconomicOutcome,
  EconomicOutcomeStatus,
  UnitEconomicsSnapshot,
} from "@msl/domain";
import { EconomicOutcomeStateError, transitionOutcome } from "@msl/domain";
import type { Currency } from "@msl/domain";
import Database from "better-sqlite3";

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

type CostComponentRow = {
  id: string;
  seller_id: string;
  type: string;
  amount_minor: number;
  currency: string;
  source: string;
  source_record_id: string | null;
  occurred_at: number;
  observed_at: number;
  verification: string;
  confidence: number;
  metadata_json: string;
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

export type EconomicOutcomeStore = {
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
  summarizeProfit(
    sellerId: string,
    currency: Currency,
    opts?: { startDate?: number; endDate?: number },
  ): ProfitSummary;
};

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
    calculatedAt: row.calculated_at,
  } as unknown as UnitEconomicsSnapshot;
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
      calculated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_unit_economics_seller ON unit_economics_snapshots(seller_id);
    CREATE INDEX IF NOT EXISTS idx_unit_economics_order ON unit_economics_snapshots(order_id);
  `);
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createSqliteEconomicOutcomeStore(db: Database.Database): EconomicOutcomeStore {
  migrateEconomicOutcomeStore(db);

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
    INSERT OR REPLACE INTO unit_economics_snapshots
      (snapshot_id, seller_id, account_id, channel, order_id, item_id, sku,
       product, period, currency, snapshot_json, calculated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return {
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
  };
}
