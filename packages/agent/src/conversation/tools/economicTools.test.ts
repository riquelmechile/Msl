import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { UnitEconomicsSnapshot } from "@msl/domain";
import {
  createEconomicCostComponent,
  createEconomicOutcome,
  createUnitEconomicsSnapshot,
} from "@msl/domain";
import type { EconomicOutcomeStore } from "@msl/memory";
import { createSqliteEconomicOutcomeStore } from "@msl/memory";
import {
  createInspectUnitEconomicsTool,
  createInspectEconomicOutcomeTool,
  createListMissingEconomicInputsTool,
  createSummarizeProfitTool,
  createInspectCostComponentsTool,
  createInspectEvidenceReferencesTool,
  createInspectCoverageTool,
  createReconcileSellerEconomicsTool,
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

function makeSnapshot(
  overrides: Partial<UnitEconomicsSnapshot> & { sellerId: string },
): UnitEconomicsSnapshot {
  return createUnitEconomicsSnapshot({
    sellerId: overrides.sellerId,
    grossRevenue: 100000,
    currency: overrides.currency ?? "CLP",
    costComponents: [],
    ...(overrides.sku !== undefined ? { sku: overrides.sku } : {}),
    ...(overrides.orderId !== undefined ? { orderId: overrides.orderId } : {}),
    ...(overrides.itemId !== undefined ? { itemId: overrides.itemId } : {}),
    ...(overrides.accountId !== undefined ? { accountId: overrides.accountId } : {}),
    ...(overrides.channel !== undefined ? { channel: overrides.channel } : {}),
    ...(overrides.product !== undefined ? { product: overrides.product } : {}),
    ...(overrides.period !== undefined ? { period: overrides.period } : {}),
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

  it("returns snapshots for valid seller", async () => {
    const store = createStore();
    store.insertUnitEconomicsSnapshot(makeSnapshot({ sellerId: "plasticov" }));
    store.insertUnitEconomicsSnapshot(makeSnapshot({ sellerId: "plasticov" }));

    const tool = createInspectUnitEconomicsTool(store);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);

    const data = result.data as { snapshots: unknown[]; total: number };
    expect(data.snapshots.length).toBe(2);
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

// ── summarize_profit tests ──────────────────────────────────────────────────

describe("summarize_profit", () => {
  it("returns store-unavailable error when store is missing", async () => {
    const tool = createSummarizeProfitTool(undefined);
    const result = await tool.execute({ sellerId: "plasticov", currency: "CLP" });
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns error when sellerId is missing", async () => {
    const store = createStore();
    const tool = createSummarizeProfitTool(store);
    const result = await tool.execute({ currency: "CLP" });
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns error when currency is missing", async () => {
    const store = createStore();
    const tool = createSummarizeProfitTool(store);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns error for invalid currency", async () => {
    const store = createStore();
    const tool = createSummarizeProfitTool(store);
    const result = await tool.execute({ sellerId: "plasticov", currency: "EUR" });
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns zeroes when no data exists", async () => {
    const store = createStore();
    const tool = createSummarizeProfitTool(store);
    const result = await tool.execute({ sellerId: "plasticov", currency: "CLP" });
    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.totalRevenue).toBe(0);
    expect(data.totalCosts).toBe(0);
    expect(data.netProfit).toBe(0);
    expect(data.snapshotCount).toBe(0);
  });

  it("returns profit summary for valid seller and currency", async () => {
    const store = createStore();
    store.insertUnitEconomicsSnapshot(makeSnapshot({ sellerId: "plasticov", currency: "CLP" }));

    const tool = createSummarizeProfitTool(store);
    const result = await tool.execute({ sellerId: "plasticov", currency: "CLP" });
    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.sellerId).toBe("plasticov");
    expect(data.currency).toBe("CLP");
    expect(typeof data.totalRevenue).toBe("number");
    expect(typeof data.netProfit).toBe("number");
  });
});

// ── inspect_cost_components tests ───────────────────────────────────────────

describe("inspect_cost_components", () => {
  it("returns unavailable when store is missing", async () => {
    const tool = createInspectCostComponentsTool(undefined);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("unavailable");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns error when sellerId is missing", async () => {
    const store = createStore();
    const tool = createInspectCostComponentsTool(store);
    const result = await tool.execute({});
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("rejects invalid type filter", async () => {
    const store = createStore();
    const tool = createInspectCostComponentsTool(store);
    const result = await tool.execute({ sellerId: "plasticov", type: "invalid_type" });
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns empty list when no components exist", async () => {
    const store = createStore();
    const tool = createInspectCostComponentsTool(store);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as { components: unknown[]; total: number };
    expect(data.components).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("respects limit parameter", async () => {
    const store = createStore();
    // Insert multiple cost components
    for (let i = 0; i < 10; i++) {
      store.insertCostComponent({
        sellerId: "plasticov",
        type: "shipping",
        amount: { amountMinor: 1000 + i * 100, currency: "CLP" },
        source: "mercadolibre",
        sourceRecordId: `order-${i}`,
        economicMeaning: "shipping_cost",
        sourceVersion: "v1",
        occurredAt: Date.now(),
        observedAt: Date.now(),
        verification: "verified",
        confidence: 0.9,
      });
    }

    const tool = createInspectCostComponentsTool(store);
    const result = await tool.execute({ sellerId: "plasticov", limit: 3 });
    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as { components: unknown[]; total: number };
    expect(data.components.length).toBe(3);
    expect(data.total).toBe(3);
  });
});

// ── inspect_evidence_references tests ───────────────────────────────────────

describe("inspect_evidence_references", () => {
  it("returns unavailable when store is not provided", async () => {
    const tool = createInspectEvidenceReferencesTool(undefined);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("unavailable");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as { message: string; sellerId: string };
    expect(data.message).toContain("no está disponible");
    expect(data.sellerId).toBe("plasticov");
  });

  it("returns error when sellerId is missing", async () => {
    const tool = createInspectEvidenceReferencesTool(undefined);
    const result = await tool.execute({});
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });
});

// ── inspect_coverage tests ──────────────────────────────────────────────────

describe("inspect_coverage", () => {
  it("returns unavailable when store is missing", async () => {
    const tool = createInspectCoverageTool(undefined);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("unavailable");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns error when sellerId is missing", async () => {
    const store = createStore();
    const tool = createInspectCoverageTool(store);
    const result = await tool.execute({});
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns coverage report for seller with no data", async () => {
    const store = createStore();
    const tool = createInspectCoverageTool(store);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as { coverage: Record<string, unknown> };
    expect(data.coverage.sellerId).toBe("plasticov");
    expect(data.coverage.overallStatus).toBe("partial");
  });

  it("returns coverage report with cost components present", async () => {
    const store = createStore();
    store.insertCostComponent({
      sellerId: "plasticov",
      type: "marketplace_fee",
      amount: { amountMinor: 500, currency: "CLP" },
      source: "mercadolibre",
      sourceRecordId: "order-1",
      economicMeaning: "sale_fee",
      sourceVersion: "v1",
      occurredAt: Date.now(),
      observedAt: Date.now(),
      verification: "verified",
      confidence: 1.0,
    });

    const tool = createInspectCoverageTool(store);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as { coverage: Record<string, unknown> };
    expect(data.coverage.sellerId).toBe("plasticov");
    // marketplace_fee should be complete
    const dims = data.coverage.dimensions as Record<string, string>;
    expect(dims.marketplace_fee).toBe("complete");
  });
});

// ── reconcile_seller_economics tests ────────────────────────────────────────

describe("reconcile_seller_economics", () => {
  it("returns unavailable when store is missing", async () => {
    const tool = createReconcileSellerEconomicsTool(undefined);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("unavailable");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns error when sellerId is missing", async () => {
    const store = createStore();
    const tool = createReconcileSellerEconomicsTool(store);
    const result = await tool.execute({});
    expect(result.status).toBe("error");
    expect(result.noExternalMutationExecuted).toBe(true);
  });

  it("returns incomplete when no snapshots exist", async () => {
    const store = createStore();
    const tool = createReconcileSellerEconomicsTool(store);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as { verdict: string };
    expect(data.verdict).toBe("incomplete");
  });

  it("returns incomplete when only one side has data", async () => {
    const store = createStore();
    store.insertCostComponent({
      sellerId: "plasticov",
      type: "shipping",
      amount: { amountMinor: 1000, currency: "CLP" },
      source: "mercadolibre",
      economicMeaning: "shipping",
      sourceVersion: "v1",
      occurredAt: Date.now(),
      observedAt: Date.now(),
      verification: "verified",
      confidence: 0.9,
    });

    const tool = createReconcileSellerEconomicsTool(store);
    const result = await tool.execute({ sellerId: "plasticov" });
    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as { verdict: string };
    expect(data.verdict).toBe("incomplete");
  });

  it("returns balanced when no data on either side", async () => {
    const store = createStore();
    // No snapshots, no cost components → both empty → balanced
    const tool = createReconcileSellerEconomicsTool(store);
    const result = await tool.execute({ sellerId: "maustian" });
    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as { verdict: string };
    expect(data.verdict).toBe("incomplete");
  });

  it("returns balanced-with-tolerance for minor difference", async () => {
    const store = createStore();
    // Insert a cost component
    store.insertCostComponent({
      sellerId: "plasticov",
      type: "shipping",
      amount: { amountMinor: 1000, currency: "CLP" },
      source: "mercadolibre",
      economicMeaning: "shipping",
      sourceVersion: "v1",
      occurredAt: Date.now(),
      observedAt: Date.now(),
      verification: "verified",
      confidence: 0.9,
    });

    // Create a snapshot with matching cost component (will compute shipping=1000)
    const compResult = createEconomicCostComponent({
      sellerId: "plasticov",
      type: "shipping",
      amount: { amountMinor: 1000, currency: "CLP" },
      source: "mercadolibre",
      occurredAt: Date.now(),
      observedAt: Date.now(),
      verification: "verified",
      confidence: 0.9,
    });
    expect(compResult.success).toBe(true);

    const snapshot = createUnitEconomicsSnapshot({
      sellerId: "plasticov",
      currency: "CLP",
      grossRevenue: 10000,
      costComponents: compResult.success ? [compResult.component] : [],
    });
    store.insertUnitEconomicsSnapshot(snapshot);

    const tool = createReconcileSellerEconomicsTool(store);
    const result = await tool.execute({ sellerId: "plasticov", tolerance: 5 });
    expect(result.status).toBe("ok");
    expect(result.noExternalMutationExecuted).toBe(true);
    const data = result.data as { verdict: string };
    // Store has 1000 shipping cost, snapshot computed with 1000 shipping cost → balanced
    expect(data.verdict).toBe("balanced");
  });
});
