import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { createStrategyStore } from "../../src/conversation/strategyStore.js";
// ── Helpers ─────────────────────────────────────────────────────────
/** Create a minimal margin ParsedRule fixture. */
function marginRule(overrides = {}) {
    return {
        ruleType: "margin",
        target: "margen",
        operator: ">=",
        value: "50%",
        priority: 5,
        originalText: "margen 50%",
        ...overrides,
    };
}
/** Create a high-priority stock ParsedRule fixture. */
function stockRule(overrides = {}) {
    return {
        ruleType: "stock",
        target: "stock",
        operator: "priorizar",
        value: "+10",
        scope: "electrónica",
        priority: 8,
        originalText: "priorizo +10 stock en electrónica",
        ...overrides,
    };
}
// ── Setup ────────────────────────────────────────────────────────────
describe("strategyStore", () => {
    let db;
    let store;
    beforeEach(() => {
        // Fresh in-memory database per test for full isolation.
        db = new Database(":memory:");
        store = createStrategyStore(db);
    });
    // ── Insert + retrieve ───────────────────────────────────────
    it("inserts and retrieves a strategy by id", () => {
        const rule = marginRule();
        const strategy = store.insertStrategy("margen 50%", rule, 1.0);
        expect(strategy.id).toBe(1);
        expect(strategy.ruleText).toBe("margen 50%");
        expect(strategy.ruleType).toBe("margin");
        expect(strategy.parsedRule).toEqual(rule);
        expect(strategy.confidence).toBe(1.0);
        expect(strategy.status).toBe("active");
        expect(strategy.createdAt).toBeTruthy();
        expect(strategy.updatedAt).toBeTruthy();
        // Retrieve same strategy
        const found = store.getStrategy(strategy.id);
        expect(found).not.toBeNull();
        expect(found.id).toBe(strategy.id);
        expect(found.ruleText).toBe("margen 50%");
    });
    it("returns null for a non-existent strategy id", () => {
        expect(store.getStrategy(999)).toBeNull();
    });
    // ── listActive ──────────────────────────────────────────────
    it("lists active strategies, excluding archived ones", () => {
        store.insertStrategy("margen 50%", marginRule(), 1.0);
        const second = store.insertStrategy("priorizo +10 stock", stockRule(), 1.0);
        // Archive the second one
        store.archiveStrategy(second.id);
        const active = store.listActive();
        expect(active).toHaveLength(1);
        expect(active[0].ruleText).toBe("margen 50%");
    });
    it("excludes superseded strategies from active list", () => {
        const old = store.insertStrategy("margen 30%", marginRule({ value: "30%", originalText: "margen 30%" }), 1.0);
        const newer = store.insertStrategy("margen 50%", marginRule(), 1.0);
        store.supersedeStrategy(old.id, newer.id);
        const active = store.listActive();
        expect(active).toHaveLength(1);
        expect(active[0].id).toBe(newer.id);
        const superseded = store.getStrategy(old.id);
        expect(superseded.status).toBe("superseded");
    });
    it("returns an empty list when no strategies exist", () => {
        expect(store.listActive()).toEqual([]);
    });
    it("returns an empty list when all strategies are archived", () => {
        const s = store.insertStrategy("margen 50%", marginRule(), 1.0);
        store.archiveStrategy(s.id);
        expect(store.listActive()).toEqual([]);
    });
    // ── Ordering ────────────────────────────────────────────────
    it("orders active strategies by priority descending", () => {
        const lowPriority = marginRule({ priority: 3, originalText: "low" });
        const highPriority = stockRule({ priority: 8 });
        const midPriority = marginRule({ priority: 5, originalText: "mid" });
        store.insertStrategy("low", lowPriority, 1.0);
        store.insertStrategy("high", highPriority, 1.0);
        store.insertStrategy("mid", midPriority, 1.0);
        const active = store.listActive();
        expect(active).toHaveLength(3);
        expect(active[0].parsedRule.priority).toBe(8);
        expect(active[1].parsedRule.priority).toBe(5);
        expect(active[2].parsedRule.priority).toBe(3);
    });
    // ── Archive ─────────────────────────────────────────────────
    it("archiveStrategy sets status to archived", () => {
        const s = store.insertStrategy("margen 50%", marginRule(), 1.0);
        expect(s.status).toBe("active");
        store.archiveStrategy(s.id);
        const archived = store.getStrategy(s.id);
        expect(archived.status).toBe("archived");
        // updatedAt is refreshed (may be identical at second granularity;
        // the updateStrategy test below covers timestamp refresh explicitly).
    });
    // ── Update ──────────────────────────────────────────────────
    it("updateStrategy preserves id and updates timestamps", () => {
        const s = store.insertStrategy("margen 50%", marginRule(), 1.0);
        const originalUpdatedAt = s.updatedAt;
        // Small delay so datetime('now') produces a different value.
        // better-sqlite3 in :memory: resolves datetime('now') at second
        // granularity; a short sleep ensures the timestamp advances.
        const waitMs = 1100;
        const start = Date.now();
        while (Date.now() - start < waitMs) {
            // busy-wait — Vitest doesn't expose vi.advanceTimers on real timers
        }
        const updated = store.updateStrategy(s.id, "margen 60%", marginRule({ value: "60%", originalText: "margen 60%" }));
        expect(updated).not.toBeNull();
        expect(updated.id).toBe(s.id);
        expect(updated.ruleText).toBe("margen 60%");
        expect(updated.parsedRule.value).toBe("60%");
        // Timestamp should be refreshed
        expect(updated.updatedAt).not.toBe(originalUpdatedAt);
    });
    it("updateStrategy returns null for non-existent id", () => {
        const result = store.updateStrategy(999, "nope", marginRule());
        expect(result).toBeNull();
    });
    // ── Supersede ────────────────────────────────────────────────
    it("supersedeStrategy marks old strategy and records replaced_by", async () => {
        const old = store.insertStrategy("margen 30%", marginRule({ value: "30%", originalText: "margen 30%" }), 1.0);
        const newer = store.insertStrategy("margen 50%", marginRule(), 1.0);
        store.supersedeStrategy(old.id, newer.id);
        const superseded = store.getStrategy(old.id);
        expect(superseded.status).toBe("superseded");
        // Verify replaced_by via raw query (the public Strategy type
        // doesn't expose replaced_by since it's internal bookkeeping).
        const row = db.prepare("SELECT replaced_by FROM ceo_strategies WHERE id = ?").get(old.id);
        expect(row.replaced_by).toBe(newer.id);
    });
    // ── JSON roundtrip ──────────────────────────────────────────
    it("preserves ParsedRule through JSON serialization roundtrip", () => {
        const rule = stockRule(); // includes scope, higher priority
        const s = store.insertStrategy("priorizo +10 stock en electrónica", rule, 0.95);
        const retrieved = store.getStrategy(s.id);
        expect(retrieved.parsedRule).toEqual(rule);
    });
    // ── count ───────────────────────────────────────────────────
    it("count reflects total rows regardless of status", () => {
        expect(store.count()).toBe(0);
        const s1 = store.insertStrategy("margen 50%", marginRule(), 1.0);
        expect(store.count()).toBe(1);
        store.insertStrategy("priorizo stock", stockRule(), 1.0);
        expect(store.count()).toBe(2);
        store.archiveStrategy(s1.id);
        // Archived rows still count
        expect(store.count()).toBe(2);
    });
});
//# sourceMappingURL=strategyStore.test.js.map