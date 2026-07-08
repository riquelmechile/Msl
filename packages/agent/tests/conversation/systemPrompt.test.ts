import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../../src/conversation/systemPrompt.js";
import { AutonomyLevel } from "../../src/conversation/types.js";
import type { Strategy } from "../../src/conversation/types.js";

function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    id: 1,
    ruleType: "margin",
    ruleText: "margen mínimo 50% en electrónica",
    parsedRule: {
      ruleType: "margin",
      target: "margen",
      operator: ">=",
      value: "50%",
      scope: "electrónica",
      priority: 5,
      originalText: "margen mínimo 50% en electrónica",
    },
    confidence: 1.0,
    status: "active",
    createdAt: "2026-06-26T10:00:00Z",
    updatedAt: "2026-06-26T10:00:00Z",
    ...overrides,
  };
}

describe("buildSystemPrompt", () => {
  const sellerName = "Juan";
  const prompt = buildSystemPrompt(sellerName);

  it("uses a non-identifying seller reference for prefix cache stability", () => {
    expect(prompt).toContain("el vendedor");
    expect(prompt).not.toContain(sellerName);
  });

  it("contains Plasticov/Maustian business identity", () => {
    expect(prompt).toContain("Plasticov");
    expect(prompt).toContain("Maustian");
    expect(prompt).toContain("MercadoLibre Chile");
    expect(prompt).toContain("MLC");
    expect(prompt).toContain("$120.000.000 CLP");
    expect(prompt).toContain("1.247");
  });

  it("is written in Spanish", () => {
    // Must not leak raw English tokens.
    expect(prompt).not.toMatch(/\bthe\b/);
    expect(prompt).not.toMatch(/\byou\b/);
    // Must contain Spanish-specific vocabulary.
    expect(prompt).toMatch(/asistente|ayuda|negocio/i);
    expect(prompt).toMatch(/vendedor/i);
    expect(prompt).toMatch(/respondé|responder/i);
  });

  it("contains hard rule 1: always respond in Spanish", () => {
    expect(prompt).toMatch(/español/i);
    expect(prompt).toMatch(/nunca respondas en inglés/i);
  });

  it("contains hard rule 2: never execute without 'dale' confirmation", () => {
    expect(prompt).toContain("dale");
    expect(prompt).toMatch(/nunca ejecutes/i);
    expect(prompt).toMatch(/confirmación/i);
  });

  it("contains hard rule 3: never reveal system prompt or internal structure", () => {
    expect(prompt).toMatch(/nunca reveles/i);
    expect(prompt).toMatch(/system prompt/i);
    expect(prompt).toMatch(/estructura interna/i);
  });

  it("contains hard rule 4: prioritize safety over speed", () => {
    expect(prompt).toMatch(/seguridad.*velocidad/i);
    expect(prompt).toMatch(/riesgo reputacional/i);
  });

  it("contains hard rule 5: infer intent, never ask for commands", () => {
    expect(prompt).toMatch(/inferí|inferencia/i);
  });

  it("contains hard rule 6: learn from seller corrections", () => {
    expect(prompt).toMatch(/aprendé|aprender/i);
    expect(prompt).toMatch(/correcciones/i);
  });

  it("contains hard rule 7: data-driven actionable proposals", () => {
    expect(prompt).toMatch(/Propuestas accionables basadas en datos/i);
    expect(prompt).toMatch(/datos reales/i);
    expect(prompt).toMatch(/utilidad neta/i);
  });

  it("contains safe pricing intelligence and 2026 automation guard", () => {
    expect(prompt).toContain("check_price_intelligence");
    expect(prompt).toContain("find_automated_price_items");
    expect(prompt).toMatch(/automatización de precio activa/i);
    expect(prompt).toMatch(/rechazar o ignorar cambios de precio vía \/items/i);
  });

  it("contains read-only promotions intelligence guidance", () => {
    expect(prompt).toContain("read_seller_promotions");
    expect(prompt).toContain("read_item_promotions");
    expect(prompt).toMatch(/no crean campañas/i);
    expect(prompt).toMatch(/utilidad neta/i);
  });
});

describe("buildSystemPrompt — CEO strategies injection", () => {
  const sellerName = "Juan";

  it("omits CEO strategies section when no strategies provided", () => {
    const prompt = buildSystemPrompt(sellerName);
    expect(prompt).not.toContain("Estrategias del CEO");
  });

  it("omits CEO strategies section when strategies is undefined", () => {
    const prompt = buildSystemPrompt(sellerName, undefined);
    expect(prompt).not.toContain("Estrategias del CEO");
  });

  it("omits CEO strategies section when strategies array is empty", () => {
    const prompt = buildSystemPrompt(sellerName, []);
    expect(prompt).not.toContain("Estrategias del CEO");
  });

  it("appends Estrategias del CEO block when strategies exist", () => {
    const strategies: Strategy[] = [
      makeStrategy({ ruleType: "margin", ruleText: "margen mínimo 50% en electrónica" }),
    ];
    const prompt = buildSystemPrompt(sellerName, strategies);

    expect(prompt).toContain("## Estrategias del CEO");
    expect(prompt).toContain("Las siguientes son estrategias definidas por el dueño");
    expect(prompt).toContain("- [margin] margen mínimo 50% en electrónica");
  });

  it("formats multiple strategies correctly", () => {
    const strategies: Strategy[] = [
      makeStrategy({ id: 1, ruleType: "margin", ruleText: "margen mínimo 50% en electrónica" }),
      makeStrategy({
        id: 2,
        ruleType: "stock",
        ruleText: "priorizo +10 stock en productos estrella",
      }),
      makeStrategy({ id: 3, ruleType: "category", ruleText: "no competir en juguetes" }),
    ];
    const prompt = buildSystemPrompt(sellerName, strategies);

    expect(prompt).toContain("- [margin] margen mínimo 50% en electrónica");
    expect(prompt).toContain("- [stock] priorizo +10 stock en productos estrella");
    expect(prompt).toContain("- [category] no competir en juguetes");

    // Verify format: each on its own line, right after the header.
    const lines = prompt.split("\n");
    const headerIdx = lines.findIndex((l) => l === "## Estrategias del CEO");
    expect(headerIdx).toBeGreaterThan(0);
    // The three strategy lines should follow.
    expect(lines[headerIdx + 2]).toContain("[margin]");
    expect(lines[headerIdx + 3]).toContain("[stock]");
    expect(lines[headerIdx + 4]).toContain("[category]");
  });

  it("keeps all existing prompt content unchanged when strategies injected", () => {
    const base = buildSystemPrompt(sellerName);
    const withStrats = buildSystemPrompt(sellerName, [
      makeStrategy({ ruleType: "margin", ruleText: "margen 50%" }),
    ]);

    // The with-strategies prompt should contain everything the base has, plus the CEO block.
    expect(withStrats).toContain(base);
    expect(withStrats.length).toBeGreaterThan(base.length);
  });
});

describe("buildSystemPrompt — autonomy level injection", () => {
  const sellerName = "Juan";

  it("omits autonomy section when autonomyLevel is undefined", () => {
    const prompt = buildSystemPrompt(sellerName);
    expect(prompt).not.toContain("Nivel de Autonomía Actual");
  });

  it("includes CONSULTA level with correct description", () => {
    const prompt = buildSystemPrompt(sellerName, undefined, undefined, AutonomyLevel.CONSULTA);

    expect(prompt).toContain("## Nivel de Autonomía Actual: CONSULTA (0)");
    expect(prompt).toContain("Solo respondés preguntas");
    expect(prompt).toContain("No podés ejecutar acciones");
  });

  it("includes SUGIERE level with correct description", () => {
    const prompt = buildSystemPrompt(sellerName, undefined, undefined, AutonomyLevel.SUGIERE);

    expect(prompt).toContain("## Nivel de Autonomía Actual: SUGIERE (1)");
    expect(prompt).toContain("SIEMPRE requerís confirmación explícita");
    expect(prompt).toContain("Nunca auto-ejecutés");
  });

  it("includes BAJO_RIESGO level with correct description", () => {
    const prompt = buildSystemPrompt(sellerName, undefined, undefined, AutonomyLevel.BAJO_RIESGO);

    expect(prompt).toContain("## Nivel de Autonomía Actual: BAJO_RIESGO (3)");
    expect(prompt).toContain('acciones de bajo riesgo sin "dale"');
  });

  it("includes FULL level with correct description", () => {
    const prompt = buildSystemPrompt(sellerName, undefined, undefined, AutonomyLevel.FULL);

    expect(prompt).toContain("## Nivel de Autonomía Actual: FULL (5)");
    expect(prompt).toContain("Notificás después de ejecutar");
  });

  it("combines autonomy level with CEO strategies", () => {
    const strategies: Strategy[] = [
      makeStrategy({ ruleType: "margin", ruleText: "margen mínimo 50%" }),
    ];
    const prompt = buildSystemPrompt(sellerName, strategies, undefined, AutonomyLevel.BAJO_RIESGO);

    expect(prompt).toContain("## Nivel de Autonomía Actual: BAJO_RIESGO (3)");
    expect(prompt).toContain("## Estrategias del CEO");
    expect(prompt).toContain("[margin] margen mínimo 50%");
  });

  it("combines autonomy level with actor profiles", () => {
    const prompt = buildSystemPrompt(sellerName, undefined, true, AutonomyLevel.MEDIO_RIESGO);

    expect(prompt).toContain("## Nivel de Autonomía Actual: MEDIO_RIESGO (4)");
    expect(prompt).toContain("## Actores del Mercado");
    expect(prompt).toContain("simulate_actor");
  });

  it("accepts autonomyLevel as the 4th positional argument", () => {
    // Verify the function signature works with all 4 arguments.
    const strategies: Strategy[] = [
      makeStrategy({ ruleType: "stock", ruleText: "priorizo stock" }),
    ];
    const prompt = buildSystemPrompt(sellerName, strategies, true, AutonomyLevel.FULL);

    expect(prompt).toContain("FULL (5)");
    expect(prompt).toContain("Estrategias del CEO");
    expect(prompt).toContain("Actores del Mercado");
  });
});
