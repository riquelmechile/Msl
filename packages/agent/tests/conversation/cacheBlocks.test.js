import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createGraphEngine } from "@msl/memory";
import { buildDailyAggregates, injectCortexContext, assembleMessages, } from "../../src/conversation/cacheBlocks.js";
describe("buildDailyAggregates (Block B)", () => {
    it("returns a non-empty string with business metrics", () => {
        const block = buildDailyAggregates();
        expect(block.length).toBeGreaterThan(200);
    });
    it("contains MercadoLibre placeholder data (Plasticov identity)", () => {
        const block = buildDailyAggregates();
        expect(block).toMatch(/Plasticov|Maustian/);
    });
    it("includes daily metrics: ventas, margen, reputación", () => {
        const block = buildDailyAggregates();
        expect(block).toMatch(/ventas/i);
        expect(block).toMatch(/margen/i);
        expect(block).toMatch(/reputación/i);
    });
    it("includes active categories count", () => {
        const block = buildDailyAggregates();
        expect(block).toMatch(/categorías/i);
        expect(block).toMatch(/Hogar y Muebles/);
    });
    it("includes priority suggestions", () => {
        const block = buildDailyAggregates();
        expect(block).toMatch(/prioridades/i);
    });
});
describe("injectCortexContext (Block C)", () => {
    let engine;
    beforeEach(() => {
        engine = createGraphEngine();
    });
    afterEach(() => {
        engine.db.close();
    });
    it("returns empty string when the graph has no matching nodes", () => {
        const result = injectCortexContext("ventas", engine);
        expect(result).toBe("");
    });
    it("returns context string when graph has matching nodes and edges", () => {
        // Create nodes related to "ventas".
        const ventas = engine.createNode("ventas_diarias", { total: 500000 });
        const margen = engine.createNode("margen_promedio", { valor: 32.4 });
        const inventario = engine.createNode("inventario_critico", { items: 8 });
        // Create edges connecting them.
        engine.createEdge(ventas.id, margen.id);
        engine.createEdge(margen.id, inventario.id);
        const result = injectCortexContext("ventas y margen", engine);
        // Should contain context from traversal.
        expect(result).not.toBe("");
        expect(result).toMatch(/Contexto de memoria/);
        expect(result).toMatch(/ventas_diarias|margen_promedio/);
    });
    it("returns empty string when query has only very short terms (< 3 chars)", () => {
        engine.createNode("ventas", {});
        const result = injectCortexContext("de la", engine);
        expect(result).toBe("");
    });
    it("includes edge information in context output", () => {
        const a = engine.createNode("ventas_diarias", {});
        const b = engine.createNode("margen", {});
        engine.createEdge(a.id, b.id);
        const result = injectCortexContext("ventas margen", engine);
        // Should mention connections recorridas.
        expect(result).toMatch(/Conexiones recorridas|activados/);
    });
    it("propagates activation to connected nodes", () => {
        const a = engine.createNode("ventas", {});
        const b = engine.createNode("margen", {});
        const c = engine.createNode("inventario", {});
        engine.createEdge(a.id, b.id);
        engine.createEdge(b.id, c.id);
        const result = injectCortexContext("ventas", engine);
        // Activation should spread from ventas to its connected nodes.
        expect(result).toMatch(/ventas/);
    });
});
describe("assembleMessages", () => {
    const blockA = "Eres Plasticov, asistente comercial.";
    const blockB = "## Ventas hoy: $340.500";
    const blockC = "## Contexto Cortex: ventas activadas";
    it("places system prompt (Block A + B) at position 0 (prefix-cache anchor)", () => {
        const messages = assembleMessages(blockA, blockB, "", [], "Hola");
        expect(messages).toHaveLength(2);
        expect(messages[0].role).toBe("system");
        expect(messages[0].content).toContain(blockA);
        expect(messages[0].content).toContain(blockB);
        expect(messages[1].role).toBe("user");
    });
    it("includes conversation history between system prompt and latest user message", () => {
        const history = [
            { role: "user", content: "¿Cómo van las ventas?", timestamp: new Date() },
            { role: "assistant", content: "Las ventas van bien.", timestamp: new Date() },
        ];
        const messages = assembleMessages(blockA, blockB, "", history, "Gracias");
        expect(messages).toHaveLength(4);
        expect(messages[0].role).toBe("system");
        expect(messages[1].role).toBe("user");
        expect(messages[1].content).toContain("¿Cómo van las ventas?");
        expect(messages[2].role).toBe("assistant");
        expect(messages[2].content).toContain("Las ventas van bien.");
        expect(messages[3].role).toBe("user");
        expect(messages[3].content).toContain("Gracias");
    });
    it("injects Block C into the latest user message", () => {
        const messages = assembleMessages(blockA, blockB, blockC, [], "Hola");
        expect(messages).toHaveLength(2);
        const userMsg = messages[1];
        expect(userMsg.role).toBe("user");
        expect(userMsg.content).toContain("Hola");
        expect(userMsg.content).toContain(blockC);
    });
    it("does not inject Block C when it is empty", () => {
        const messages = assembleMessages(blockA, blockB, "", [], "Consulta");
        expect(messages).toHaveLength(2);
        const userMsg = messages[1];
        expect(userMsg.content).toBe("Consulta");
        expect(userMsg.content).not.toContain("Contexto de memoria");
    });
    it("filters out tool and system messages from history (only user/assistant retained)", () => {
        const history = [
            { role: "system", content: "old system", timestamp: new Date() },
            { role: "user", content: "Hola", timestamp: new Date() },
            { role: "tool", content: "{}", timestamp: new Date(), toolCallId: "c1" },
            { role: "assistant", content: "Respuesta", timestamp: new Date() },
        ];
        const messages = assembleMessages(blockA, blockB, "", history, "Siguiente");
        // Expected: system (blockA+B), user "Hola", assistant "Respuesta", user "Siguiente"
        expect(messages).toHaveLength(4);
        expect(messages[1].content).toBe("Hola");
        expect(messages[2].content).toBe("Respuesta");
        expect(messages[3].content).toBe("Siguiente");
    });
    it("handles empty history array", () => {
        const messages = assembleMessages(blockA, blockB, blockC, [], "Hola");
        expect(messages).toHaveLength(2);
        expect(messages[0].role).toBe("system");
        expect(messages[1].role).toBe("user");
    });
});
//# sourceMappingURL=cacheBlocks.test.js.map