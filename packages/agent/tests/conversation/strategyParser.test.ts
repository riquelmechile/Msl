import { describe, expect, it } from "vitest";

import { classifyRuleType, parseStrategy } from "../../src/conversation/strategyParser.js";
import type { ParsedRule, RuleType } from "../../src/conversation/types.js";

// ── Helpers ─────────────────────────────────────────────────────────

/** Shortcut to grab the first rule from a ParseResult. */
function firstRule(text: string): ParsedRule | undefined {
  return parseStrategy(text).rules[0];
}

// ── Margin rules ────────────────────────────────────────────────────

describe("parseStrategy — margin rules", () => {
  it('extracts "margen mínimo 50%" with operator >=', () => {
    const rule = firstRule("margen mínimo 50%");
    expect(rule).toBeDefined();
    expect(rule!.ruleType).toBe("margin");
    expect(rule!.target).toBe("margen");
    expect(rule!.operator).toBe(">=");
    expect(rule!.value).toBe("50%");
  });

  it('extracts "margen máximo 30% con operator <="', () => {
    const rule = firstRule("margen máximo 30%");
    expect(rule!.ruleType).toBe("margin");
    expect(rule!.operator).toBe("<=");
    expect(rule!.value).toBe("30%");
  });

  it('extracts "margen 25%" with default operator >=', () => {
    const rule = firstRule("margen 25%");
    expect(rule!.ruleType).toBe("margin");
    expect(rule!.operator).toBe(">=");
    expect(rule!.value).toBe("25%");
  });

  it('extracts "margen objetivo 40%" with operator >=', () => {
    const rule = firstRule("margen objetivo 40%");
    expect(rule!.ruleType).toBe("margin");
    expect(rule!.operator).toBe(">=");
    expect(rule!.value).toBe("40%");
  });

  it('extracts "margen del 15%" with default operator >=', () => {
    const rule = firstRule("margen del 15%");
    expect(rule!.ruleType).toBe("margin");
    expect(rule!.operator).toBe(">=");
    expect(rule!.value).toBe("15%");
  });

  it('extracts reverse phrasing "apunto a 50%+ margen"', () => {
    const rule = firstRule("apunto a 50%+ margen");
    expect(rule).toBeDefined();
    expect(rule!.ruleType).toBe("margin");
    expect(rule!.target).toBe("margen");
    expect(rule!.operator).toBe(">=");
    expect(rule!.value).toBe("50%");
  });

  it("preserves originalText on the rule", () => {
    const rule = firstRule("margen mínimo 50%");
    expect(rule!.originalText).toBe("margen mínimo 50%");
  });
});

// ── Stock rules ─────────────────────────────────────────────────────

describe("parseStrategy — stock rules", () => {
  it('extracts "priorizo +10 stock en productos estrella" with scope', () => {
    const rule = firstRule("priorizo +10 stock en productos estrella");
    expect(rule).toBeDefined();
    expect(rule!.ruleType).toBe("stock");
    expect(rule!.target).toBe("stock");
    expect(rule!.operator).toBe("priorizar");
    expect(rule!.value).toBe("+10");
    expect(rule!.scope).toBe("productos estrella");
  });

  it('extracts "priorizá +5 stock" (voseo)', () => {
    const rule = firstRule("priorizá +5 stock");
    expect(rule!.ruleType).toBe("stock");
    expect(rule!.value).toBe("+5");
  });

  it('extracts "priorizar +20 unidades" (infinitive)', () => {
    const rule = firstRule("priorizar +20 unidades");
    expect(rule!.ruleType).toBe("stock");
    expect(rule!.value).toBe("+20");
  });

  it('extracts stock rule without scope', () => {
    const rule = firstRule("priorizo +3 stock");
    expect(rule!.ruleType).toBe("stock");
    expect(rule!.value).toBe("+3");
    expect(rule!.scope).toBeUndefined();
  });
});

// ── Category rules ──────────────────────────────────────────────────

describe("parseStrategy — category rules", () => {
  it('extracts "no competir en juguetes" as exclusion', () => {
    const rule = firstRule("no competir en juguetes");
    expect(rule).toBeDefined();
    expect(rule!.ruleType).toBe("category");
    expect(rule!.target).toBe("categoría");
    expect(rule!.operator).toBe("evitar");
    expect(rule!.value).toBe("juguetes");
  });

  it('extracts "enfocate en electrónica" as focus (voseo)', () => {
    const rule = firstRule("enfocate en electrónica");
    expect(rule!.ruleType).toBe("category");
    expect(rule!.target).toBe("categoría");
    expect(rule!.operator).toBe("enfocar");
    expect(rule!.value).toBe("electrónica");
  });

  it('extracts "enfocarse en ropa" as focus (infinitive)', () => {
    const rule = firstRule("enfocarse en ropa");
    expect(rule!.ruleType).toBe("category");
    expect(rule!.operator).toBe("enfocar");
    expect(rule!.value).toBe("ropa");
  });

  it('extracts "enfocar en tecnología" as focus', () => {
    const rule = firstRule("enfocar en tecnología");
    expect(rule!.ruleType).toBe("category");
    expect(rule!.value).toBe("tecnología");
  });
});

// ── Pricing rules ───────────────────────────────────────────────────

describe("parseStrategy — pricing rules", () => {
  it('extracts "precio máximo $5000 en electrónica" with cap and scope', () => {
    const rule = firstRule("precio máximo $5000 en electrónica");
    expect(rule).toBeDefined();
    expect(rule!.ruleType).toBe("pricing");
    expect(rule!.target).toBe("precio");
    expect(rule!.operator).toBe("<=");
    expect(rule!.value).toBe("5000");
    expect(rule!.scope).toBe("electrónica");
  });

  it('extracts "precio mínimo 1000" with floor', () => {
    const rule = firstRule("precio mínimo 1000");
    expect(rule!.ruleType).toBe("pricing");
    expect(rule!.operator).toBe(">=");
    expect(rule!.value).toBe("1000");
    expect(rule!.scope).toBeUndefined();
  });

  it('extracts "precio máximo 2000" without scope', () => {
    const rule = firstRule("precio máximo 2000");
    expect(rule!.ruleType).toBe("pricing");
    expect(rule!.operator).toBe("<=");
    expect(rule!.value).toBe("2000");
  });

  it('extracts "precio máximo $15000 en juguetes"', () => {
    const rule = firstRule("precio máximo $15000 en juguetes");
    expect(rule!.ruleType).toBe("pricing");
    expect(rule!.value).toBe("15000");
    expect(rule!.scope).toBe("juguetes");
  });
});

// ── Customer rules ──────────────────────────────────────────────────

describe("parseStrategy — customer rules", () => {
  it('extracts "responder en <1 hora"', () => {
    const rule = firstRule("responder en <1 hora");
    expect(rule).toBeDefined();
    expect(rule!.ruleType).toBe("customer");
    expect(rule!.target).toBe("cliente");
    expect(rule!.operator).toBe("<=");
    expect(rule!.value).toBe("1 hora");
  });

  it('extracts "contestar en 30 minutos"', () => {
    const rule = firstRule("contestar en 30 minutos");
    expect(rule!.ruleType).toBe("customer");
    expect(rule!.value).toBe("30 minutos");
  });

  it('extracts "responder en 2 horas" without angle bracket', () => {
    const rule = firstRule("responder en 2 horas");
    expect(rule!.ruleType).toBe("customer");
    expect(rule!.value).toBe("2 horas");
  });
});

// ── Competitive rules ───────────────────────────────────────────────

describe("parseStrategy — competitive rules", () => {
  it('extracts "igualar precio de competencia"', () => {
    const rule = firstRule("igualar precio de competencia");
    expect(rule).toBeDefined();
    expect(rule!.ruleType).toBe("competitive");
    expect(rule!.target).toBe("competencia");
    expect(rule!.operator).toBe("igualar");
    expect(rule!.value).toBe("competencia");
  });

  it('extracts "igualar precio de MercadoLibre oficial"', () => {
    const rule = firstRule("igualar precio de MercadoLibre oficial");
    expect(rule!.ruleType).toBe("competitive");
    expect(rule!.value).toBe("MercadoLibre oficial");
  });
});

// ── Multi-rule extraction ───────────────────────────────────────────

describe("parseStrategy — multi-rule text", () => {
  it('extracts two rules from "margen 50% y priorizar +10 stock"', () => {
    const result = parseStrategy("margen 50% y priorizar +10 stock");
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0].ruleType).toBe("margin");
    expect(result.rules[1].ruleType).toBe("stock");
  });

  it("extracts margin + category rules from comma-separated input", () => {
    const result = parseStrategy(
      "margen 50% en electrónica, no competir en juguetes",
    );
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0].ruleType).toBe("margin");
    expect(result.rules[1].ruleType).toBe("category");
    expect(result.rules[1].value).toBe("juguetes");
  });

  it("extracts three rules from mixed text", () => {
    const result = parseStrategy(
      "margen mínimo 40%, priorizo +5 stock y precio máximo $3000",
    );
    expect(result.rules).toHaveLength(3);
    const ruleTypes = result.rules.map((r) => r.ruleType);
    expect(ruleTypes).toContain("margin");
    expect(ruleTypes).toContain("stock");
    expect(ruleTypes).toContain("pricing");
  });
});

// ── Edge cases ──────────────────────────────────────────────────────

describe("parseStrategy — edge cases", () => {
  it("returns empty rules for empty string", () => {
    const result = parseStrategy("");
    expect(result.rules).toHaveLength(0);
    expect(result.unparsed).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it("returns empty rules for whitespace-only input", () => {
    const result = parseStrategy("   ");
    expect(result.rules).toHaveLength(0);
  });

  it("places unmatched creative text in unparsed", () => {
    const result = parseStrategy("quiero vender más este mes");
    expect(result.rules).toHaveLength(0);
    expect(result.unparsed).toHaveLength(1);
    expect(result.unparsed[0]).toBe("quiero vender más este mes");
  });

  it("separates matched rules from unparsed surrounding text", () => {
    const result = parseStrategy("necesito margen mínimo 50% urgente ya");
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].ruleType).toBe("margin");
    // Unparsed should contain the unmatched prefixes/suffixes
    const joined = result.unparsed.join(" ");
    expect(joined).toContain("necesito");
    expect(joined).toContain("urgente ya");
  });

  it("assigns confidence 1.0 when all rules matched", () => {
    const result = parseStrategy("margen 50%");
    expect(result.rules).toHaveLength(1);
    expect(result.confidence).toBe(1.0);
  });

  it("assigns confidence 0 when no rules matched", () => {
    const result = parseStrategy("texto sin reglas");
    expect(result.confidence).toBe(0);
  });

  it("handles Spanish grammatical variation — tuteo and voseo", () => {
    // priorizá (voseo) for stock
    const r1 = parseStrategy("priorizá +10 stock");
    expect(r1.rules[0].ruleType).toBe("stock");

    // enfocate (voseo) for category
    const r2 = parseStrategy("enfocate en ropa");
    expect(r2.rules[0].ruleType).toBe("category");

    // priorizar (infinitive)
    const r3 = parseStrategy("priorizar +5 unidades");
    expect(r3.rules[0].ruleType).toBe("stock");

    // enfocarse (infinitive reflexive)
    const r4 = parseStrategy("enfocarse en tecnología");
    expect(r4.rules[0].ruleType).toBe("category");
  });

  it("every rule has all required ParsedRule fields", () => {
    const result = parseStrategy(
      "margen 50%, priorizo +10 stock en electrónica",
    );
    for (const rule of result.rules) {
      expect(rule).toHaveProperty("ruleType");
      expect(rule).toHaveProperty("target");
      expect(rule).toHaveProperty("operator");
      expect(rule).toHaveProperty("value");
      expect(rule).toHaveProperty("priority");
      expect(rule).toHaveProperty("originalText");
    }
  });
});

// ── classifyRuleType ────────────────────────────────────────────────

describe("classifyRuleType", () => {
  it("returns existing ruleType when already set", () => {
    expect(classifyRuleType({ ruleType: "margin" } as Partial<ParsedRule>)).toBe(
      "margin",
    );
  });

  it('classifies "margen" target as margin', () => {
    expect(classifyRuleType({ target: "margen" })).toBe("margin");
  });

  it('classifies "stock" target as stock', () => {
    expect(classifyRuleType({ target: "stock" })).toBe("stock");
  });

  it('classifies "categoría" target as category', () => {
    expect(classifyRuleType({ target: "categoría" })).toBe("category");
  });

  it('classifies "precio" target as pricing', () => {
    expect(classifyRuleType({ target: "precio" })).toBe("pricing");
  });

  it('classifies "cliente" target as customer', () => {
    expect(classifyRuleType({ target: "cliente" })).toBe("customer");
  });

  it('classifies "competencia" target as competitive', () => {
    expect(classifyRuleType({ target: "competencia" })).toBe("competitive");
  });

  it('falls back to "margin" for unknown targets', () => {
    expect(classifyRuleType({ target: "xyz" })).toBe("margin");
  });

  it('falls back to "margin" for empty input', () => {
    expect(classifyRuleType({})).toBe("margin");
  });
});
