import Database from "better-sqlite3";

import { AutonomyLevel } from "./types.js";
import type { DegradationEvent, KpiSnapshot } from "./types.js";

// ── Schema ───────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS autonomy_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_level INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kpi_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level INTEGER NOT NULL,
  margin_compliance REAL NOT NULL,
  success_rate REAL NOT NULL,
  safety_violations INTEGER NOT NULL,
  response_accuracy REAL NOT NULL,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS degradation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_level INTEGER NOT NULL,
  to_level INTEGER NOT NULL,
  reason TEXT NOT NULL,
  kpi_snapshot TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);
`;

// ── Threshold mapping ─────────────────────────────────────────────────

/** Maps each autonomy level to the maximum risk it can auto-execute. */
const LEVEL_RISK_THRESHOLD: Record<AutonomyLevel, string> = {
  [AutonomyLevel.CONSULTA]: "none",
  [AutonomyLevel.SUGIERE]: "low",
  [AutonomyLevel.PREPARA]: "low",
  [AutonomyLevel.BAJO_RIESGO]: "medium",
  [AutonomyLevel.MEDIO_RIESGO]: "medium",
  [AutonomyLevel.FULL]: "high",
};

/** Numeric ordering for risk levels (higher = more severe). */
const RISK_ORDER: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Numeric ordering for auto-execution thresholds. */
const THRESHOLD_ORDER: Record<string, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

// ── Row mapping ──────────────────────────────────────────────────────

type KpiRow = {
  level: number;
  margin_compliance: number;
  success_rate: number;
  safety_violations: number;
  response_accuracy: number;
  timestamp: string;
}

/**
 * Create the autonomy engine backed by SQLite.
 *
 * Follows the same factory pattern as {@link createStrategyStore}:
 * the caller owns the `Database` handle and the engine only adds
 * its own schema and prepared statements.
 *
 * @param db       An existing `better-sqlite3` Database connection.
 * @param config   Optional initial configuration (defaults to SUGIERE).
 */
export function createAutonomyEngine(
  db: Database.Database,
  config?: { initialLevel?: AutonomyLevel },
) {
  db.exec(SCHEMA_SQL);

  // Seed the singleton state row if it doesn't exist.
  const initialLevel = config?.initialLevel ?? AutonomyLevel.SUGIERE;
  db.prepare(
    `INSERT OR IGNORE INTO autonomy_state (id, current_level) VALUES (1, ?)`,
  ).run(initialLevel);

  // ── Prepared statements ──────────────────────────────────────

  const getLevelStmt = db.prepare(
    `SELECT current_level FROM autonomy_state WHERE id = 1`,
  );

  const setLevelStmt = db.prepare(
    `UPDATE autonomy_state SET current_level = ?, updated_at = datetime(?) WHERE id = 1`,
  );

  const insertKpiStmt = db.prepare(`
    INSERT INTO kpi_history
      (level, margin_compliance, success_rate, safety_violations, response_accuracy, timestamp)
    VALUES (@level, @marginCompliance, @successRate, @safetyViolations, @responseAccuracy, @timestamp)
  `);

  /** Limit kpi_history to the most recent 1000 rows (FIFO eviction). */
  const trimKpiHistoryStmt = db.prepare(`
    DELETE FROM kpi_history
    WHERE id IN (
      SELECT id FROM kpi_history
      ORDER BY id ASC
      LIMIT MAX(0, (SELECT COUNT(*) FROM kpi_history) - 1000)
    )
  `);

  const insertDegradationStmt = db.prepare(`
    INSERT INTO degradation_events
      (from_level, to_level, reason, kpi_snapshot, timestamp)
    VALUES (@from, @to, @reason, @kpiSnapshot, @timestamp)
  `);

  const kpiWindowStmt = db.prepare(`
    SELECT * FROM kpi_history
    WHERE timestamp >= @since AND timestamp <= @now
    ORDER BY timestamp ASC
  `);

  // ── Public API ────────────────────────────────────────────────

  /**
   * Read the current autonomy level from persistent state.
   */
  const getCurrentLevel = (): AutonomyLevel => {
    const row = getLevelStmt.get() as { current_level: number };
    return row.current_level;
  };

  /**
   * Override the autonomy level and record a degradation event.
   *
   * @param level  The new level to set.
   * @param reason Spanish explanation of why the level changed.
   */
  const setLevel = (level: AutonomyLevel, reason: string): void => {
    const from = getCurrentLevel();
    const now = normalizeTs(new Date().toISOString());

    db.transaction(() => {
      setLevelStmt.run(level, now);

      // Build a minimal KPI snapshot for the degradation event.
      const snapshot: KpiSnapshot = {
        level: from,
        marginCompliance: 0,
        successRate: 0,
        safetyViolations: 0,
        responseAccuracy: 0,
        timestamp: now,
      };

      insertDegradationStmt.run({
        from,
        to: level,
        reason,
        kpiSnapshot: JSON.stringify(snapshot),
        timestamp: now,
      });
    })();
  };

  /**
   * Persist a KPI snapshot into the history table.
   *
   * The timestamp is normalised to "YYYY-MM-DD HH:MM:SS" so that
   * time-window queries use consistent string comparisons.
   */
  const recordKpi = (kpi: KpiSnapshot): void => {
    insertKpiStmt.run({
      level: kpi.level,
      marginCompliance: kpi.marginCompliance,
      successRate: kpi.successRate,
      safetyViolations: kpi.safetyViolations,
      responseAccuracy: kpi.responseAccuracy,
      timestamp: normalizeTs(kpi.timestamp),
    });
    // Enforce FIFO cap: keep last 1000 records.
    trimKpiHistoryStmt.run();
  };

  // ── Evaluation helpers ────────────────────────────────────────

  /**
   * Normalize a timestamp to the SQLite-comparable format used by
   * datetime('now'): "YYYY-MM-DD HH:MM:SS".  This ensures string
   * comparisons (>= / <=) work correctly across all rows.
   */
  const normalizeTs = (ts: string): string => {
    // Strip milliseconds, timezone suffix, and replace "T" with space.
    // "2026-06-26T12:00:00.000Z" → "2026-06-26 12:00:00"
    const space = ts.replace("T", " ");
    const dot = space.indexOf(".");
    return dot === -1 ? space : space.slice(0, dot);
  };

  /** ISO datetime string offset by `days` from the given date. */
  const daysAgo = (now: Date, days: number): string => {
    const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return normalizeTs(d.toISOString());
  };

  const nowIso = (now: Date): string => normalizeTs(now.toISOString());

  /**
   * Retrieve KPI rows within a time window ending at `now`.
   */
  const queryKpiWindow = (days: number, now: Date): KpiRow[] => {
    const since = daysAgo(now, days);
    const until = nowIso(now);
    return kpiWindowStmt.all({ since, now: until }) as KpiRow[];
  };

  // ── Degradation ───────────────────────────────────────────────

  /**
   * Evaluate whether the current KPIs warrant degrading the autonomy level.
   *
   * Rules applied (cumulative, max −3 per evaluation, floor at 0):
   * 1. safetyViolations > 3 in last 24h → FORCE level 0
   * 2. marginCompliance < 0.8 (avg) in last 7 days → drop 1 level
   * 3. successRate < 0.5 (avg) in last 30 days → drop 1 level
   *
   * @param now Frozen date for testability. Defaults to `new Date()`.
   * @returns A `DegradationEvent` if the level changed, or `null`.
   */
  const evaluateDegradation = (now: Date = new Date()): DegradationEvent | null => {
    const current = getCurrentLevel();
    if (current === AutonomyLevel.CONSULTA) return null; // already at floor

    let newLevel: AutonomyLevel = current;
    const reasons: string[] = [];

    // Rule 1: safety violations > 3 in last 24h → force level 0
    const dayRows = queryKpiWindow(1, now);
    const totalSafetyViolations = dayRows.reduce(
      (sum, r) => sum + r.safety_violations,
      0,
    );
    if (totalSafetyViolations > 3) {
      reasons.push(
        `Más de 3 violaciones de seguridad (${totalSafetyViolations}) en las últimas 24 horas.`,
      );
      newLevel = AutonomyLevel.CONSULTA;
    }

    // Rule 2: average marginCompliance < 0.8 in last 7 days
    const weekRows = queryKpiWindow(7, now);
    if (weekRows.length > 0) {
      const avgMargin =
        weekRows.reduce((sum, r) => sum + r.margin_compliance, 0) /
        weekRows.length;
      if (avgMargin < 0.8 && newLevel > AutonomyLevel.CONSULTA) {
        reasons.push(
          `Cumplimiento de margen promedio (${(avgMargin * 100).toFixed(0)}%) por debajo del 80% en los últimos 7 días.`,
        );
        newLevel = Math.max(0, newLevel - 1);
      }
    }

    // Rule 3: average successRate < 0.5 in last 30 days
    const monthRows = queryKpiWindow(30, now);
    if (monthRows.length > 0) {
      const avgSuccess =
        monthRows.reduce((sum, r) => sum + r.success_rate, 0) /
        monthRows.length;
      if (avgSuccess < 0.5 && newLevel > AutonomyLevel.CONSULTA) {
        reasons.push(
          `Tasa de éxito promedio (${(avgSuccess * 100).toFixed(0)}%) por debajo del 50% en los últimos 30 días.`,
        );
        newLevel = Math.max(0, newLevel - 1);
      }
    }

    if (newLevel === current) return null;

    // Persist the degradation
    const reason = reasons.join(" | ");
    const nowIsoVal = normalizeTs(now.toISOString());

    const eventSnapshot: KpiSnapshot = {
      level: current,
      marginCompliance: 0,
      successRate: 0,
      safetyViolations: totalSafetyViolations,
      responseAccuracy: 0,
      timestamp: nowIsoVal,
    };

    db.transaction(() => {
      setLevelStmt.run(newLevel, nowIsoVal);

      insertDegradationStmt.run({
        from: current,
        to: newLevel,
        reason,
        kpiSnapshot: JSON.stringify(eventSnapshot),
        timestamp: nowIsoVal,
      });
    })();

    return {
      from: current,
      to: newLevel,
      reason,
      kpiSnapshot: eventSnapshot,
      timestamp: nowIsoVal,
    };
  };

  // ── Promotion ─────────────────────────────────────────────────

  /**
   * Evaluate whether the current KPIs support promoting the autonomy level.
   *
   * Promotion is recommended when ALL of these hold for the last 30 days:
   * - safetyViolations === 0
   * - avg marginCompliance > 0.9
   * - avg successRate > 0.9
   * - avg responseAccuracy > 0.9
   *
   * @param now Frozen date for testability. Defaults to `new Date()`.
   */
  const evaluatePromotion = (
    now: Date = new Date(),
  ): { recommend: boolean; to: AutonomyLevel } => {
    const current = getCurrentLevel();
    if (current >= AutonomyLevel.FULL) {
      return { recommend: false, to: current };
    }

    const monthRows = queryKpiWindow(30, now);
    if (monthRows.length === 0) {
      return { recommend: false, to: current };
    }

    const totalSafety = monthRows.reduce(
      (sum, r) => sum + r.safety_violations,
      0,
    );
    if (totalSafety > 0) return { recommend: false, to: current };

    const avgMargin =
      monthRows.reduce((sum, r) => sum + r.margin_compliance, 0) /
      monthRows.length;
    if (avgMargin <= 0.9) return { recommend: false, to: current };

    const avgSuccess =
      monthRows.reduce((sum, r) => sum + r.success_rate, 0) /
      monthRows.length;
    if (avgSuccess <= 0.9) return { recommend: false, to: current };

    const avgAccuracy =
      monthRows.reduce((sum, r) => sum + r.response_accuracy, 0) /
      monthRows.length;
    if (avgAccuracy <= 0.9) return { recommend: false, to: current };

    return { recommend: true, to: (current + 1) };
  };

  // ── Auto-approval gate ────────────────────────────────────────

  /**
   * Check whether the current autonomy level allows auto-approval
   * for a proposed action at the given risk level.
   *
   * `critical`-risk actions are NEVER auto-approved.
   *
   * @param riskLevel The action's risk level (`low`, `medium`, `high`, `critical`).
   */
  const canAutoApprove = (riskLevel: string): boolean => {
    if (riskLevel === "critical") return false;

    const level = getCurrentLevel();
    const threshold = LEVEL_RISK_THRESHOLD[level];
    const riskNum = RISK_ORDER[riskLevel] ?? 0;
    const thresholdNum = THRESHOLD_ORDER[threshold] ?? 0;

    return riskNum <= thresholdNum;
  };

  return {
    getCurrentLevel,
    setLevel,
    recordKpi,
    evaluateDegradation,
    evaluatePromotion,
    canAutoApprove,
  };
}

export type AutonomyEngine = ReturnType<typeof createAutonomyEngine>;
