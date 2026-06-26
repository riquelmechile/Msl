import { describe, it, expect } from "vitest";
import { selfVerify } from "../../src/conversation/selfVerify.js";
import type { AgentProposal, Strategy, ParsedRule } from "../../src/conversation/types.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeProposal(overrides: Partial<AgentProposal> = {}): AgentProposal {
  return {
    action: {
      id: "prop-1",
      sellerId: "seller-1",
      kind: "price-change",
      target: { type: "listing", listingId: "MLC-42" },
      exactChange: [{ field: "price", from: 15000, to: 13500 }],
      rationale: "Ajuste recomendado por análisis de margen.",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    naturalSummary: "¿Bajo el precio del listing MLC-42 en 10%?",
    riskLevel: "medium",
    ...overrides,
  };
}

function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
  const rule: ParsedRule = {
    ruleType: "margin",
    target: "margen",
    operator: ">=",
    value: "50%",
    priority: 10,
    originalText: "margen mínimo 50%",
  };
  const parsedRuleOverride = overrides.parsedRule as Partial<ParsedRule> | undefined;
  const { parsedRule: _unused, ...restOverrides } = overrides;
  void _unused;

  const mergedRule: ParsedRule = {
    ...rule,
    ...(parsedRuleOverride ?? {}),
  };

  return {
    id: 1,
    ruleType: mergedRule.ruleType,
    ruleText: mergedRule.originalText,
    parsedRule: mergedRule,
    confidence: 0.9,
    status: "active" as const,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...restOverrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("selfVerify", () => {
  it("passes a safe proposal with no strategies", () => {
    const result = selfVerify(makeProposal(), [], {
      sellerId: "seller-1",
      currentLevel: "MEDIO_RIESGO",
    });

    expect(result.passed).toBe(true);
    expect(result.requiresHumanReview).toBe(false);
    expect(result.checks).toHaveLength(4);
  });

  it("fails on strategy violation (margin strategy vs price decrease)", () => {
    const strategy = makeStrategy({
      ruleType: "margin",
      parsedRule: {
        ruleType: "margin",
        target: "margen",
        operator: ">=",
        value: "50%",
        priority: 10,
        originalText: "margen mínimo 50%",
      },
      ruleText: "margen mínimo 50%",
    });

    const result = selfVerify(makeProposal(), [strategy], {
      sellerId: "seller-1",
      currentLevel: "MEDIO_RIESGO",
    });

    expect(result.passed).toBe(false);
    expect(result.checks[0]!.name).toBe("Estrategia CEO");
    expect(result.checks[0]!.passed).toBe(false);
    expect(result.checks[0]!.severity).toBe("blocking");
  });

  it("fails on safety violation (declared risk mismatches domain)", () => {
    // "honey-pot-deploy" is always "high" risk in domain.
    const proposal = makeProposal({
      action: {
        id: "prop-2",
        sellerId: "seller-1",
        kind: "honey-pot-deploy",
        target: { type: "listing", listingId: "MLC-42" },
        exactChange: [{ field: "status", from: "draft", to: "active" }],
        rationale: "Operación de contrainteligencia.",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      riskLevel: "medium", // domain says "high"
    });

    const result = selfVerify(proposal, [], {
      sellerId: "seller-1",
      currentLevel: "MEDIO_RIESGO",
    });

    expect(result.passed).toBe(false);
    expect(result.checks[1]!.name).toBe("Seguridad");
    expect(result.checks[1]!.passed).toBe(false);
    expect(result.checks[1]!.severity).toBe("blocking");
  });

  it("blocks critical-risk proposals via safety check", () => {
    const proposal = makeProposal({
      action: {
        id: "prop-3",
        sellerId: "seller-1",
        kind: "listing-edit",
        target: { type: "listing", listingId: "MLC-42" },
        exactChange: [{ field: "status", from: "open", to: "resolved" }],
        rationale: "Resolución de reclamo.",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      riskLevel: "critical",
    });

    const result = selfVerify(proposal, [], {
      sellerId: "seller-1",
      currentLevel: "FULL",
    });

    expect(result.passed).toBe(false);
    const safetyCheck = result.checks.find((c) => c.name === "Seguridad");
    expect(safetyCheck!.passed).toBe(false);
    expect(safetyCheck!.severity).toBe("blocking");
  });

  it("flags warning when autonomy level is too low for risk level", () => {
    // "medium" risk requires MEDIO_RIESGO (tier 4); SUGIERE is tier 1.
    const result = selfVerify(makeProposal({ riskLevel: "medium" }), [], {
      sellerId: "seller-1",
      currentLevel: "SUGIERE",
    });

    // Strategy and safety checks pass, but autonomy check warns.
    expect(result.passed).toBe(true); // no blocking
    expect(result.requiresHumanReview).toBe(true);

    const autonomyCheck = result.checks.find((c) => c.name === "Nivel de autonomía");
    expect(autonomyCheck!.passed).toBe(false);
    expect(autonomyCheck!.severity).toBe("warning");
  });

  it("passes autonomy check when level is appropriate", () => {
    const result = selfVerify(makeProposal({ riskLevel: "medium" }), [], {
      sellerId: "seller-1",
      currentLevel: "MEDIO_RIESGO",
    });

    const autonomyCheck = result.checks.find((c) => c.name === "Nivel de autonomía");
    expect(autonomyCheck!.passed).toBe(true);
    expect(autonomyCheck!.severity).toBe("info");
    expect(result.requiresHumanReview).toBe(false);
  });

  it("detects consistency contradictions (subir + bajar)", () => {
    const proposal = makeProposal({
      naturalSummary: "Subir el precio pero también bajar el margen",
    });

    const result = selfVerify(proposal, [], {
      sellerId: "seller-1",
      currentLevel: "FULL",
    });

    const consistencyCheck = result.checks.find((c) => c.name === "Consistencia");
    expect(consistencyCheck!.passed).toBe(false);
    expect(consistencyCheck!.severity).toBe("warning");
    expect(result.requiresHumanReview).toBe(true);
  });

  it("detects consistency contradictions (aumentar + reducir)", () => {
    const proposal = makeProposal({
      naturalSummary: "Aumentar precio y reducir stock",
    });

    const result = selfVerify(proposal, [], {
      sellerId: "seller-1",
      currentLevel: "FULL",
    });

    const consistencyCheck = result.checks.find((c) => c.name === "Consistencia");
    expect(consistencyCheck!.passed).toBe(false);
  });

  it("detects consistency contradictions (más + menos)", () => {
    const proposal = makeProposal({
      naturalSummary: "Más margen y menos precio",
    });

    const result = selfVerify(proposal, [], {
      sellerId: "seller-1",
      currentLevel: "FULL",
    });

    const consistencyCheck = result.checks.find((c) => c.name === "Consistencia");
    expect(consistencyCheck!.passed).toBe(false);
  });

  it("passes consistency check for non-contradictory text", () => {
    const proposal = makeProposal({
      naturalSummary: "Aumentar el precio un 10%",
    });

    const result = selfVerify(proposal, [], {
      sellerId: "seller-1",
      currentLevel: "FULL",
    });

    const consistencyCheck = result.checks.find((c) => c.name === "Consistencia");
    expect(consistencyCheck!.passed).toBe(true);
  });

  it("returns correct VerificationResult structure", () => {
    const result = selfVerify(makeProposal(), [], {
      sellerId: "seller-1",
      currentLevel: "FULL",
    });

    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("checks");
    expect(result).toHaveProperty("requiresHumanReview");
    expect(typeof result.passed).toBe("boolean");
    expect(typeof result.requiresHumanReview).toBe("boolean");
    expect(Array.isArray(result.checks)).toBe(true);

    for (const check of result.checks) {
      expect(check).toHaveProperty("name");
      expect(check).toHaveProperty("passed");
      expect(check).toHaveProperty("detail");
      expect(check).toHaveProperty("severity");
      expect(["info", "warning", "blocking"]).toContain(check.severity);
    }
  });

  it("sets requiresHumanReview when any check is warning or blocking", () => {
    // Consistency contradiction triggers warning.
    const proposal = makeProposal({
      naturalSummary: "Subir precio y bajar costo",
    });

    const result = selfVerify(proposal, [], {
      sellerId: "seller-1",
      currentLevel: "FULL",
    });

    expect(result.requiresHumanReview).toBe(true);
  });

  it("checks are ordered: Strategy, Safety, Autonomy, Consistency", () => {
    const result = selfVerify(makeProposal(), [], {
      sellerId: "seller-1",
      currentLevel: "FULL",
    });

    expect(result.checks[0]!.name).toBe("Estrategia CEO");
    expect(result.checks[1]!.name).toBe("Seguridad");
    expect(result.checks[2]!.name).toBe("Nivel de autonomía");
    expect(result.checks[3]!.name).toBe("Consistencia");
  });
});
