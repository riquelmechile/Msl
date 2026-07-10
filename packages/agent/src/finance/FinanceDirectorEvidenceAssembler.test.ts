import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { EconomicOutcomeStore } from "@msl/memory";
import { createSqliteEconomicOutcomeStore } from "@msl/memory";
import {
  createEconomicCostComponent,
  createEconomicOutcome,
  createUnitEconomicsSnapshot,
} from "@msl/domain";
import type { EconomicOutcome, UnitEconomicsSnapshot } from "@msl/domain";
import { FinanceDirectorEvidenceAssembler } from "./FinanceDirectorEvidenceAssembler.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function createStore(): EconomicOutcomeStore {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  return createSqliteEconomicOutcomeStore(db);
}

function clp(n: number) {
  return { amountMinor: n, currency: "CLP" as const };
}

function usd(n: number) {
  return { amountMinor: n, currency: "USD" as const };
}

const NOW = Date.now();

function makeCostComponent(
  type: string,
  amount: { amountMinor: number; currency: "CLP" | "USD" },
  sellerId = "plasticov",
) {
  const result = createEconomicCostComponent({
    sellerId,
    type: type as Parameters<typeof createEconomicCostComponent>[0]["type"],
    amount,
    source: "manual",
    occurredAt: NOW,
    observedAt: NOW,
    verification: "verified",
    confidence: 0.9,
  });
  if (!result.success) {
    throw new Error(`Failed to create cost component: ${result.error.message}`);
  }
  return result.component;
}

function makeSnapshot(
  sellerId: string,
  revenue: number,
  currency: "CLP" | "USD",
  costTypes: string[],
  overrides: Partial<{ orderId: string; itemId: string; sku: string; product: string }> = {},
): UnitEconomicsSnapshot {
  const moneyFn = currency === "CLP" ? clp : usd;
  const components = costTypes.map((t) => makeCostComponent(t, moneyFn(1000), sellerId));

  return createUnitEconomicsSnapshot({
    sellerId,
    grossRevenue: revenue,
    currency,
    costComponents: components,
    ...overrides,
  });
}

function makeOutcome(
  overrides: Partial<EconomicOutcome> & { sellerId: string },
): EconomicOutcome {
  return createEconomicOutcome({
    sellerId: overrides.sellerId,
    ...(overrides.accountId !== undefined ? { accountId: overrides.accountId } : {}),
    ...(overrides.proposalId !== undefined ? { proposalId: overrides.proposalId } : {}),
    ...(overrides.orderId !== undefined ? { orderId: overrides.orderId } : {}),
    ...(overrides.correlationId !== undefined ? { correlationId: overrides.correlationId } : {}),
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("FinanceDirectorEvidenceAssembler", () => {
  // ── Basic assembly ─────────────────────────────────────────────────────

  it("returns empty evidence when store has no data", () => {
    const store = createStore();
    const assembler = new FinanceDirectorEvidenceAssembler(store);

    const evidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
    });

    expect(evidence.snapshots).toEqual([]);
    expect(evidence.outcomes).toEqual([]);
    expect(evidence.profitSummary).toBeDefined();
    expect(evidence.profitSummary!.totalRevenue).toBe(0);
    expect(evidence.profitSummary!.snapshotCount).toBe(0);
    expect(evidence.missingInputs).toEqual([]);
    expect(evidence.sellerCurrency).toBe("CLP");
    expect(evidence.evidenceTimestamp).toBeGreaterThan(0);
  });

  it("assembles evidence with snapshots and outcomes", () => {
    const store = createStore();
    const assembler = new FinanceDirectorEvidenceAssembler(store);

    // Insert snapshots
    const snap1 = makeSnapshot("plasticov", 100000, "CLP", ["product_cost", "marketplace_fee"]);
    const snap2 = makeSnapshot("plasticov", 50000, "CLP", ["shipping"]);
    store.insertUnitEconomicsSnapshot(snap1);
    store.insertUnitEconomicsSnapshot(snap2);

    // Insert outcomes
    const out1 = makeOutcome({ sellerId: "plasticov", orderId: "ord-1" });
    const out2 = makeOutcome({ sellerId: "plasticov", orderId: "ord-2" });
    store.insertOutcome(out1);
    store.insertOutcome(out2);

    const evidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
    });

    expect(evidence.snapshots).toHaveLength(2);
    expect(evidence.outcomes).toHaveLength(2);
    expect(evidence.profitSummary).toBeDefined();
    expect(evidence.profitSummary!.totalRevenue).toBeGreaterThan(0);
    expect(evidence.profitSummary!.snapshotCount).toBeGreaterThanOrEqual(2);
  });

  // ── Profit summary ─────────────────────────────────────────────────────

  it("includes profit summary in evidence", () => {
    const store = createStore();
    const assembler = new FinanceDirectorEvidenceAssembler(store);

    store.insertUnitEconomicsSnapshot(
      makeSnapshot("plasticov", 100000, "CLP", ["product_cost"]),
    );

    const evidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
    });

    expect(evidence.profitSummary).not.toBeNull();
    expect(evidence.profitSummary!.totalRevenue).toBe(100000);
    expect(evidence.profitSummary!.snapshotCount).toBe(1);
    // Net profit should be positive (revenue 100000 > cost 1000)
    expect(evidence.profitSummary!.netProfit).toBeGreaterThan(0);
  });

  // ── Snapshot limit enforcement ─────────────────────────────────────────

  it("respects snapshot limit — enforces max 50", () => {
    const store = createStore();
    const assembler = new FinanceDirectorEvidenceAssembler(store);

    // Insert 60 snapshots
    for (let i = 0; i < 60; i++) {
      store.insertUnitEconomicsSnapshot(
        makeSnapshot("plasticov", 10000, "CLP", ["product_cost"]),
      );
    }

    const evidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
    });

    expect(evidence.snapshots.length).toBeLessThanOrEqual(50);
  });

  it("respects explicit maxSnapshots option", () => {
    const store = createStore();
    const assembler = new FinanceDirectorEvidenceAssembler(store);

    for (let i = 0; i < 30; i++) {
      store.insertUnitEconomicsSnapshot(
        makeSnapshot("plasticov", 10000, "CLP", ["product_cost"]),
      );
    }

    const evidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
      maxSnapshots: 5,
    });

    expect(evidence.snapshots.length).toBeLessThanOrEqual(5);
  });

  // ── Outcome limit enforcement ──────────────────────────────────────────

  it("respects outcome limit — enforces max 50", () => {
    const store = createStore();
    const assembler = new FinanceDirectorEvidenceAssembler(store);

    for (let i = 0; i < 60; i++) {
      store.insertOutcome(makeOutcome({ sellerId: "plasticov" }));
    }

    const evidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
    });

    expect(evidence.outcomes.length).toBeLessThanOrEqual(50);
  });

  it("respects explicit maxOutcomes option", () => {
    const store = createStore();
    const assembler = new FinanceDirectorEvidenceAssembler(store);

    for (let i = 0; i < 30; i++) {
      store.insertOutcome(makeOutcome({ sellerId: "plasticov" }));
    }

    const evidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
      maxOutcomes: 10,
    });

    expect(evidence.outcomes.length).toBeLessThanOrEqual(10);
  });

  // ── maxAge filtering ───────────────────────────────────────────────────

  it("respects maxAge — filters out old snapshots", () => {
    const store = createStore();
    const assembler = new FinanceDirectorEvidenceAssembler(store);

    // Create an old snapshot with calculatedAt in the past
    // We insert a snapshot and then use the store's snapshot directly
    const recentSnap = makeSnapshot("plasticov", 50000, "CLP", ["product_cost"]);
    store.insertUnitEconomicsSnapshot(recentSnap);

    // The recent snapshot should be within 1 hour
    const evidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
      maxAge: 3600000, // 1 hour in ms
    });

    expect(evidence.snapshots).toHaveLength(1);

    // With maxAge=0, nothing should match (snapshot was created in the past)
    const evidenceNone = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
      maxAge: 0,
    });

    expect(evidenceNone.snapshots).toEqual([]);
  });

  it("maxAge includes snapshots within the window", () => {
    const store = createStore();
    const assembler = new FinanceDirectorEvidenceAssembler(store);

    store.insertUnitEconomicsSnapshot(
      makeSnapshot("plasticov", 50000, "CLP", ["product_cost"]),
    );

    // Max age of 100 years should include everything
    const evidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
      maxAge: 100 * 365 * 86400000,
    });

    expect(evidence.snapshots).toHaveLength(1);
  });

  // ── Missing inputs detection ───────────────────────────────────────────

  it("reports missing inputs when cost types are absent", () => {
    const store = createStore();
    const assembler = new FinanceDirectorEvidenceAssembler(store);

    // Only provide shipping — product_cost and marketplace_fee missing
    store.insertUnitEconomicsSnapshot(
      makeSnapshot("plasticov", 50000, "CLP", ["shipping"]),
    );

    const evidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
    });

    expect(evidence.missingInputs).toContain("product_cost");
    expect(evidence.missingInputs).toContain("marketplace_fee");
  });

  it("missing inputs are deduplicated across snapshots", () => {
    const store = createStore();
    const assembler = new FinanceDirectorEvidenceAssembler(store);

    // Both snapshots only have product_cost — both miss shipping
    store.insertUnitEconomicsSnapshot(
      makeSnapshot("plasticov", 50000, "CLP", ["product_cost"]),
    );
    store.insertUnitEconomicsSnapshot(
      makeSnapshot("plasticov", 30000, "CLP", ["product_cost"]),
    );

    const evidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
    });

    // "shipping" should only appear once (deduplicated)
    const shippingCount = evidence.missingInputs.filter((m: string) => m === "shipping").length;
    expect(shippingCount).toBe(1);
  });

  // ── Seller isolation ───────────────────────────────────────────────────

  it("evidence is scoped to the requested seller", () => {
    const store = createStore();
    const assembler = new FinanceDirectorEvidenceAssembler(store);

    store.insertUnitEconomicsSnapshot(
      makeSnapshot("plasticov", 100000, "CLP", ["product_cost"]),
    );
    store.insertUnitEconomicsSnapshot(
      makeSnapshot("maustian", 200000, "CLP", ["product_cost"]),
    );
    store.insertOutcome(makeOutcome({ sellerId: "plasticov" }));
    store.insertOutcome(makeOutcome({ sellerId: "maustian" }));

    const plasticovEvidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
    });

    const maustianEvidence = assembler.assembleEvidence({
      sellerId: "maustian",
      currency: "CLP",
    });

    expect(plasticovEvidence.snapshots).toHaveLength(1);
    expect(plasticovEvidence.snapshots[0]!.sellerId).toBe("plasticov");
    expect(plasticovEvidence.outcomes).toHaveLength(1);
    expect(plasticovEvidence.outcomes[0]!.sellerId).toBe("plasticov");

    expect(maustianEvidence.snapshots).toHaveLength(1);
    expect(maustianEvidence.snapshots[0]!.sellerId).toBe("maustian");
    expect(maustianEvidence.outcomes).toHaveLength(1);
    expect(maustianEvidence.outcomes[0]!.sellerId).toBe("maustian");
  });

  // ── Currency scope ─────────────────────────────────────────────────────

  it("respects currency parameter", () => {
    const store = createStore();
    const assembler = new FinanceDirectorEvidenceAssembler(store);

    store.insertUnitEconomicsSnapshot(
      makeSnapshot("plasticov", 100000, "CLP", ["product_cost"]),
    );
    store.insertUnitEconomicsSnapshot(
      makeSnapshot("plasticov", 50000, "USD", ["product_cost"]),
    );

    const clpEvidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "CLP",
    });

    const usdEvidence = assembler.assembleEvidence({
      sellerId: "plasticov",
      currency: "USD",
    });

    // Snapshots includes all (snapshot list is not currency-filtered)
    expect(clpEvidence.snapshots).toHaveLength(2);
    expect(usdEvidence.snapshots).toHaveLength(2);

    // But profit summary should be currency-specific
    // CLP profit summary should only sum CLP snapshots
    expect(clpEvidence.profitSummary!.totalRevenue).toBe(100000);
    expect(usdEvidence.profitSummary!.totalRevenue).toBe(50000);
  });
});
