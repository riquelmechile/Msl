import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../../src/conversation/systemPrompt.js";

describe("buildSystemPrompt", () => {
  const sellerName = "Juan";
  const prompt = buildSystemPrompt(sellerName);

  it("includes the seller name passed as argument", () => {
    expect(prompt).toContain(sellerName);
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

  it("contains hard rule 7: propose concrete actions, never generic", () => {
    expect(prompt).toMatch(/acciones concretas/i);
    expect(prompt).toMatch(/genéricas/i);
  });
});
