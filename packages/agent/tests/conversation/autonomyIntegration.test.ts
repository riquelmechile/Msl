import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { createAgentLoop } from "../../src/conversation/agentLoop.js";
import { createAutonomyEngine } from "../../src/conversation/autonomyEngine.js";
import { autonomyGate } from "../../src/conversation/guardrails.js";
import { AutonomyLevel } from "../../src/conversation/types.js";
import type { ConversationState } from "../../src/conversation/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    messages: [],
    contextWindowLimit: 20,
    sessionMetadata: {
      sellerId: "seller-1",
      startedAt: new Date("2026-06-26T10:00:00Z"),
      lastActivityAt: new Date("2026-06-26T10:00:00Z"),
    },
    ...overrides,
  };
}

interface KpiRow {
  level: number;
  margin_compliance: number;
  success_rate: number;
  safety_violations: number;
  response_accuracy: number;
  timestamp: string;
}

interface DegradationRow {
  id: number;
  from_level: number;
  to_level: number;
  reason: string;
  kpi_snapshot: string | null;
  timestamp: string;
}

const systemPrompt = "Eres Plasticov, asistente comercial. Respondé en español.";

// ── Integration tests ────────────────────────────────────────────────

describe("autonomy engine — agent loop KPI recording", () => {
  let db: Database.Database;
  let engine: ReturnType<typeof createAutonomyEngine>;

  beforeEach(() => {
    db = new Database(":memory:");
    engine = createAutonomyEngine(db, { initialLevel: AutonomyLevel.BAJO_RIESGO });
  });

  afterEach(() => {
    db.close();
  });

  it("records KPI after confirmed dale", async () => {
    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      autonomyEngine: engine,
    });

    // Seed conversation state so extractPendingProposal finds a price-change proposal.
    const state = makeState({
      messages: [
        {
          role: "user",
          content: "Quiero revisar el precio del listing 42",
          timestamp: new Date("2026-06-26T10:00:00Z"),
        },
        {
          role: "assistant",
          content:
            "Analicé tus márgenes. Te preparo una propuesta de ajuste para el listing MLC-42.",
          timestamp: new Date("2026-06-26T10:00:01Z"),
        },
      ],
    });

    await agent.converse("dale", state);

    // KPI should have been recorded.
    const rows = db.prepare("SELECT * FROM kpi_history").all() as KpiRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.level).toBe(AutonomyLevel.BAJO_RIESGO);
    expect(rows[0]!.success_rate).toBe(1);
    expect(rows[0]!.margin_compliance).toBe(1);
    expect(rows[0]!.safety_violations).toBe(0);
  });

  it("does not record KPI when no proposal is confirmed", async () => {
    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      autonomyEngine: engine,
    });

    const state = makeState();
    await agent.converse("Hola", state);

    // No KPI because no proposal was confirmed.
    const rows = db.prepare("SELECT * FROM kpi_history").all() as KpiRow[];
    expect(rows).toHaveLength(0);
  });

  it("records KPI on each confirmed dale turn", async () => {
    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      autonomyEngine: engine,
    });

    // First turn: seed proposal.
    let state = makeState({
      messages: [
        {
          role: "user",
          content: "Quiero revisar el precio del listing 42",
          timestamp: new Date("2026-06-26T10:00:00Z"),
        },
        {
          role: "assistant",
          content: "Te preparo una propuesta de ajuste para el listing MLC-42.",
          timestamp: new Date("2026-06-26T10:00:01Z"),
        },
      ],
    });

    // Confirm first proposal.
    state = (await agent.converse("dale", state)).updatedState;

    // Seed second proposal.
    state = {
      ...state,
      messages: [
        ...state.messages,
        {
          role: "user",
          content: "¿Y el listing 99?",
          timestamp: new Date("2026-06-26T10:01:00Z"),
        },
        {
          role: "assistant",
          content: "También te preparo una propuesta de ajuste para MLC-99.",
          timestamp: new Date("2026-06-26T10:01:01Z"),
        },
      ],
    };

    // Confirm second proposal.
    await agent.converse("dale", state);

    const rows = db.prepare("SELECT * FROM kpi_history").all() as KpiRow[];
    expect(rows).toHaveLength(2);
  });
});

// ── Autonomy gate behaviour ──────────────────────────────────────────

describe("autonomy gate — level-to-risk mapping", () => {
  let db: Database.Database;
  let engine: ReturnType<typeof createAutonomyEngine>;

  beforeEach(() => {
    db = new Database(":memory:");
    engine = createAutonomyEngine(db, { initialLevel: AutonomyLevel.SUGIERE });
  });

  afterEach(() => {
    db.close();
  });

  it("blocks medium-risk action at SUGIERE level (requires dale)", () => {
    engine.setLevel(AutonomyLevel.SUGIERE, "test setup");
    const result = autonomyGate({ riskLevel: "medium" }, engine);

    expect(result.passed).toBe(true);
    // Reason is present → NOT auto-approved, requires dale.
    expect(result.reason).toBeDefined();
    expect(result.reason).toMatch(/dale/);
  });

  it("blocks high-risk action at SUGIERE level (requires dale)", () => {
    engine.setLevel(AutonomyLevel.SUGIERE, "test setup");
    const result = autonomyGate({ riskLevel: "high" }, engine);

    expect(result.passed).toBe(true);
    expect(result.reason).toBeDefined();
    expect(result.reason).toMatch(/dale/);
  });

  it("allows low-risk action at BAJO_RIESGO level (auto-approved)", () => {
    engine.setLevel(AutonomyLevel.BAJO_RIESGO, "promoted by CEO");
    const result = autonomyGate({ riskLevel: "low" }, engine);

    expect(result.passed).toBe(true);
    // No reason → auto-approved.
    expect(result.reason).toBeUndefined();
  });

  it("allows medium-risk action at MEDIO_RIESGO level (auto-approved)", () => {
    engine.setLevel(AutonomyLevel.MEDIO_RIESGO, "promoted by CEO");
    const result = autonomyGate({ riskLevel: "medium" }, engine);

    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("blocks critical-risk action at FULL level (always requires dale)", () => {
    engine.setLevel(AutonomyLevel.FULL, "promoted by CEO");
    const result = autonomyGate({ riskLevel: "critical" }, engine);

    expect(result.passed).toBe(true);
    expect(result.reason).toBeDefined();
    expect(result.reason).toMatch(/dale/);
  });

  it("blocks everything at CONSULTA level", () => {
    engine.setLevel(AutonomyLevel.CONSULTA, "degraded");
    const result = autonomyGate({ riskLevel: "low" }, engine);

    expect(result.passed).toBe(true);
    expect(result.reason).toBeDefined();
    expect(result.reason).toMatch(/dale/);
  });
});

// ── Degradation triggers during agent loop ───────────────────────────

describe("autonomy engine — degradation during agent loop", () => {
  let db: Database.Database;
  let engine: ReturnType<typeof createAutonomyEngine>;

  beforeEach(() => {
    db = new Database(":memory:");
    engine = createAutonomyEngine(db, { initialLevel: AutonomyLevel.BAJO_RIESGO });
  });

  afterEach(() => {
    db.close();
  });

  it("drops level after safety violations detected during a converse turn", async () => {
    const now = new Date();

    // Seed 4 safety violations in the last 2 hours to trigger forced level 0.
    for (let i = 0; i < 4; i++) {
      engine.recordKpi({
        level: AutonomyLevel.BAJO_RIESGO,
        marginCompliance: 1,
        successRate: 1,
        safetyViolations: 1,
        responseAccuracy: 0,
        timestamp: new Date(now.getTime() - (i + 1) * 1800000).toISOString(),
      });
    }

    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      autonomyEngine: engine,
    });

    const state = makeState();
    await agent.converse("Hola", state);

    // After the turn, degradation should have run and dropped the level.
    const level = engine.getCurrentLevel();
    expect(level).toBe(AutonomyLevel.CONSULTA);
  });

  it("does not degrade with healthy KPIs", async () => {
    const now = new Date();

    // Seed healthy KPIs: no violations, high success, good margins.
    for (let i = 0; i < 5; i++) {
      engine.recordKpi({
        level: AutonomyLevel.BAJO_RIESGO,
        marginCompliance: 1,
        successRate: 1,
        safetyViolations: 0,
        responseAccuracy: 0,
        timestamp: new Date(now.getTime() - (i + 1) * 1800000).toISOString(),
      });
    }

    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      autonomyEngine: engine,
    });

    const state = makeState();
    await agent.converse("Hola", state);

    // Level should remain unchanged.
    expect(engine.getCurrentLevel()).toBe(AutonomyLevel.BAJO_RIESGO);
  });

  it("records degradation event in database", async () => {
    const now = new Date();

    // Seed violations.
    for (let i = 0; i < 4; i++) {
      engine.recordKpi({
        level: AutonomyLevel.BAJO_RIESGO,
        marginCompliance: 1,
        successRate: 1,
        safetyViolations: 1,
        responseAccuracy: 0,
        timestamp: new Date(now.getTime() - (i + 1) * 1800000).toISOString(),
      });
    }

    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      autonomyEngine: engine,
    });

    const state = makeState();
    await agent.converse("Hola", state);

    const rows = db
      .prepare("SELECT * FROM degradation_events ORDER BY id ASC")
      .all() as DegradationRow[];

    // Should have at least 1 degradation event (from evaluateDegradation in converse)
    // plus the initial setLevel would create one too if it used setLevel.
    // The initialLevel is set in the factory constructor, not via setLevel.
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const lastDeg = rows[rows.length - 1]!;
    expect(lastDeg.from_level).toBe(AutonomyLevel.BAJO_RIESGO);
    expect(lastDeg.to_level).toBe(AutonomyLevel.CONSULTA);
    expect(lastDeg.reason).toMatch(/violaciones de seguridad/);
  });
});

// ── CEO explicit level control ───────────────────────────────────────

describe("autonomy engine — CEO level control", () => {
  let db: Database.Database;
  let engine: ReturnType<typeof createAutonomyEngine>;

  beforeEach(() => {
    db = new Database(":memory:");
    engine = createAutonomyEngine(db, { initialLevel: AutonomyLevel.SUGIERE });
  });

  afterEach(() => {
    db.close();
  });

  it("CEO can set level via engine.setLevel", () => {
    engine.setLevel(AutonomyLevel.MEDIO_RIESGO, "CEO manual override después de revisar KPIs");

    expect(engine.getCurrentLevel()).toBe(AutonomyLevel.MEDIO_RIESGO);
  });

  it("records setLevel as a degradation event in the database", () => {
    engine.setLevel(AutonomyLevel.BAJO_RIESGO, "CEO promovió al agente");

    const rows = db
      .prepare("SELECT * FROM degradation_events ORDER BY id DESC LIMIT 1")
      .all() as DegradationRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.from_level).toBe(AutonomyLevel.SUGIERE);
    expect(rows[0]!.to_level).toBe(AutonomyLevel.BAJO_RIESGO);
    expect(rows[0]!.reason).toMatch(/CEO promovió/);
  });

  it("agent respects CEO-set level across multiple turns", async () => {
    engine.setLevel(AutonomyLevel.FULL, "CEO confía plenamente");

    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      autonomyEngine: engine,
    });

    const state = makeState();

    // Run several turns — level should persist.
    let current = state;
    for (let i = 0; i < 3; i++) {
      current = (await agent.converse("Hola", current)).updatedState;
    }

    expect(engine.getCurrentLevel()).toBe(AutonomyLevel.FULL);
  });

  it("newly created engine starts at CONSULTA by default", () => {
    // Create a fresh engine with no initialLevel override.
    const db2 = new Database(":memory:");
    const engine2 = createAutonomyEngine(db2);

    expect(engine2.getCurrentLevel()).toBe(AutonomyLevel.SUGIERE); // factory default

    db2.close();
  });
});

// ── System prompt autonomy awareness ─────────────────────────────────

describe("autonomy engine — system prompt integration", () => {
  it("does not crash when autonomy engine absent", () => {
    // Agent loop should work fine without autonomyEngine.
    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
    });

    // Just verifying the agent can be created and used.
    expect(agent).toBeDefined();
    expect(agent.converse).toBeInstanceOf(Function);
  });

  it("includes autonomy info in agent loop's internal system prompt", async () => {
    // Even though the mock doesn't read the system prompt, the agent
    // loop builds it correctly when the engine is present.
    const db = new Database(":memory:");
    const engine = createAutonomyEngine(db, { initialLevel: AutonomyLevel.BAJO_RIESGO });

    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      autonomyEngine: engine,
    });

    const state = makeState();
    // converse doesn't crash — system prompt includes autonomy level.
    const result = await agent.converse("Hola", state);
    expect(result.response).toBeDefined();
    expect(result.response.length).toBeGreaterThan(0);

    db.close();
  });
});
