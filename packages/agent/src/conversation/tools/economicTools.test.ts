import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createEconomicOutcome } from "@msl/domain";
import type { EconomicOutcomeStore } from "@msl/memory";
import { createSqliteEconomicOutcomeStore } from "@msl/memory";
import {
  createInspectUnitEconomicsTool,
  createInspectEconomicOutcomeTool,
  createListMissingEconomicInputsTool,
} from "./economicTools.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function createStore(): EconomicOutcomeStore {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  return createSqliteEconomicOutcomeStore(db);
}

function makeOutcome(sellerId: string, overrides: Record<string, string> = {}) {
  return createEconomicOutcome({
    sellerId,
    ...overrides,
  });
}

// ── inspct_unit_economics tests ─────────────────────────────────────────────

describe("inspect_unit_economics", () => {
  it("returns store-unavailable error when store is missing", async () => {
    const tool = createInspectUnitEconomicsTool(undefined);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns error when sellerId is missing", async () => {
    const store = createStore();
    const tool = createInspectUnitEconomicsTool(store);
    const result = await tool.execute({});
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns outcomes for valid seller", async () => {
    const store = createStore();
    store.insertOutcome(makeOutcome("plasticov"));
    store.insertOutcome(makeOutcome("plasticov"));

    const tool = createInspectUnitEconomicsTool(store);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);

    const data = result.data as { outcomes: unknown[]; total: number };
    expect(data.outcomes.length).toBe(2);
    expect(data.total).toBe(2);
  });
});

// ── inspct_economic_outcome tests ───────────────────────────────────────────

describe("inspect_economic_outcome", () => {
  it("returns store-unavailable error when store is missing", async () => {
    const tool = createInspectEconomicOutcomeTool(undefined);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns error when sellerId is missing", async () => {
    const store = createStore();
    const tool = createInspectEconomicOutcomeTool(store);
    const result = await tool.execute({});
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns null for non-existent outcome", async () => {
    const store = createStore();
    const tool = createInspectEconomicOutcomeTool(store);
    const result = await tool.execute({
      sellerId: "plasticov",
      outcomeId: "nonexistent",
    });
    expect(result.status).toBe("ok");
    expect(result.data).toBeNull();
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns single outcome by ID", async () => {
    const store = createStore();
    const outcome = makeOutcome("plasticov");
    store.insertOutcome(outcome);

    const tool = createInspectEconomicOutcomeTool(store);
    const result = await tool.execute({
      sellerId: "plasticov",
      outcomeId: outcome.outcomeId,
    });
    expect(result.status).toBe("ok");
    const data = result.data as Record<string, unknown>;
    expect(data.outcomeId).toBe(outcome.outcomeId);
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("rejects invalid status filter", async () => {
    const store = createStore();
    const tool = createInspectEconomicOutcomeTool(store);
    const result = await tool.execute({
      sellerId: "plasticov",
      status: "unknown",
    });
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("seller isolation — Plasticov cannot see Maustian outcome", async () => {
    const store = createStore();
    const maustianOutcome = makeOutcome("maustian");
    store.insertOutcome(maustianOutcome);

    const tool = createInspectEconomicOutcomeTool(store);
    const result = await tool.execute({
      sellerId: "plasticov",
      outcomeId: maustianOutcome.outcomeId,
    });
    expect(result.data).toBeNull();
  });

  it("lists outcomes with limit", async () => {
    const store = createStore();
    for (let i = 0; i < 10; i++) {
      store.insertOutcome(makeOutcome("plasticov"));
    }

    const tool = createInspectEconomicOutcomeTool(store);
    const result = await tool.execute({
      sellerId: "plasticov",
      limit: 3,
    });
    expect(result.status).toBe("ok");
    const data = result.data as { outcomes: unknown[]; total: number };
    expect(data.outcomes.length).toBe(3);
    expect(data.total).toBe(3);
  });
});

// ── list_missing_economic_inputs tests ──────────────────────────────────────

describe("list_missing_economic_inputs", () => {
  it("returns store-unavailable error when store is missing", async () => {
    const tool = createListMissingEconomicInputsTool(undefined);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns error when sellerId is missing", async () => {
    const store = createStore();
    const tool = createListMissingEconomicInputsTool(store);
    const result = await tool.execute({});
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns empty list when no snapshots exist", async () => {
    const store = createStore();
    const tool = createListMissingEconomicInputsTool(store);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("ok");
    const data = result.data as { missingInputs: string[] };
    expect(data.missingInputs).toEqual([]);
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns correct result with noExternalMutationExecuted", async () => {
    const store = createStore();
    const tool = createListMissingEconomicInputsTool(store);
    const result = await tool.execute({ sellerId: "maustian" });
    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
  });
});
