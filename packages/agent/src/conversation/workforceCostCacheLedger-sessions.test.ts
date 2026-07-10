import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";

import { createWorkforceCostCacheLedgerStore } from "../../src/conversation/workforceCostCacheLedgerStore.js";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("workforceCostCacheLedgerStore — session attribution", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  it("migrates seller_id column idempotently", () => {
    // First creation
    const store1 = createWorkforceCostCacheLedgerStore(db);
    expect(store1).toBeDefined();

    // Re-create — should not error (idempotent)
    const store2 = createWorkforceCostCacheLedgerStore(db);
    expect(store2).toBeDefined();
  });

  it("insertEntry accepts optional sellerId, sessionId, stablePromptHash, evidenceHash", () => {
    const store = createWorkforceCostCacheLedgerStore(db);

    const entry = store.insertEntry({
      entryId: "ledger-session-1",
      agentId: "unanswered-questions",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      operation: "work-session",
      inputTokens: 500,
      outputTokens: 200,
      sellerId: "plasticov",
      sessionId: "aws-plasticov-1",
      stablePromptHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      evidenceHash: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
    });

    expect(entry.entryId).toBe("ledger-session-1");
    expect(entry.agentId).toBe("unanswered-questions");
  });

  it("insertEntry is backward compatible — omitting new fields works", () => {
    const store = createWorkforceCostCacheLedgerStore(db);

    // Old-style entry without new fields
    const entry = store.insertEntry({
      entryId: "old-style-1",
      agentId: "old-agent",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      operation: "reasoning",
      inputTokens: 100,
      outputTokens: 50,
    });

    expect(entry.entryId).toBe("old-style-1");
    // Should not throw
  });

  it("recordAgentSessionUsage stores entry with session context", () => {
    const store = createWorkforceCostCacheLedgerStore(db);

    const entry = store.recordAgentSessionUsage!({
      entryId: "session-usage-1",
      agentId: "unanswered-questions",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      operation: "work-session",
      inputTokens: 1000,
      outputTokens: 300,
      sellerId: "plasticov",
      sessionId: "aws-123",
    });

    expect(entry).toBeDefined();
  });

  it("aggregateCostByAgentAndSeller returns per-agent costs for a seller", () => {
    const store = createWorkforceCostCacheLedgerStore(db);

    // Plasticov entries
    store.insertEntry({
      entryId: "pno-1",
      agentId: "agent-a",
      provider: "deepseek",
      model: "deep-v4",
      operation: "session",
      inputTokens: 400,
      outputTokens: 100,
      estimatedCostMicros: 500,
      sellerId: "plasticov",
    });
    store.insertEntry({
      entryId: "pno-2",
      agentId: "agent-a",
      provider: "deepseek",
      model: "deep-v4",
      operation: "session",
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostMicros: 200,
      sellerId: "plasticov",
    });
    store.insertEntry({
      entryId: "pno-3",
      agentId: "agent-b",
      provider: "deepseek",
      model: "deep-v4",
      operation: "session",
      inputTokens: 200,
      outputTokens: 80,
      estimatedCostMicros: 300,
      sellerId: "plasticov",
    });

    // Maustian entry (should not appear)
    store.insertEntry({
      entryId: "mno-1",
      agentId: "agent-a",
      provider: "deepseek",
      model: "deep-v4",
      operation: "session",
      inputTokens: 999,
      outputTokens: 999,
      estimatedCostMicros: 9999,
      sellerId: "maustian",
    });

    const plasticovCosts = store.aggregateCostByAgentAndSeller!("plasticov");
    expect(plasticovCosts.has("agent-a")).toBe(true);
    expect(plasticovCosts.has("agent-b")).toBe(true);

    const agentACost = plasticovCosts.get("agent-a")!;
    expect(agentACost.inputTokens).toBe(500); // 400 + 100
    expect(agentACost.costMicros).toBe(700); // 500 + 200

    // Maustian should be isolated
    const maustianCosts = store.aggregateCostByAgentAndSeller!("maustian");
    expect(maustianCosts.get("agent-a")!.inputTokens).toBe(999);
  });

  it("aggregateCacheEfficiencyBySeller computes per-seller cache ratio", () => {
    const store = createWorkforceCostCacheLedgerStore(db);

    // Plasticov: 400 hit / 100 miss → 0.8 ratio
    store.insertEntry({
      entryId: "ce-pn1",
      agentId: "agent-a",
      provider: "deepseek",
      model: "v4",
      operation: "session",
      promptCacheHitTokens: 400,
      promptCacheMissTokens: 100,
      sellerId: "plasticov",
    });

    // Maustian: 50 hit / 450 miss → 0.1 ratio
    store.insertEntry({
      entryId: "ce-mn1",
      agentId: "agent-a",
      provider: "deepseek",
      model: "v4",
      operation: "session",
      promptCacheHitTokens: 50,
      promptCacheMissTokens: 450,
      sellerId: "maustian",
    });

    const plasticovEfficiency = store.aggregateCacheEfficiencyBySeller!("plasticov");
    expect(plasticovEfficiency).toBeCloseTo(0.8, 1);

    const maustianEfficiency = store.aggregateCacheEfficiencyBySeller!("maustian");
    expect(maustianEfficiency).toBeCloseTo(0.1, 1);
  });
});
