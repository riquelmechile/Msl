import { describe, expect, it } from "vitest";
import { honeyPotValidator } from "../../src/conversation/guardrails.js";
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
function makeNonProbeStrategy() {
    return {
        id: 2,
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
        confidence: 1.0,
        status: "active",
        createdAt: "2026-06-26T10:00:00Z",
        updatedAt: "2026-06-26T10:00:00Z",
    };
}
function makeProposal(overrides = {}) {
    return {
        id: "decoy-001",
        type: "category_entry",
        description: "Simulación de entrada a la categoría \"electrónica\" para medir la respuesta de competidores activos.",
        riskLevel: "medium",
        tosCompliant: true,
        tosWarning: "⚠️ Esta operación simula actividad en MercadoLibre. Asegurate de cumplir con los Términos de Servicio.",
        ...overrides,
    };
}
// ── honeyPotValidator ─────────────────────────────────────────────────
describe("honeyPotValidator", () => {
    it("blocks when strategies array is empty", () => {
        const result = honeyPotValidator(makeProposal(), []);
        expect(result.passed).toBe(false);
        expect(result.reason).toContain("contrainteligencia");
        expect(result.reason).toContain("probá");
        expect(result.reason).toContain("monitoreá");
    });
    it("blocks when strategies array is undefined", () => {
        const result = honeyPotValidator(makeProposal(), undefined);
        expect(result.passed).toBe(false);
    });
    it("blocks when no active probe strategy exists (only non-probe strategies)", () => {
        const result = honeyPotValidator(makeProposal(), [makeNonProbeStrategy()]);
        expect(result.passed).toBe(false);
        expect(result.reason).toContain("contrainteligencia");
    });
    it("blocks when probe strategy exists but is archived", () => {
        const archivedProbe = makeProbeStrategy({ status: "archived" });
        const result = honeyPotValidator(makeProposal(), [archivedProbe]);
        expect(result.passed).toBe(false);
    });
    it("passes when active probe strategy scope matches proposal description", () => {
        const strategy = makeProbeStrategy();
        const proposal = makeProposal({
            description: "Listing señuelo en \"electrónica\" para observar reacciones.",
        });
        const result = honeyPotValidator(proposal, [strategy]);
        expect(result.passed).toBe(true);
        expect(result.reason).toBeUndefined();
    });
    it("blocks when proposal description does not match any probe strategy scope", () => {
        const strategy = makeProbeStrategy({
            parsedRule: {
                ...makeProbeStrategy().parsedRule,
                value: "electrónica",
            },
        });
        const proposal = makeProposal({
            description: "Listing señuelo en \"ropa\" para atraer competidores.",
        });
        const result = honeyPotValidator(proposal, [strategy]);
        expect(result.passed).toBe(false);
        expect(result.reason).toContain("electrónica");
        expect(result.reason).toContain("alcance");
    });
    it("passes when at least one of multiple probe strategies matches", () => {
        const strategy1 = makeProbeStrategy({
            id: 1,
            parsedRule: {
                ...makeProbeStrategy().parsedRule,
                value: "ropa",
            },
        });
        const strategy2 = makeProbeStrategy({
            id: 2,
            parsedRule: {
                ...makeProbeStrategy().parsedRule,
                value: "electrónica",
            },
        });
        const proposal = makeProposal({
            description: "Decoy en categoría \"electrónica\" para medir competencia.",
        });
        const result = honeyPotValidator(proposal, [strategy1, strategy2]);
        expect(result.passed).toBe(true);
    });
    it("scope matching is case-insensitive", () => {
        const strategy = makeProbeStrategy({
            parsedRule: {
                ...makeProbeStrategy().parsedRule,
                value: "Electrónica",
            },
        });
        const proposal = makeProposal({
            description: "Decoy en \"electrónica\".",
        });
        const result = honeyPotValidator(proposal, [strategy]);
        expect(result.passed).toBe(true);
    });
    it("passes when mixed probe and non-probe strategies exist with a matching probe", () => {
        const strategies = [
            makeNonProbeStrategy(),
            makeProbeStrategy({
                parsedRule: {
                    ...makeProbeStrategy().parsedRule,
                    value: "electrónica",
                },
            }),
        ];
        const result = honeyPotValidator(makeProposal(), strategies);
        expect(result.passed).toBe(true);
    });
    it("blocks with competitor monitoring strategy when not matching", () => {
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
        const proposal = makeProposal({
            description: "Decoy en \"electrónica\" para TiendaY.",
        });
        const result = honeyPotValidator(proposal, [strategy]);
        expect(result.passed).toBe(false);
        expect(result.reason).toContain("TiendaX");
    });
    it("produces Spanish rejection messages only", () => {
        const result = honeyPotValidator(makeProposal(), []);
        expect(result.reason).toMatch(/contrainteligencia/i);
        expect(result.reason).toMatch(/probá/i);
        expect(result.reason).not.toMatch(/\bblocks?\b/i);
        expect(result.reason).not.toMatch(/\bmust\b/i);
    });
    it("returns GuardResult shape with passed and optional reason", () => {
        // Pass case
        const passResult = honeyPotValidator(makeProposal({ description: "Decoy en electrónica." }), [makeProbeStrategy()]);
        expect(passResult.passed).toBe(true);
        expect(passResult.reason).toBeUndefined();
        // Block case
        const blockResult = honeyPotValidator(makeProposal(), []);
        expect(blockResult.passed).toBe(false);
        expect(typeof blockResult.reason).toBe("string");
    });
});
//# sourceMappingURL=honeyPotValidator.test.js.map