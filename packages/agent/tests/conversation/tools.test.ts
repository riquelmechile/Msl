import Database from "better-sqlite3";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { GraphEngine, createGraphEngine } from "@msl/memory";

import {
  createGetBusinessContextTool,
  createPrepareActionTool,
} from "../../src/conversation/tools.js";
import type { ToolDefinition } from "../../src/conversation/tools.js";

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
    expect(tool.description).toMatch(/contexto del negocio/i);
  });

  it("has valid parameters schema with required 'query'", () => {
    const params = tool.parameters as Record<string, unknown>;
    expect(params.type).toBe("object");
    const props = params.properties as Record<string, unknown>;
    expect(props).toHaveProperty("query");
    const required = params.required as string[];
    expect(required).toContain("query");
  });

  it("returns empty context when graph has no matching nodes", async () => {
    const result = await tool.execute({ query: "ventas" });
    expect(result).toHaveProperty("context");
    expect(result).toHaveProperty("node_count", 0);
  });

  it("returns error when query is missing or empty", async () => {
    const result = await tool.execute({});
    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/obligatorio|query/i);
  });

  it("returns TraversalResult.context when graph has matching nodes", async () => {
    engine.createNode("ventas_diarias", { total: 500000 });
    engine.createNode("margen", { valor: 32 });
    const a = engine.createNode("a", {});
    const b = engine.createNode("b", {});
    engine.createEdge(a.id, b.id);

    const result = await tool.execute({ query: "ventas margen" });

    // TraversalResult.context is a flat Record<string, unknown>.
    expect(result).toHaveProperty("activated_nodes");
    expect(result).toHaveProperty("node_count");
    expect((result as Record<string, unknown>).node_count).toBeGreaterThan(0);
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
    const params = tool.parameters as Record<string, unknown>;
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
