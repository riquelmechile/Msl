import { describe, expect, it } from "vitest";
import { proposeDecoy } from "../../src/conversation/honeyPotProposer.js";
// ── Helpers ───────────────────────────────────────────────────────────
function makeProbeStrategy(overrides = {}) {
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
function makeCompetidorResult() {
    return {
        actorType: "competidor",
        recommendation: "Como competidor, si bajás el precio yo también bajo para mantener mi posición.",
        confidence: 0.85,
        rationale: "El competidor reacciona a cambios de precio.",
        simulationId: "sim-123",
    };
}
// ── proposeDecoy ──────────────────────────────────────────────────────
describe("proposeDecoy", () => {
    it("returns a DecoyProposal with all required fields", () => {
        const strategy = makeProbeStrategy();
        const proposal = proposeDecoy(strategy);
        expect(proposal.id).toMatch(/^decoy-/);
        expect(proposal.type).toBe("category_entry"); // "probá" → category_entry
        expect(proposal.description).toBeTruthy();
        expect(proposal.riskLevel).toBe("medium"); // electrónica is broad
        expect(proposal.tosCompliant).toBe(true);
        expect(proposal.tosWarning).toBeTruthy();
    });
    it("always includes a populated tosWarning in Spanish", () => {
        const strategy = makeProbeStrategy();
        const proposal = proposeDecoy(strategy);
        expect(proposal.tosWarning).toContain("MercadoLibre");
        expect(proposal.tosWarning).toContain("Términos de Servicio");
        expect(proposal.tosWarning.length).toBeGreaterThan(50);
    });
    it("resolves decoyType 'price_probe' for monitor/watch strategies", () => {
        const strategy = makeProbeStrategy({
            parsedRule: {
                ...makeProbeStrategy().parsedRule,
                operator: "monitoreá",
            },
        });
        const proposal = proposeDecoy(strategy);
        expect(proposal.type).toBe("price_probe");
    });
    it("resolves decoyType 'stock_signal' for competitor-targeted strategies", () => {
        const strategy = makeProbeStrategy({
            parsedRule: {
                ruleType: "probe",
                target: "competidor",
                operator: "vigilá",
                value: "TiendaX",
                priority: 5,
                originalText: "vigilá TiendaX",
            },
        });
        const proposal = proposeDecoy(strategy);
        expect(proposal.type).toBe("stock_signal");
        // Competitor strategies are medium risk
        expect(proposal.riskLevel).toBe("medium");
    });
    it("assigns 'low' risk for specific product targets", () => {
        const strategy = makeProbeStrategy({
            parsedRule: {
                ...makeProbeStrategy().parsedRule,
                value: "iPhone 15 Pro Max", // specific product, long name
            },
        });
        const proposal = proposeDecoy(strategy);
        expect(proposal.riskLevel).toBe("low");
    });
    it("assigns 'medium' risk for broad category targets", () => {
        const strategy = makeProbeStrategy({
            parsedRule: {
                ...makeProbeStrategy().parsedRule,
                value: "electrónica",
            },
        });
        const proposal = proposeDecoy(strategy);
        expect(proposal.riskLevel).toBe("medium");
    });
    it("enriches description with competidor actor recommendation when provided", () => {
        const strategy = makeProbeStrategy();
        const actor = makeCompetidorResult();
        const proposal = proposeDecoy(strategy, actor);
        expect(proposal.description).toContain("competidor");
        expect(proposal.description).toContain(actor.recommendation);
    });
    it("generates unique IDs for consecutive calls", () => {
        const strategy = makeProbeStrategy();
        const p1 = proposeDecoy(strategy);
        const p2 = proposeDecoy(strategy);
        expect(p1.id).not.toBe(p2.id);
    });
    it("includes the strategy category value in the description", () => {
        const strategy = makeProbeStrategy({
            parsedRule: {
                ...makeProbeStrategy().parsedRule,
                value: "ropa",
            },
        });
        const proposal = proposeDecoy(strategy);
        expect(proposal.description).toContain("ropa");
    });
});
//# sourceMappingURL=honeyPotProposer.test.js.map