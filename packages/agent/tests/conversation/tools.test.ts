import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { GraphEngine, createGraphEngine } from "@msl/memory";

import {
  createGetBusinessContextTool,
  createPrepareActionTool,
  createSimulateActorTool,
  createDetectProbesTool,
  createProposeHoneyPotTool,
} from "../../src/conversation/tools.js";
import type { ToolDefinition } from "../../src/conversation/tools.js";
import type { DecoyProposal, ProbeAlert, Strategy } from "../../src/conversation/types.js";
import type { GuardResult } from "../../src/conversation/guardrails.js";
import { simulateActor } from "../../src/conversation/actorSimulator.js";

describe("createGetBusinessContextTool", () => {
  let engine: GraphEngine;
  let tool: ToolDefinition;

  beforeEach(() => {
    engine = createGraphEngine();
    tool = createGetBusinessContextTool(engine);
  });

  afterEach(() => {
    engine.db.close();
  });

  it("has correct name and description", () => {
    expect(tool.name).toBe("get_business_context");
    expect(tool.description).toMatch(/negocio/i);
  });

  it("has valid parameters schema with dataType enum and no required fields", () => {
    const params = tool.parameters;
    expect(params.type).toBe("object");
    const props = params.properties as Record<string, unknown>;
    expect(props).toHaveProperty("dataType");
    expect(props).toHaveProperty("status");
    expect(props).toHaveProperty("categoryId");
    expect(props).toHaveProperty("sellerId");
    expect(props).toHaveProperty("itemId");
    expect(props).toHaveProperty("months");

    const dataTypeProp = props.dataType as Record<string, unknown>;
    expect(dataTypeProp.enum).toEqual([
      "listings",
      "visits",
      "orders",
      "seasonal",
      "cross_account",
      "all",
    ]);

    const statusProp = props.status as Record<string, unknown>;
    expect(statusProp.enum).toEqual(["active", "paused", "closed"]);

    // required is explicitly an empty array (all fields are optional).
    const required = params.required as string[] | undefined;
    expect(required).toEqual([]);
  });

  it("returns empty context when graph has no matching nodes", async () => {
    const result = await tool.execute({ dataType: "all" });
    expect(result).toHaveProperty("context");
    expect(result).toHaveProperty("metadata");
    const ctx = result.context as Record<string, unknown>;
    expect(ctx).toHaveProperty("listings");
    expect(ctx).toHaveProperty("visits");
    expect(ctx).toHaveProperty("orders");
    expect(ctx).toHaveProperty("seasonal");
    expect(ctx).toHaveProperty("cross_account");
    const listings = ctx.listings as Record<string, unknown>;
    expect(listings.total).toBe(0);
  });

  it("returns structured listings data when Cortex has listing snapshots", async () => {
    const item1 = engine.createNode("listing_snapshot_MLC1_2026-07-01", {
      type: "listing_snapshot",
      itemId: "MLC1",
      sellerId: "plasticov",
      status: "active",
      categoryId: "MLC1743",
      price: 15000,
      capturedAt: new Date().toISOString(),
    });
    engine.createNode("listing_snapshot_MLC2_2026-07-01", {
      type: "listing_snapshot",
      itemId: "MLC2",
      sellerId: "plasticov",
      status: "paused",
      categoryId: "MLC1743",
      price: 25000,
      capturedAt: new Date().toISOString(),
    });

    const result = await tool.execute({ dataType: "listings" });
    expect(result).toHaveProperty("context");
    expect(result).toHaveProperty("metadata");

    const ctx = result.context as Record<string, unknown>;
    const listings = ctx.listings as Record<string, unknown>;
    expect(listings.total).toBe(2);
    expect(listings.byStatus).toEqual({ active: 1, paused: 1 });
    expect(listings.byCategory).toEqual({ MLC1743: 2 });
    expect(listings.avgPrice).toBe(20000);
  });

  it("filters listings by sellerId", async () => {
    engine.createNode("listing_snapshot_p_2026-07-01", {
      type: "listing_snapshot",
      itemId: "MLC1",
      sellerId: "plasticov",
      status: "active",
      capturedAt: new Date().toISOString(),
    });
    engine.createNode("listing_snapshot_m_2026-07-01", {
      type: "listing_snapshot",
      itemId: "MLC2",
      sellerId: "maustian",
      status: "active",
      capturedAt: new Date().toISOString(),
    });

    const result = await tool.execute({ dataType: "listings", sellerId: "plasticov" });
    const ctx = result.context as Record<string, unknown>;
    const listings = ctx.listings as Record<string, unknown>;
    expect(listings.total).toBe(1);
  });

  it("returns structured visits data when Cortex has visit snapshots", async () => {
    engine.createNode("visit_snapshot_MLC1_2026-07-01", {
      type: "visit_snapshot",
      itemId: "MLC1",
      sellerId: "plasticov",
      totalVisits: 100,
      capturedAt: "2026-06-30T00:00:00.000Z",
    });
    engine.createNode("visit_snapshot_MLC1_2026-07-02", {
      type: "visit_snapshot",
      itemId: "MLC1",
      sellerId: "plasticov",
      totalVisits: 150,
      capturedAt: "2026-07-01T00:00:00.000Z",
    });

    const result = await tool.execute({ dataType: "visits" });
    const ctx = result.context as Record<string, unknown>;
    const visits = ctx.visits as Record<string, unknown>;
    expect(visits.total).toBe(1);
    const items = visits.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]!.itemId).toBe("MLC1");
    expect(items[0]!.trend).toBe("up");
  });

  it("returns structured orders data when Cortex has order snapshots", async () => {
    engine.createNode("order_snapshot_plasticov_2026-07-01", {
      type: "order_snapshot",
      sellerId: "plasticov",
      totalOrders: 5,
      totalAmount: 50000,
      categoryBreakdown: [
        { categoryId: "MLC1743", orderCount: 3, totalAmount: 30000 },
        { categoryId: "MLC1234", orderCount: 2, totalAmount: 20000 },
      ],
      capturedAt: new Date().toISOString(),
    });

    const result = await tool.execute({ dataType: "orders" });
    const ctx = result.context as Record<string, unknown>;
    const orders = ctx.orders as Record<string, unknown>;
    expect(orders.totalOrders).toBe(5);
    expect(orders.totalAmount).toBe(50000);

    const byCategory = orders.byCategory as Record<string, { orderCount: number; totalAmount: number }>;
    expect(byCategory.MLC1743).toBeDefined();
    expect(byCategory.MLC1743!.orderCount).toBe(3);
  });

  it("returns cross-account comparison with both sellers", async () => {
    engine.createNode("listing_snapshot_p_2026-07-01", {
      type: "listing_snapshot",
      itemId: "MLC1",
      sellerId: "plasticov",
      status: "active",
      categoryId: "MLC1743",
      price: 15000,
      capturedAt: new Date().toISOString(),
    });
    engine.createNode("listing_snapshot_m_2026-07-01", {
      type: "listing_snapshot",
      itemId: "MLC2",
      sellerId: "maustian",
      status: "active",
      categoryId: "MLC1743",
      price: 20000,
      capturedAt: new Date().toISOString(),
    });

    const result = await tool.execute({ dataType: "cross_account" });
    const ctx = result.context as Record<string, unknown>;
    const cross = ctx.cross_account as Record<string, unknown>;

    const plasticov = cross.plasticov as Record<string, unknown>;
    const maustian = cross.maustian as Record<string, unknown>;

    expect(plasticov.total).toBe(1);
    expect(maustian.total).toBe(1);
  });

  it("defaults to dataType 'all' when dataType is missing", async () => {
    const result = await tool.execute({});
    expect(result).toHaveProperty("context");
    expect(result).toHaveProperty("metadata");
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.dataType).toBe("all");
  });

  it("respects the months parameter for time window", async () => {
    const result = await tool.execute({ dataType: "orders", months: 1 });
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.months).toBe(1);
  });
});

describe("createPrepareActionTool", () => {
  let tool: ToolDefinition;

  beforeEach(() => {
    tool = createPrepareActionTool();
  });

  it("has correct name and description", () => {
    expect(tool.name).toBe("prepare_action");
    expect(tool.description).toMatch(/acción concreta/i);
    expect(tool.description).toMatch(/dale/i);
  });

  it("has valid parameters schema with required fields", () => {
    const params = tool.parameters;
    expect(params.type).toBe("object");

    const props = params.properties as Record<string, unknown>;
    expect(props).toHaveProperty("kind");
    expect(props).toHaveProperty("targetType");
    expect(props).toHaveProperty("targetId");
    expect(props).toHaveProperty("field");
    expect(props).toHaveProperty("rationale");
    expect(props).toHaveProperty("summary");

    const required = params.required as string[];
    expect(required).toContain("kind");
    expect(required).toContain("rationale");
  });

  it("maps description to AgentProposal with domain-derived risk level", () => {
    const result = tool.execute({
      id: "prop-001",
      sellerId: "seller-1",
      kind: "price-change",
      targetType: "listing",
      targetId: "MLC-42",
      field: "price",
      fromValue: 15000,
      toValue: 13500,
      rationale: "Competencia bajó 10%.",
      summary: "¿Bajo el precio del listing MLC-42 en 10%?",
    }) as Record<string, unknown>;

    // Shape check: AgentProposal fields should be present.
    expect(result).toHaveProperty("action");
    expect(result).toHaveProperty("naturalSummary");
    expect(result).toHaveProperty("riskLevel");

    // Domain-derived risk for price-change is "medium".
    expect(result.riskLevel).toBe("medium");

    const action = result.action as Record<string, unknown>;
    expect(action.kind).toBe("price-change");
    expect(action.rationale).toBe("Competencia bajó 10%.");
    expect(action).toHaveProperty("expiresAt");
  });

  it("assigns 'high' risk for refund kind per domain rules", () => {
    const result = tool.execute({
      id: "prop-002",
      sellerId: "seller-1",
      kind: "refund",
      targetType: "order",
      targetId: "order-99",
      field: "status",
      fromValue: "pending",
      toValue: "refunded",
      rationale: "Cliente no recibió el producto.",
      summary: "¿Proceso el reembolso de la orden #order-99?",
    }) as Record<string, unknown>;

    expect(result.riskLevel).toBe("high");
  });

  it("builds the correct ActionTarget from targetType and targetId", () => {
    const result = tool.execute({
      id: "prop-003",
      sellerId: "seller-1",
      kind: "customer-message",
      targetType: "message",
      targetId: "thread-5",
      field: "body",
      fromValue: "",
      toValue: "Gracias por tu consulta.",
      rationale: "Responder consulta de cliente.",
      summary: "¿Envío respuesta al hilo thread-5?",
    }) as Record<string, unknown>;

    const action = result.action as Record<string, unknown>;
    const target = action.target as Record<string, unknown>;
    expect(target.type).toBe("message");
    expect(target.threadId).toBe("thread-5");
  });

  it("includes expiresAt set 24 hours from now", () => {
    const before = new Date();
    const result = tool.execute({
      id: "prop-004",
      sellerId: "seller-1",
      kind: "stock-change",
      targetType: "listing",
      targetId: "MLC-99",
      field: "stock",
      fromValue: 5,
      toValue: 10,
      rationale: "Reponer stock.",
      summary: "¿Aumento el stock?",
    }) as Record<string, unknown>;

    const action = result.action as Record<string, unknown>;
    const expiresAt = new Date(action.expiresAt as string);
    const diffMs = expiresAt.getTime() - before.getTime();
    // Should be roughly 24h (allow some slack for test execution time).
    expect(diffMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThan(25 * 60 * 60 * 1000);
  });
});

// ── createSimulateActorTool ─────────────────────────────────────────

describe("createSimulateActorTool", () => {
  let tool: ToolDefinition;

  beforeEach(() => {
    tool = createSimulateActorTool(simulateActor);
  });

  it("has correct name and description", () => {
    expect(tool.name).toBe("simulate_actor");
    expect(tool.description).toMatch(/simula el comportamiento/i);
  });

  it("has valid parameters schema with required fields", () => {
    const params = tool.parameters;
    expect(params.type).toBe("object");

    const props = params.properties as Record<string, unknown>;
    expect(props).toHaveProperty("actorType");
    expect(props).toHaveProperty("query");

    const required = params.required as string[];
    expect(required).toContain("actorType");
    expect(required).toContain("query");
  });

  it("has actorType enum with valid values", () => {
    const params = tool.parameters;
    const props = params.properties as Record<string, unknown>;
    const actorTypeSchema = props.actorType as Record<string, unknown>;

    expect(actorTypeSchema.type).toBe("string");
    expect(actorTypeSchema.enum).toEqual(["comprador", "proveedor", "competidor"]);
  });

  it("calls simulator and returns SimulationResult", async () => {
    const result = await tool.execute({
      actorType: "comprador",
      query: "¿Comprarías a $15.000?",
    });

    expect(result).toHaveProperty("actorType", "comprador");
    expect(result).toHaveProperty("recommendation");
    expect(result).toHaveProperty("confidence", 0.85);
    expect(result).toHaveProperty("simulationId");
    expect(result).toHaveProperty("rationale");
    expect(result.simulationId).toMatch(/^sim-/);
  });

  it("returns error for invalid actorType", async () => {
    const result = await tool.execute({
      actorType: "desconocido",
      query: "test query",
    });

    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/no válido/i);
  });

  it("returns error for empty query", async () => {
    const result = await tool.execute({
      actorType: "comprador",
      query: "",
    });

    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/obligatorio|vacío/i);
  });

  it("returns error for missing query", async () => {
    const result = await tool.execute({
      actorType: "proveedor",
    });

    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/obligatorio|vacío/i);
  });

  it("returns proveedor SimulationResult for valid call", async () => {
    const result = await tool.execute({
      actorType: "proveedor",
      query: "¿Tenés stock para 100 unidades?",
    });

    expect(result).toHaveProperty("actorType", "proveedor");
    expect(result).toHaveProperty("recommendation");
    expect(result).toHaveProperty("confidence", 0.85);
    expect(result.recommendation).toMatch(/proveedor/i);
  });

  it("returns competidor SimulationResult for valid call", async () => {
    const result = await tool.execute({
      actorType: "competidor",
      query: "¿Cómo reaccionarías si bajo precios?",
    });

    expect(result).toHaveProperty("actorType", "competidor");
    expect(result).toHaveProperty("recommendation");
    expect(result).toHaveProperty("confidence", 0.85);
    expect(result.recommendation).toMatch(/competidor/i);
  });
});

// ── createDetectProbesTool ──────────────────────────────────────────

describe("createDetectProbesTool", () => {
  function makeDetector(
    alerts: ProbeAlert[] = [],
  ): (
    questions?: Array<{ text: string; from: string; date: string }>,
    views?: Array<{ count: number; date: string }>,
  ) => ProbeAlert[] {
    return () => alerts;
  }

  it("has correct name and description", () => {
    const tool = createDetectProbesTool(makeDetector());
    expect(tool.name).toBe("detect_probes");
    expect(tool.description).toMatch(/contrainteligencia/i);
  });

  it("has valid parameters schema with optional questions and views", () => {
    const tool = createDetectProbesTool(makeDetector());
    const params = tool.parameters;
    expect(params.type).toBe("object");
    const props = params.properties as Record<string, unknown>;
    expect(props).toHaveProperty("questions");
    expect(props).toHaveProperty("views");
    // Neither required.
    const required = params.required as string[] | undefined;
    expect(required).toBeUndefined();
  });

  it("returns error when neither questions nor views provided", () => {
    const tool = createDetectProbesTool(makeDetector());
    const result = tool.execute({});
    expect(result).toHaveProperty("error");
    expect((result as Record<string, unknown>).error).toMatch(/requiere/i);
  });

  it("returns empty alerts when detector finds nothing", () => {
    const tool = createDetectProbesTool(makeDetector([]));
    const result = tool.execute({
      questions: [{ text: "Hola", from: "X", date: "2026-06-26" }],
    });
    expect(result).toHaveProperty("alerts");
    expect(result).toHaveProperty("count", 0);
    expect((result as Record<string, unknown>).alerts).toEqual([]);
  });

  it("returns alerts when detector finds suspicious patterns", () => {
    const sampleAlert: ProbeAlert = {
      pattern: "question_spike",
      confidence: 0.75,
      competitorId: "TiendaX",
      description: "Posible sondeo detectado.",
      recommendedAction: "monitor",
    };
    const tool = createDetectProbesTool(makeDetector([sampleAlert]));
    const result = tool.execute({
      questions: [{ text: "¿Precio?", from: "X", date: "2026-06-26" }],
    });
    expect(result).toHaveProperty("count", 1);
    const alerts = (result as Record<string, unknown>).alerts as ProbeAlert[];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.pattern).toBe("question_spike");
    expect(alerts[0]!.competitorId).toBe("TiendaX");
  });

  it("accepts both questions and views simultaneously", () => {
    const questionAlert: ProbeAlert = {
      pattern: "price_reaction",
      confidence: 0.7,
      description: "Preguntas de precio.",
    };
    const viewAlert: ProbeAlert = {
      pattern: "view_anomaly",
      confidence: 0.8,
      description: "Pico de vistas.",
    };
    const detector = (
      q?: Array<{ text: string; from: string; date: string }>,
      v?: Array<{ count: number; date: string }>,
    ) => {
      const alerts: ProbeAlert[] = [];
      if (q && q.length > 0) alerts.push(questionAlert);
      if (v && v.length > 0) alerts.push(viewAlert);
      return alerts;
    };
    const tool = createDetectProbesTool(detector);
    const result = tool.execute({
      questions: [{ text: "¿Precio?", from: "X", date: "2026-06-26" }],
      views: [{ count: 500, date: "2026-06-26" }],
    });
    expect(result).toHaveProperty("count", 2);
  });
});

// ── createProposeHoneyPotTool ───────────────────────────────────────

describe("createProposeHoneyPotTool", () => {
  function makeProbeStrategy(overrides: Partial<Strategy> = {}): Strategy {
    return {
      id: 1,
      ruleType: "probe",
      ruleText: "probá electrónica",
      parsedRule: {
        ruleType: "probe",
        target: "categoría",
        operator: "probá",
        value: "electrónica",
        priority: 5,
        originalText: "probá electrónica",
      },
      confidence: 1.0,
      status: "active",
      createdAt: "2026-06-26T10:00:00Z",
      updatedAt: "2026-06-26T10:00:00Z",
      ...overrides,
    };
  }

  function makeProposal(): DecoyProposal {
    return {
      id: "decoy-001",
      type: "category_entry",
      description: "Listing señuelo en electrónica.",
      riskLevel: "medium",
      tosCompliant: true,
      tosWarning: "⚠️ Términos de Servicio.",
    };
  }

  function makePassingValidator(): (
    proposal: DecoyProposal,
    strategies: Strategy[],
  ) => GuardResult {
    return () => ({ passed: true });
  }

  function makeBlockingValidator(
    reason: string,
  ): (proposal: DecoyProposal, strategies: Strategy[]) => GuardResult {
    return () => ({ passed: false, reason });
  }

  it("has correct name and description", () => {
    const tool = createProposeHoneyPotTool(
      () => makeProposal(),
      makePassingValidator(),
      () => [makeProbeStrategy()],
    );
    expect(tool.name).toBe("propose_honey_pot");
    expect(tool.description).toMatch(/contrainteligencia/i);
  });

  it("has valid parameters schema with required strategyId", () => {
    const tool = createProposeHoneyPotTool(
      () => makeProposal(),
      makePassingValidator(),
      () => [makeProbeStrategy()],
    );
    const params = tool.parameters;
    expect(params.type).toBe("object");
    const required = params.required as string[];
    expect(required).toContain("strategyId");
  });

  it("returns error when strategyId is not a number", () => {
    const tool = createProposeHoneyPotTool(
      () => makeProposal(),
      makePassingValidator(),
      () => [makeProbeStrategy()],
    );
    const result = tool.execute({ strategyId: "abc" });
    expect(result).toHaveProperty("error");
    expect((result as Record<string, unknown>).error).toMatch(/número/i);
  });

  it("returns error when strategy not found", () => {
    const tool = createProposeHoneyPotTool(
      () => makeProposal(),
      makePassingValidator(),
      () => [makeProbeStrategy()],
    );
    const result = tool.execute({ strategyId: 999 });
    expect(result).toHaveProperty("error");
    expect((result as Record<string, unknown>).error).toMatch(/999/);
  });

  it("returns error when strategy is not probe type", () => {
    const marginStrategy: Strategy = {
      ...makeProbeStrategy(),
      id: 1,
      ruleType: "margin",
      ruleText: "margen mínimo 50%",
      parsedRule: {
        ruleType: "margin",
        target: "margen",
        operator: ">=",
        value: "50%",
        priority: 5,
        originalText: "margen mínimo 50%",
      },
    };
    const tool = createProposeHoneyPotTool(
      () => makeProposal(),
      makePassingValidator(),
      () => [marginStrategy],
    );
    const result = tool.execute({ strategyId: 1 });
    expect(result).toHaveProperty("error");
    expect((result as Record<string, unknown>).error).toMatch(/margin/);
  });

  it("returns decoy proposal when guardrail passes", () => {
    const tool = createProposeHoneyPotTool(
      () => makeProposal(),
      makePassingValidator(),
      () => [makeProbeStrategy()],
    );
    const result = tool.execute({ strategyId: 1 });
    expect(result).toHaveProperty("id", "decoy-001");
    expect(result).toHaveProperty("type");
    expect(result).toHaveProperty("tosWarning");
    expect(result).not.toHaveProperty("error");
  });

  it("returns blocked error when guardrail blocks", () => {
    const tool = createProposeHoneyPotTool(
      () => makeProposal(),
      makeBlockingValidator("No tenés estrategias de contrainteligencia activas."),
      () => [makeProbeStrategy()],
    );
    const result = tool.execute({ strategyId: 1 });
    expect(result).toHaveProperty("error");
    expect((result as Record<string, unknown>).error).toMatch(/contrainteligencia/);
  });

  it("calls onProposed callback when guardrail passes", () => {
    let captured: DecoyProposal | null = null;
    const tool = createProposeHoneyPotTool(
      () => makeProposal(),
      makePassingValidator(),
      () => [makeProbeStrategy()],
      (proposal) => {
        captured = proposal;
      },
    );
    void tool.execute({ strategyId: 1 });
    expect(captured).not.toBeNull();
    expect(captured!.id).toBe("decoy-001");
  });

  it("does NOT call onProposed callback when guardrail blocks", () => {
    let captured: DecoyProposal | null = null;
    const tool = createProposeHoneyPotTool(
      () => makeProposal(),
      makeBlockingValidator("Bloqueado."),
      () => [makeProbeStrategy()],
      (proposal) => {
        captured = proposal;
      },
    );
    void tool.execute({ strategyId: 1 });
    expect(captured).toBeNull();
  });

  it("skips archived strategies", () => {
    const archived = makeProbeStrategy({ status: "archived", id: 1 });
    const active = makeProbeStrategy({
      status: "active",
      id: 2,
      parsedRule: {
        ...makeProbeStrategy().parsedRule,
        value: "ropa",
      },
    });
    const tool = createProposeHoneyPotTool(
      () => makeProposal(),
      makePassingValidator(),
      () => [archived, active],
    );
    // Try to use archived strategy.
    const result = tool.execute({ strategyId: 1 });
    expect(result).toHaveProperty("error");
    // Try active strategy.
    const result2 = tool.execute({ strategyId: 2 });
    expect(result2).not.toHaveProperty("error");
  });
});
