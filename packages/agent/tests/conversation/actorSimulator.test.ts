import { describe, expect, it } from "vitest";
import {
  simulateActor,
  getActorPrompt,
  simulateCounterintelligence,
  COMPRADOR_PROMPT,
  PROVEEDOR_PROMPT,
  COMPETIDOR_PROMPT,
} from "../../src/conversation/actorSimulator.js";
import type { ActorType, SimulationResult } from "../../src/conversation/types.js";

// ── getActorPrompt ──────────────────────────────────────────────────

describe("getActorPrompt", () => {
  it("returns COMPRADOR_PROMPT for 'comprador'", () => {
    expect(getActorPrompt("comprador")).toBe(COMPRADOR_PROMPT);
  });

  it("returns PROVEEDOR_PROMPT for 'proveedor'", () => {
    expect(getActorPrompt("proveedor")).toBe(PROVEEDOR_PROMPT);
  });

  it("returns COMPETIDOR_PROMPT for 'competidor'", () => {
    expect(getActorPrompt("competidor")).toBe(COMPETIDOR_PROMPT);
  });

  it("throws for invalid actor type", () => {
    expect(() => getActorPrompt("unknown" as ActorType)).toThrow(
      /no válido/i,
    );
  });

  it("error message lists valid actor types", () => {
    expect(() => getActorPrompt("unknown" as ActorType)).toThrow(
      /comprador.*proveedor.*competidor/i,
    );
  });
});

// ── simulateActor ───────────────────────────────────────────────────

describe("simulateActor", () => {
  // ── Comprador ───────────────────────────────────────────────

  it("returns realistic Spanish response for comprador", async () => {
    const result = await simulateActor(
      "comprador",
      "¿Comprarías a $15.000?",
    );

    expect(result.actorType).toBe("comprador");
    expect(result.recommendation).toMatch(/comprador/i);
    expect(result.recommendation).toBeTruthy();
    expect(result.rationale).toBeTruthy();
    expect(result.confidence).toBe(0.85);
    expect(result.simulationId).toMatch(/^sim-/);
  });

  it("returns price-aware response for comprador with price query", async () => {
    const result = await simulateActor("comprador", "precio $15.000");

    expect(result.recommendation).toMatch(/precio|competitivo/i);
    expect(result.actorType).toBe("comprador");
  });

  it("returns reputation-aware response for comprador with reputation query", async () => {
    const result = await simulateActor(
      "comprador",
      "reputación y opiniones del vendedor",
    );

    expect(result.recommendation).toMatch(/reputación|opiniones/i);
    expect(result.actorType).toBe("comprador");
  });

  // ── Proveedor ───────────────────────────────────────────────

  it("returns realistic Spanish response for proveedor", async () => {
    const result = await simulateActor(
      "proveedor",
      "¿Tenés stock para 100 unidades?",
    );

    expect(result.actorType).toBe("proveedor");
    expect(result.recommendation).toMatch(/proveedor/i);
    expect(result.recommendation).toBeTruthy();
    expect(result.rationale).toBeTruthy();
    expect(result.confidence).toBe(0.85);
    expect(result.simulationId).toMatch(/^sim-/);
  });

  it("returns discount response for proveedor with volume query", async () => {
    const result = await simulateActor(
      "proveedor",
      "necesito volumen de 200 unidades",
    );

    expect(result.recommendation).toMatch(/descuento|volumen/i);
    expect(result.actorType).toBe("proveedor");
  });

  it("returns delivery-aware response for proveedor with time query", async () => {
    const result = await simulateActor(
      "proveedor",
      "¿cuál es el tiempo de entrega?",
    );

    expect(result.recommendation).toMatch(/entrega|días/i);
    expect(result.actorType).toBe("proveedor");
  });

  // ── Competidor ──────────────────────────────────────────────

  it("returns realistic Spanish response for competidor", async () => {
    const result = await simulateActor(
      "competidor",
      "¿Reaccionarías si bajo precios?",
    );

    expect(result.actorType).toBe("competidor");
    expect(result.recommendation).toMatch(/competidor/i);
    expect(result.recommendation).toBeTruthy();
    expect(result.rationale).toBeTruthy();
    expect(result.confidence).toBe(0.85);
    expect(result.simulationId).toMatch(/^sim-/);
  });

  it("returns market-aware response for competidor with market query", async () => {
    const result = await simulateActor(
      "competidor",
      "¿cómo está la competencia en la categoría?",
    );

    expect(result.recommendation).toMatch(/competidor|mercado|categoría/i);
    expect(result.actorType).toBe("competidor");
  });

  // ── Validation ──────────────────────────────────────────────

  it("throws for invalid actor type", async () => {
    await expect(
      simulateActor("unknown" as ActorType, "test query"),
    ).rejects.toThrow(/no válido/i);
  });

  it("throws for empty query", async () => {
    await expect(simulateActor("comprador", "")).rejects.toThrow(
      /query.*vacío/i,
    );
  });

  it("throws for whitespace-only query", async () => {
    await expect(simulateActor("proveedor", "   ")).rejects.toThrow(
      /query.*vacío/i,
    );
  });

  // ── Id uniqueness ───────────────────────────────────────────

  it("generates unique simulationIds for different calls", async () => {
    const r1: SimulationResult = await simulateActor(
      "comprador",
      "precio",
    );
    const r2: SimulationResult = await simulateActor(
      "comprador",
      "reputación",
    );

    expect(r1.simulationId).not.toBe(r2.simulationId);
  });

  // ── Response variation ──────────────────────────────────────

  it("gives different recommendations for different queries to same actor", async () => {
    const r1 = await simulateActor("comprador", "precio $15.000");
    const r2 = await simulateActor(
      "comprador",
      "reputación del vendedor",
    );

    expect(r1.recommendation).not.toBe(r2.recommendation);
  });

  it("includes query context in rationale", async () => {
    const result = await simulateActor("competidor", "bajé el precio 10%");

    expect(result.rationale).toContain("bajé el precio 10%");
  });

  // ── Confidence ──────────────────────────────────────────────

  it("always returns confidence 0.85 for mock", async () => {
    const results = await Promise.all([
      simulateActor("comprador", "precio"),
      simulateActor("proveedor", "stock"),
      simulateActor("competidor", "mercado"),
    ]);

    for (const r of results) {
      expect(r.confidence).toBe(0.85);
    }
  });

  // ── agentConfig acceptance ──────────────────────────────────

  it("accepts agentConfig parameter without error", async () => {
    const result = await simulateActor(
      "comprador",
      "precio",
      { systemPrompt: "custom prompt" },
    );

    expect(result).toHaveProperty("actorType", "comprador");
    expect(result).toHaveProperty("recommendation");
    // agentConfig is accepted but unused in mock mode.
  });
});

// ── simulateCounterintelligence ──────────────────────────────────────

describe("simulateCounterintelligence", () => {
  it("works with 'competidor' actor type", () => {
    const result = simulateCounterintelligence(
      "competidor",
      "¿está monitoreando mis precios?",
    );

    expect(result.actorType).toBe("competidor");
    expect(result.recommendation).toBeTruthy();
    expect(result.rationale).toBeTruthy();
    expect(result.confidence).toBe(0.8);
    expect(result.simulationId).toMatch(/^sim-/);
  });

  it("throws for 'comprador' actor type", () => {
    expect(() =>
      simulateCounterintelligence("comprador", "test query"),
    ).toThrow(/competidor/i);
  });

  it("throws for 'proveedor' actor type", () => {
    expect(() =>
      simulateCounterintelligence("proveedor", "test query"),
    ).toThrow(/competidor/i);
  });

  it("throws for empty query", () => {
    expect(() => simulateCounterintelligence("competidor", "")).toThrow(
      /query.*vacío/i,
    );
  });

  it("throws for whitespace-only query", () => {
    expect(() => simulateCounterintelligence("competidor", "   ")).toThrow(
      /query.*vacío/i,
    );
  });

  it("returns price-monitoring detection for monitoring query", () => {
    const result = simulateCounterintelligence(
      "competidor",
      "¿está monitoreando mis precios?",
    );

    expect(result.recommendation).toMatch(/price-dumping|reportarte/i);
    expect(result.actorType).toBe("competidor");
  });

  it("returns decoy-listing verification for señuelo listing query", () => {
    const result = simulateCounterintelligence(
      "competidor",
      "¿reaccionaría a un listing señuelo?",
    );

    expect(result.recommendation).toMatch(/verifico|señuelo/i);
    expect(result.actorType).toBe("competidor");
  });

  it("returns different responses for different queries", () => {
    const r1 = simulateCounterintelligence(
      "competidor",
      "¿está monitoreando mis precios?",
    );
    const r2 = simulateCounterintelligence(
      "competidor",
      "¿reaccionaría a un listing señuelo?",
    );

    expect(r1.recommendation).not.toBe(r2.recommendation);
  });

  it("returns no-patterns-detected for unrecognized queries", () => {
    const result = simulateCounterintelligence(
      "competidor",
      "¿cómo está el clima hoy?",
    );

    expect(result.recommendation).toMatch(/no se detectaron patrones/i);
    expect(result.confidence).toBe(0.8);
  });

  it("generates unique simulationIds for different calls", () => {
    const r1 = simulateCounterintelligence(
      "competidor",
      "¿está monitoreando mis precios?",
    );
    const r2 = simulateCounterintelligence(
      "competidor",
      "¿reaccionaría a un listing señuelo?",
    );

    expect(r1.simulationId).not.toBe(r2.simulationId);
  });

  it("includes query context in rationale", () => {
    const result = simulateCounterintelligence(
      "competidor",
      "¿está monitoreando mis precios?",
    );

    expect(result.rationale).toContain("monitoreando mis precios");
  });

  it("confidence is always 0.8 for mock", () => {
    const results = [
      simulateCounterintelligence(
        "competidor",
        "¿está monitoreando mis precios?",
      ),
      simulateCounterintelligence(
        "competidor",
        "¿reaccionaría a un listing señuelo?",
      ),
      simulateCounterintelligence(
        "competidor",
        "¿hay patrón de preguntas?",
      ),
      simulateCounterintelligence("competidor", "random query"),
    ];

    for (const r of results) {
      expect(r.confidence).toBe(0.8);
    }
  });
});
