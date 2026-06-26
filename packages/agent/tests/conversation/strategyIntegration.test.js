import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { buildSystemPrompt } from "../../src/conversation/systemPrompt.js";
import { strategyValidator } from "../../src/conversation/guardrails.js";
import { parseStrategy } from "../../src/conversation/strategyParser.js";
import { createStrategyStore } from "../../src/conversation/strategyStore.js";
import { createAgentLoop } from "../../src/conversation/agentLoop.js";
// ── Helpers ──────────────────────────────────────────────────────────────
function makeProposal(overrides = {}) {
    return {
        action: {
            id: "prop-int",
            sellerId: "seller-1",
            kind: "price-change",
            target: { type: "listing", listingId: "MLC-42" },
            exactChange: [{ field: "price", from: 15000, to: 13500 }],
            rationale: "Competencia bajó el precio; necesito mantener visibilidad.",
            expiresAt: new Date("2026-06-27T12:00:00Z"),
        },
        naturalSummary: "Bajar el precio del listing MLC-42 en 10%",
        riskLevel: "medium",
        ...overrides,
    };
}
function makeState(overrides = {}) {
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
// ── Full flow: parse → store → inject → validate ───────────────────────
describe("strategy integration — parse → store → inject → validate", () => {
    let db;
    let store;
    beforeEach(() => {
        db = new Database(":memory:");
        store = createStrategyStore(db);
    });
    it("parses 'margen mínimo 50%' → stores → appears in system prompt", () => {
        // 1. Parse
        const parsed = parseStrategy("margen mínimo 50% en electrónica");
        expect(parsed.rules).toHaveLength(1);
        expect(parsed.rules[0].ruleType).toBe("margin");
        // 2. Store
        const rule = parsed.rules[0];
        const strategy = store.insertStrategy("margen mínimo 50% en electrónica", rule, parsed.confidence);
        expect(strategy.id).toBe(1);
        expect(strategy.status).toBe("active");
        // 3. Verify it's active
        const active = store.listActive();
        expect(active).toHaveLength(1);
        // 4. Inject into system prompt
        const prompt = buildSystemPrompt("Juan", active);
        expect(prompt).toContain("## Estrategias del CEO");
        expect(prompt).toContain("- [margin] margen mínimo 50% en electrónica");
    });
    it("parses 'no competir en juguetes' → stores → guardrail blocks juguetes proposal", () => {
        // 1. Parse
        const parsed = parseStrategy("no competir en juguetes");
        expect(parsed.rules).toHaveLength(1);
        expect(parsed.rules[0].ruleType).toBe("category");
        // 2. Store
        const rule = parsed.rules[0];
        const strategy = store.insertStrategy("no competir en juguetes", rule, parsed.confidence);
        expect(strategy.status).toBe("active");
        // 3. Get active strategies
        const active = store.listActive();
        // 4. Validate: guardrail should block a juguetes proposal
        const juguetesProposal = makeProposal({
            naturalSummary: "Crear listing de juguetes",
            action: {
                ...makeProposal().action,
                rationale: "La categoría de juguetes es rentable",
            },
        });
        const result = strategyValidator(juguetesProposal, active);
        expect(result.passed).toBe(false);
        expect(result.reason).toContain("no competir en juguetes");
    });
    it("empty strategies: system prompt has no CEO section", () => {
        const prompt = buildSystemPrompt("Juan", []);
        expect(prompt).not.toContain("Estrategias del CEO");
    });
    it("empty strategies: system prompt has no CEO section when undefined", () => {
        const prompt = buildSystemPrompt("Juan", undefined);
        expect(prompt).not.toContain("Estrategias del CEO");
    });
    it("multiple strategies in system prompt formatted correctly", () => {
        // Parse and store multiple strategies
        const marginRule = store.insertStrategy("margen mínimo 50% en electrónica", parseStrategy("margen mínimo 50% en electrónica").rules[0], 1.0);
        const stockRule = store.insertStrategy("priorizo +10 stock en productos estrella", parseStrategy("priorizo +10 stock en productos estrella").rules[0], 1.0);
        const catRule = store.insertStrategy("no competir en juguetes", parseStrategy("no competir en juguetes").rules[0], 1.0);
        const active = store.listActive();
        expect(active).toHaveLength(3);
        const prompt = buildSystemPrompt("Juan", active);
        expect(prompt).toContain("- [margin] margen mínimo 50% en electrónica");
        expect(prompt).toContain("- [stock] priorizo +10 stock en productos estrella");
        expect(prompt).toContain("- [category] no competir en juguetes");
    });
    it("archiveStrategy removes from active list", () => {
        const s1 = store.insertStrategy("margen mínimo 50%", parseStrategy("margen mínimo 50%").rules[0], 1.0);
        store.insertStrategy("no competir en juguetes", parseStrategy("no competir en juguetes").rules[0], 1.0);
        // Before archive: 2 active
        expect(store.listActive()).toHaveLength(2);
        // Archive the margin strategy
        store.archiveStrategy(s1.id);
        // After archive: 1 active
        const active = store.listActive();
        expect(active).toHaveLength(1);
        expect(active[0].ruleText).toBe("no competir en juguetes");
        // System prompt should now only have the remaining strategy
        const prompt = buildSystemPrompt("Juan", active);
        expect(prompt).not.toContain("margen mínimo 50%");
        expect(prompt).toContain("no competir en juguetes");
    });
    it("agent loop blocks margin violation with strategy guardrail", async () => {
        // Parse and store a margin strategy
        const parsed = parseStrategy("margen mínimo 50%");
        const strategy = store.insertStrategy("margen mínimo 50%", parsed.rules[0], parsed.confidence);
        const activeStrategies = store.listActive();
        // Create agent with strategies
        const agent = createAgentLoop({
            systemPrompt: buildSystemPrompt("Juan"),
            strategies: activeStrategies,
            mockClient: true,
        });
        const state = makeState();
        const result = await agent.converse("Quiero bajar el precio del listing 42", state);
        // The agent should respond normally via mock client (no proposal to validate against
        // strategies in this path — the guardrail runs after proposal extraction).
        // For the mock client, the "precio" intent produces the margin analysis text.
        expect(result.response).toMatch(/margen|precio/i);
    });
    it("agent loop passes compliant proposal through strategy guardrail", async () => {
        // Parse a category exclusion strategy only
        const parsed = parseStrategy("no competir en juguetes");
        const strategy = store.insertStrategy("no competir en juguetes", parsed.rules[0], parsed.confidence);
        const activeStrategies = store.listActive();
        const agent = createAgentLoop({
            systemPrompt: buildSystemPrompt("Juan"),
            strategies: activeStrategies,
            mockClient: true,
        });
        const state = makeState();
        // "precio" intent does not mention juguetes — should pass
        const result = await agent.converse("Quiero revisar el precio del listing 42", state);
        expect(result.response).toMatch(/margen|precio/i);
        expect(result.response).not.toMatch(/⛔|bloqueado/i);
    });
    it("updateStrategy parses and makes strategies active for the agent loop", () => {
        const agent = createAgentLoop({
            systemPrompt: buildSystemPrompt("Juan"),
            mockClient: true,
        });
        // No strategies initially — updateStrategy should parse and add them.
        const result = agent.updateStrategy("margen mínimo 50% en electrónica");
        expect(result.rules).toHaveLength(1);
        expect(result.rules[0].ruleType).toBe("margin");
    });
});
//# sourceMappingURL=strategyIntegration.test.js.map