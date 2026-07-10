import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";

import { createAutonomyEngine } from "../../src/conversation/autonomyEngine.js";
import { autonomyGate } from "../../src/conversation/guardrails.js";
import { AutonomyLevel } from "../../src/conversation/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

/** Seller ID constant for tests. */
const SELLER_A = "seller-plasticov";
const SELLER_B = "seller-maustian";

/**
 * Create a KPI snapshot with default healthy values.
 * Override any field to simulate specific scenarios.
 */
function kpiSnapshot(
  overrides: Partial<{
    level: AutonomyLevel;
    marginCompliance: number;
    successRate: number;
    safetyViolations: number;
    responseAccuracy: number;
    timestamp: string;
    sellerId?: string;
  }> = {},
): import("../../src/conversation/types.js").KpiSnapshot {
  return {
    level: overrides.level ?? AutonomyLevel.SUGIERE,
    marginCompliance: overrides.marginCompliance ?? 1,
    successRate: overrides.successRate ?? 1,
    safetyViolations: overrides.safetyViolations ?? 0,
    responseAccuracy: overrides.responseAccuracy ?? 1,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    ...(overrides.sellerId ? { sellerId: overrides.sellerId } : {}),
  };
}

/** Return a normalised datetime string N hours in the past from `now`. */
function hoursAgo(now: Date, hours: number): string {
  const d = new Date(now.getTime() - hours * 60 * 60 * 1000);
  return d
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
}

/** Return a normalised datetime string N days in the past from `now`. */
function daysAgo(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
}

// ── Setup ────────────────────────────────────────────────────────────

describe("autonomyEngine", () => {
  let db: Database.Database;
  let engine: ReturnType<typeof createAutonomyEngine>;

  beforeEach(() => {
    db = new Database(":memory:");
    engine = createAutonomyEngine(db);
  });

  // ── getCurrentLevel / default state ──────────────────────────

  it("defaults to SUGIERE (1) level", () => {
    expect(engine.getCurrentLevel(SELLER_A)).toBe(AutonomyLevel.SUGIERE);
  });

  it("accepts a custom initial level via config", () => {
    const db2 = new Database(":memory:");
    const eng = createAutonomyEngine(db2, {
      initialLevel: AutonomyLevel.BAJO_RIESGO,
    });
    expect(eng.getCurrentLevel(SELLER_A)).toBe(AutonomyLevel.BAJO_RIESGO);
  });

  it("persists level across re-initializations", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.MEDIO_RIESGO, "CEO promoted");

    // Re-create engine on the same db — must reload persisted level.
    const engine2 = createAutonomyEngine(db);
    expect(engine2.getCurrentLevel(SELLER_A)).toBe(AutonomyLevel.MEDIO_RIESGO);
  });

  // ── setLevel ─────────────────────────────────────────────────

  it("setLevel records a degradation event", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.CONSULTA, "Safety violation spike");

    expect(engine.getCurrentLevel(SELLER_A)).toBe(AutonomyLevel.CONSULTA);

    const rows = db.prepare("SELECT * FROM degradation_events ORDER BY id").all() as {
      from_level: number;
      to_level: number;
      reason: string;
      seller_id: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.from_level).toBe(AutonomyLevel.SUGIERE);
    expect(rows[0]!.to_level).toBe(AutonomyLevel.CONSULTA);
    expect(rows[0]!.reason).toBe("Safety violation spike");
    expect(rows[0]!.seller_id).toBe(SELLER_A);
  });

  it("setLevel updates the autonomy_state row for the seller", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.PREPARA, "reason");
    const row = db
      .prepare("SELECT current_level FROM autonomy_state WHERE seller_id = ?")
      .get(SELLER_A) as { current_level: number };
    expect(row.current_level).toBe(AutonomyLevel.PREPARA);
  });

  // ── Per-seller state isolation ───────────────────────────────

  it("per-seller state is isolated between two sellers", () => {
    // Set different levels for two sellers
    engine.setLevel(SELLER_A, AutonomyLevel.MEDIO_RIESGO, "promoted");
    engine.setLevel(SELLER_B, AutonomyLevel.CONSULTA, "degraded");

    expect(engine.getCurrentLevel(SELLER_A)).toBe(AutonomyLevel.MEDIO_RIESGO);
    expect(engine.getCurrentLevel(SELLER_B)).toBe(AutonomyLevel.CONSULTA);
  });

  it("new seller initialised at default level", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.FULL, "promoted");
    // SELLER_B hasn't been initialised yet
    expect(engine.getCurrentLevel(SELLER_B)).toBe(AutonomyLevel.SUGIERE);
    expect(engine.getCurrentLevel(SELLER_A)).toBe(AutonomyLevel.FULL);
  });

  // ── recordKpi ────────────────────────────────────────────────

  it("recordKpi inserts into kpi_history", () => {
    const snap = kpiSnapshot({
      marginCompliance: 0.85,
      successRate: 0.92,
      safetyViolations: 1,
      responseAccuracy: 0.95,
    });
    engine.recordKpi(snap);

    const rows = db.prepare("SELECT * FROM kpi_history").all() as {
      margin_compliance: number;
      success_rate: number;
      safety_violations: number;
      response_accuracy: number;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.margin_compliance).toBe(0.85);
    expect(rows[0]!.success_rate).toBe(0.92);
    expect(rows[0]!.safety_violations).toBe(1);
    expect(rows[0]!.response_accuracy).toBe(0.95);
  });

  // ── evaluateDegradation: safety violations ────────────────────

  it("evaluateDegradation forces level 0 when safetyViolations > 3 in 24h", () => {
    // Set level to a higher value first.
    engine.setLevel(SELLER_A, AutonomyLevel.BAJO_RIESGO, "promoted");
    expect(engine.getCurrentLevel(SELLER_A)).toBe(AutonomyLevel.BAJO_RIESGO);

    const now = new Date("2026-06-26T12:00:00Z");
    // Insert 4 KPIs within last hour, each with 1 safety violation.
    for (let i = 0; i < 4; i++) {
      engine.recordKpi(
        kpiSnapshot({
          level: AutonomyLevel.BAJO_RIESGO,
          safetyViolations: 1,
          timestamp: hoursAgo(now, i),
          sellerId: SELLER_A,
        }),
      );
    }

    const event = engine.evaluateDegradation(SELLER_A, now);
    expect(event).not.toBeNull();
    expect(event!.from).toBe(AutonomyLevel.BAJO_RIESGO);
    expect(event!.to).toBe(AutonomyLevel.CONSULTA);
    expect(event!.reason).toMatch(/violaciones de seguridad/);
    expect(engine.getCurrentLevel(SELLER_A)).toBe(AutonomyLevel.CONSULTA);

    // Verify degradation event persisted.
    const degRows = db.prepare("SELECT COUNT(*) as count FROM degradation_events").get() as {
      count: number;
    };
    // setLevel created 1 + evaluateDegradation creates 1 = 2 total
    expect(degRows.count).toBe(2);
  });

  it("evaluateDegradation does not trigger with ≤ 3 safety violations", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.BAJO_RIESGO, "promoted");
    const now = new Date("2026-06-26T12:00:00Z");
    for (let i = 0; i < 3; i++) {
      engine.recordKpi(
        kpiSnapshot({
          level: AutonomyLevel.BAJO_RIESGO,
          safetyViolations: 1,
          timestamp: hoursAgo(now, i),
          sellerId: SELLER_A,
        }),
      );
    }
    const event = engine.evaluateDegradation(SELLER_A, now);
    expect(event).toBeNull();
    expect(engine.getCurrentLevel(SELLER_A)).toBe(AutonomyLevel.BAJO_RIESGO);
  });

  it("Seller-A degradation doesn't affect Seller-B", () => {
    // Promote both
    engine.setLevel(SELLER_A, AutonomyLevel.BAJO_RIESGO, "promoted");
    engine.setLevel(SELLER_B, AutonomyLevel.BAJO_RIESGO, "promoted");

    const now = new Date("2026-06-26T12:00:00Z");
    // Seller A: >3 safety violations in 24h
    for (let i = 0; i < 4; i++) {
      engine.recordKpi(
        kpiSnapshot({
          level: AutonomyLevel.BAJO_RIESGO,
          safetyViolations: 1,
          timestamp: hoursAgo(now, i),
          sellerId: SELLER_A,
        }),
      );
    }
    // Seller B: 0 violations in 24h
    engine.recordKpi(
      kpiSnapshot({
        level: AutonomyLevel.BAJO_RIESGO,
        safetyViolations: 0,
        timestamp: hoursAgo(now, 0),
        sellerId: SELLER_B,
      }),
    );

    const eventA = engine.evaluateDegradation(SELLER_A, now);
    expect(eventA).not.toBeNull();
    expect(eventA!.to).toBe(AutonomyLevel.CONSULTA);

    const eventB = engine.evaluateDegradation(SELLER_B, now);
    expect(eventB).toBeNull();
    expect(engine.getCurrentLevel(SELLER_B)).toBe(AutonomyLevel.BAJO_RIESGO);
  });

  // ── evaluateDegradation: margin compliance ────────────────────

  it("evaluateDegradation drops 1 level when avg marginCompliance < 0.8 in 7 days", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.MEDIO_RIESGO, "promoted");
    const now = new Date("2026-06-26T12:00:00Z");

    // Insert 5 KPIs with poor margin compliance over the last 6 days.
    for (let i = 0; i < 5; i++) {
      engine.recordKpi(
        kpiSnapshot({
          level: AutonomyLevel.MEDIO_RIESGO,
          marginCompliance: 0.6,
          timestamp: daysAgo(now, i), // 0..4 days ago
          sellerId: SELLER_A,
        }),
      );
    }

    const event = engine.evaluateDegradation(SELLER_A, now);
    expect(event).not.toBeNull();
    expect(event!.from).toBe(AutonomyLevel.MEDIO_RIESGO);
    expect(event!.to).toBe(AutonomyLevel.BAJO_RIESGO);
    expect(event!.reason).toMatch(/margen/);
  });

  // ── evaluateDegradation: success rate ─────────────────────────

  it("evaluateDegradation drops 1 level when avg successRate < 0.5 in 30 days", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.PREPARA, "promoted");
    const now = new Date("2026-06-26T12:00:00Z");

    // Insert 10 KPIs with poor success rate spread over 29 days.
    for (let i = 0; i < 10; i++) {
      engine.recordKpi(
        kpiSnapshot({
          level: AutonomyLevel.PREPARA,
          successRate: 0.3,
          timestamp: daysAgo(now, i * 3), // 0, 3, 6, ... 27 days ago
          sellerId: SELLER_A,
        }),
      );
    }

    const event = engine.evaluateDegradation(SELLER_A, now);
    expect(event).not.toBeNull();
    expect(event!.to).toBe(AutonomyLevel.SUGIERE);
    expect(event!.reason).toMatch(/éxito/);
  });

  // ── evaluateDegradation: null when KPIs are good ──────────────

  it("evaluateDegradation returns null when all KPIs are healthy", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.BAJO_RIESGO, "promoted");
    const now = new Date("2026-06-26T12:00:00Z");

    // Good KPIs.
    for (let i = 0; i < 10; i++) {
      engine.recordKpi(
        kpiSnapshot({
          level: AutonomyLevel.BAJO_RIESGO,
          marginCompliance: 0.95,
          successRate: 0.9,
          safetyViolations: 0,
          timestamp: daysAgo(now, i),
          sellerId: SELLER_A,
        }),
      );
    }

    const event = engine.evaluateDegradation(SELLER_A, now);
    expect(event).toBeNull();
    expect(engine.getCurrentLevel(SELLER_A)).toBe(AutonomyLevel.BAJO_RIESGO);
  });

  // ── evaluateDegradation: cumulative ───────────────────────────

  it("evaluateDegradation applies multiple rules cumulatively", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.MEDIO_RIESGO, "promoted");
    const now = new Date("2026-06-26T12:00:00Z");

    // 4 safety violations in 24h → force 0 (but cumulative rules still apply)
    for (let i = 0; i < 4; i++) {
      engine.recordKpi(
        kpiSnapshot({
          level: AutonomyLevel.MEDIO_RIESGO,
          safetyViolations: 1,
          marginCompliance: 0.5,
          successRate: 0.3,
          timestamp: hoursAgo(now, i),
          sellerId: SELLER_A,
        }),
      );
    }

    const event = engine.evaluateDegradation(SELLER_A, now);
    expect(event).not.toBeNull();
    // Safety rule forces level 0 directly.
    expect(event!.to).toBe(AutonomyLevel.CONSULTA);
  });

  // ── evaluatePromotion ─────────────────────────────────────────

  it("evaluatePromotion recommends when all KPIs > 0.9 for 30 days", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.SUGIERE, "initial");
    const now = new Date("2026-06-26T12:00:00Z");

    // 30 days of excellent KPIs.
    for (let i = 0; i < 30; i++) {
      engine.recordKpi(
        kpiSnapshot({
          level: AutonomyLevel.SUGIERE,
          marginCompliance: 0.95,
          successRate: 0.95,
          safetyViolations: 0,
          responseAccuracy: 0.95,
          timestamp: daysAgo(now, i),
          sellerId: SELLER_A,
        }),
      );
    }

    const result = engine.evaluatePromotion(SELLER_A, now);
    expect(result.recommend).toBe(true);
    expect(result.to).toBe(AutonomyLevel.PREPARA);
  });

  it("evaluatePromotion does not recommend when safety violations exist", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.SUGIERE, "initial");
    const now = new Date("2026-06-26T12:00:00Z");

    for (let i = 0; i < 30; i++) {
      engine.recordKpi(
        kpiSnapshot({
          level: AutonomyLevel.SUGIERE,
          marginCompliance: 0.95,
          successRate: 0.95,
          safetyViolations: i === 0 ? 1 : 0, // one violation
          responseAccuracy: 0.95,
          timestamp: daysAgo(now, i),
          sellerId: SELLER_A,
        }),
      );
    }

    const result = engine.evaluatePromotion(SELLER_A, now);
    expect(result.recommend).toBe(false);
  });

  it("evaluatePromotion returns false when at FULL (max level)", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.FULL, "promoted");
    const now = new Date("2026-06-26T12:00:00Z");

    for (let i = 0; i < 30; i++) {
      engine.recordKpi(
        kpiSnapshot({
          level: AutonomyLevel.FULL,
          marginCompliance: 0.95,
          successRate: 0.95,
          responseAccuracy: 0.95,
          timestamp: daysAgo(now, i),
          sellerId: SELLER_A,
        }),
      );
    }

    const result = engine.evaluatePromotion(SELLER_A, now);
    expect(result.recommend).toBe(false);
  });

  it("evaluatePromotion returns false with no KPI data", () => {
    const result = engine.evaluatePromotion(SELLER_A);
    expect(result.recommend).toBe(false);
  });

  // ── canAutoApprove ────────────────────────────────────────────

  it("canAutoApprove returns true for 'low' risk at BAJO_RIESGO level", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.BAJO_RIESGO, "promoted");
    expect(engine.canAutoApprove(SELLER_A, "low")).toBe(true);
  });

  it("canAutoApprove returns true for 'medium' risk at BAJO_RIESGO level", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.BAJO_RIESGO, "promoted");
    expect(engine.canAutoApprove(SELLER_A, "medium")).toBe(true);
  });

  it("canAutoApprove returns false for 'high' risk at BAJO_RIESGO level", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.BAJO_RIESGO, "promoted");
    expect(engine.canAutoApprove(SELLER_A, "high")).toBe(false);
  });

  it("canAutoApprove returns false for 'critical' at any level", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.FULL, "promoted");
    expect(engine.canAutoApprove(SELLER_A, "critical")).toBe(false);
  });

  it("canAutoApprove returns false for any risk at CONSULTA (0)", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.CONSULTA, "deg");
    expect(engine.canAutoApprove(SELLER_A, "low")).toBe(false);
  });

  it("canAutoApprove returns true for 'high' at FULL (5)", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.FULL, "promoted");
    expect(engine.canAutoApprove(SELLER_A, "high")).toBe(true);
  });

  // ── autonomyGate guardrail ────────────────────────────────────

  it("autonomyGate returns passed: true when level allows auto-approval", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.BAJO_RIESGO, "promoted");
    const result = autonomyGate({ riskLevel: "low" }, engine, SELLER_A);
    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("autonomyGate returns passed: true with Spanish reason when not allowed", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.SUGIERE, "initial");
    const result = autonomyGate({ riskLevel: "high" }, engine, SELLER_A);
    expect(result.passed).toBe(true);
    expect(result.reason).toMatch(/dale/);
    expect(result.reason).toMatch(/high/);
  });

  // ── Degradation event persistence ─────────────────────────────

  it("evaluateDegradation persists degradation event into the database", () => {
    engine.setLevel(SELLER_A, AutonomyLevel.BAJO_RIESGO, "promoted");
    const now = new Date("2026-06-26T12:00:00Z");

    // Trigger safety violation degradation.
    for (let i = 0; i < 5; i++) {
      engine.recordKpi(
        kpiSnapshot({
          level: AutonomyLevel.BAJO_RIESGO,
          safetyViolations: 1,
          timestamp: hoursAgo(now, i),
          sellerId: SELLER_A,
        }),
      );
    }
    engine.evaluateDegradation(SELLER_A, now);

    const rows = db
      .prepare(
        "SELECT from_level, to_level, reason FROM degradation_events WHERE from_level != to_level",
      )
      .all() as { from_level: number; to_level: number; reason: string }[];
    // Should have at least the degradation row (from_level 3 → to_level 0)
    const degradationRow = rows.find((r) => r.to_level === 0);
    expect(degradationRow).toBeDefined();
    expect(degradationRow!.reason).toMatch(/violaciones de seguridad/);
  });
});
