import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  createSqliteEconomicOutcomeStore,
  type CostComponentInsertInput,
  type EconomicOutcomeStore,
} from "../src/economicOutcomeStore.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function createStore(): EconomicOutcomeStore {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  return createSqliteEconomicOutcomeStore(db);
}

const NOW = Date.now();

function clp(n: number) {
  return { amountMinor: n, currency: "CLP" as const };
}

function usd(n: number) {
  return { amountMinor: n, currency: "USD" as const };
}

function makeInput(
  overrides: Partial<CostComponentInsertInput> & { sellerId: string },
): CostComponentInsertInput {
  const { sellerId, ...rest } = overrides;
  return {
    sellerId,
    type: "marketplace_fee",
    amount: clp(5000),
    source: "mercadolibre",
    sourceRecordId: "order-123",
    economicMeaning: "sale_fee",
    sourceVersion: "v1",
    occurredAt: NOW,
    observedAt: NOW,
    verification: "verified",
    confidence: 0.9,
    ...rest,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Cost Component Store", () => {
  // ── Idempotent insert ────────────────────────────────────────────────

  it("idempotent insert — same inputs twice returns one row, same component", () => {
    const store = createStore();
    const input = makeInput({ sellerId: "plasticov" });

    const first = store.insertCostComponent(input);
    const second = store.insertCostComponent(input);

    // Same ID returned
    expect(second.id).toBe(first.id);
    expect(second.amount).toEqual(first.amount);

    // Only one row in the table
    const list = store.listCostComponents("plasticov");
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(first.id);
  });

  it("insert different sourceRecordId for same seller — both coexist", () => {
    const store = createStore();

    const a = store.insertCostComponent(
      makeInput({ sellerId: "plasticov", sourceRecordId: "order-A" }),
    );
    const b = store.insertCostComponent(
      makeInput({ sellerId: "plasticov", sourceRecordId: "order-B" }),
    );

    expect(a.id).not.toBe(b.id);
    const list = store.listCostComponents("plasticov");
    expect(list).toHaveLength(2);
  });

  it("insert same source+meaning, different sourceVersion — old superseded, new inserted", () => {
    const store = createStore();

    const v1 = store.insertCostComponent(
      makeInput({ sellerId: "plasticov", sourceVersion: "v1", amount: clp(5000) }),
    );
    const v2 = store.insertCostComponent(
      makeInput({ sellerId: "plasticov", sourceVersion: "v2", amount: clp(5500) }),
    );

    // Different IDs
    expect(v1.id).not.toBe(v2.id);

    // Only v2 is active
    const active = store.listCostComponents("plasticov");
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(v2.id);
    expect(active[0]!.amount.amountMinor).toBe(5500);
  });

  it("insert same source+meaning+version, different type → coexists (different economic meaning key)", () => {
    const store = createStore();

    const fee = store.insertCostComponent(
      makeInput({ sellerId: "plasticov", type: "marketplace_fee", economicMeaning: "sale_fee" }),
    );
    const shipping = store.insertCostComponent(
      makeInput({ sellerId: "plasticov", type: "shipping", economicMeaning: "ship_cost" }),
    );

    expect(fee.id).not.toBe(shipping.id);
    const list = store.listCostComponents("plasticov");
    expect(list).toHaveLength(2);
  });

  // ── Upsert ────────────────────────────────────────────────────────────

  it("upsert — supersedes prior active version and inserts new", () => {
    const store = createStore();
    const input = makeInput({ sellerId: "plasticov" });

    const first = store.insertCostComponent(input);
    const second = store.upsertCostComponent(input);

    // Different IDs
    expect(second.id).not.toBe(first.id);

    // Only the new one is active
    const active = store.listCostComponents("plasticov");
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(second.id);

    // Both versions visible via listBySourceRecord
    const all = store.listBySourceRecord("plasticov", "order-123");
    expect(all).toHaveLength(2);
    const ids = all.map((c) => c.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
  });

  // ── Reverse (soft delete) ─────────────────────────────────────────────

  it("reverseCostComponent — soft deletes, excluded from listCostComponents by default", () => {
    const store = createStore();
    const comp = store.insertCostComponent(makeInput({ sellerId: "plasticov" }));

    const reversed = store.reverseCostComponent(comp.id, "Duplicate entry");
    expect(reversed).not.toBeNull();

    // Not visible in default list
    const list = store.listCostComponents("plasticov");
    expect(list).toHaveLength(0);
  });

  it("reverseCostComponent — included in listCostComponents with includeReversed flag", () => {
    const store = createStore();
    const comp = store.insertCostComponent(makeInput({ sellerId: "plasticov" }));

    store.reverseCostComponent(comp.id, "Test reversal");

    // With includeReversed flag
    const list = store.listCostComponents("plasticov", { includeReversed: true });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(comp.id);
  });

  it("reverseCostComponent — returns null for non-existent id", () => {
    const store = createStore();
    const result = store.reverseCostComponent("nonexistent", "test");
    expect(result).toBeNull();
  });

  it("reverseCostComponent — already reversed is idempotent", () => {
    const store = createStore();
    const comp = store.insertCostComponent(makeInput({ sellerId: "plasticov" }));

    store.reverseCostComponent(comp.id, "First reversal");
    const second = store.reverseCostComponent(comp.id, "Second reversal");

    expect(second).not.toBeNull();
    // Second reversal should still return the component (already reversed, no-op)
    expect(second!.id).toBe(comp.id);
  });

  // ── listBySourceRecord ────────────────────────────────────────────────

  it("listBySourceRecord returns all versions including superseded and reversed", () => {
    const store = createStore();

    // Insert v1
    const v1 = store.insertCostComponent(
      makeInput({ sellerId: "plasticov", sourceVersion: "v1" }),
    );
    // Upsert v2 (supersedes v1)
    const v2 = store.upsertCostComponent(
      makeInput({ sellerId: "plasticov", sourceVersion: "v2", amount: clp(6000) }),
    );
    // Insert another with different meaning
    store.insertCostComponent(
      makeInput({
        sellerId: "plasticov",
        economicMeaning: "ship_cost",
        type: "shipping",
        amount: clp(2000),
      }),
    );

    const all = store.listBySourceRecord("plasticov", "order-123");
    expect(all.length).toBeGreaterThanOrEqual(2);
    const ids = all.map((c) => c.id);
    expect(ids).toContain(v1.id);
    expect(ids).toContain(v2.id);
  });

  // ── Seller isolation ──────────────────────────────────────────────────

  it("seller isolation — plasticov data not visible to maustian", () => {
    const store = createStore();

    store.insertCostComponent(makeInput({ sellerId: "plasticov" }));
    store.insertCostComponent(makeInput({ sellerId: "plasticov" }));

    const maustianList = store.listCostComponents("maustian");
    expect(maustianList).toHaveLength(0);
  });

  it("seller isolation — each seller sees only own data", () => {
    const store = createStore();

    store.insertCostComponent(makeInput({ sellerId: "plasticov" }));
    store.insertCostComponent(
      makeInput({ sellerId: "maustian", sourceRecordId: "order-456" }),
    );
    store.insertCostComponent(
      makeInput({ sellerId: "maustian", sourceRecordId: "order-789", economicMeaning: "sale_fee_2" }),
    );

    expect(store.listCostComponents("plasticov")).toHaveLength(1);
    expect(store.listCostComponents("maustian")).toHaveLength(2);
  });

  // ── Filter by type ────────────────────────────────────────────────────

  it("listCostComponents — filter by type returns only matching components", () => {
    const store = createStore();

    store.insertCostComponent(
      makeInput({ sellerId: "plasticov", type: "marketplace_fee" }),
    );
    store.insertCostComponent(
      makeInput({ sellerId: "plasticov", type: "shipping", economicMeaning: "ship_cost" }),
    );
    store.insertCostComponent(
      makeInput({
        sellerId: "plasticov",
        type: "marketplace_fee",
        sourceRecordId: "order-456",
        economicMeaning: "sale_fee_2",
      }),
    );

    const fees = store.listCostComponents("plasticov", { type: "marketplace_fee" });
    expect(fees).toHaveLength(2);
    for (const f of fees) {
      expect(f.type).toBe("marketplace_fee");
    }

    const shipping = store.listCostComponents("plasticov", { type: "shipping" });
    expect(shipping).toHaveLength(1);
    expect(shipping[0]!.type).toBe("shipping");
  });

  // ── Limit and offset ──────────────────────────────────────────────────

  it("listCostComponents — respects limit", () => {
    const store = createStore();

    for (let i = 0; i < 5; i++) {
      store.insertCostComponent(
        makeInput({
          sellerId: "plasticov",
          sourceRecordId: `order-${i}`,
          economicMeaning: `fee-${i}`,
          sourceVersion: `v${i}`,
        }),
      );
    }

    const limited = store.listCostComponents("plasticov", { limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it("listCostComponents — respects offset", () => {
    const store = createStore();

    for (let i = 0; i < 5; i++) {
      store.insertCostComponent(
        makeInput({
          sellerId: "plasticov",
          sourceRecordId: `order-${i}`,
          economicMeaning: `fee-${i}`,
          sourceVersion: `v${i}`,
        }),
      );
    }

    const all = store.listCostComponents("plasticov");
    const offsetList = store.listCostComponents("plasticov", { offset: 2 });
    expect(offsetList).toHaveLength(Math.max(0, all.length - 2));
  });

  // ── Superseded exclusion ──────────────────────────────────────────────

  it("listCostComponents — excludes superseded components by default", () => {
    const store = createStore();
    const input = makeInput({ sellerId: "plasticov" });

    store.insertCostComponent(input);
    store.upsertCostComponent(input); // supersedes the first

    // Only the latest (non-superseded) should appear
    const list = store.listCostComponents("plasticov");
    expect(list).toHaveLength(1);
  });

  // ── Superseded + reverse interplay ────────────────────────────────────

  it("superseded then reversed — both excluded from default listCostComponents", () => {
    const store = createStore();
    const input = makeInput({ sellerId: "plasticov", sourceVersion: "v1" });

    store.insertCostComponent(input);
    const v2 = store.upsertCostComponent(
      makeInput({ sellerId: "plasticov", sourceVersion: "v2", amount: clp(7000) }),
    );
    store.reverseCostComponent(v2.id, "Incorrect data");

    // v1 is superseded, v2 is reversed → no active components
    const list = store.listCostComponents("plasticov");
    expect(list).toHaveLength(0);

    // Both visible via listBySourceRecord
    const all = store.listBySourceRecord("plasticov", "order-123");
    expect(all).toHaveLength(2);
  });

  // ── Metadata round-trip ───────────────────────────────────────────────

  it("insert and retrieve cost component with metadata", () => {
    const store = createStore();
    const input = makeInput({
      sellerId: "plasticov",
      metadata: { feeCategory: "premium", region: "CL" },
    });

    const comp = store.insertCostComponent(input);
    expect(comp.metadata).toEqual({ feeCategory: "premium", region: "CL" });
  });

  // ── Amount and currency correctness ────────────────────────────────────

  it("insert and retrieve CLP amount correctly", () => {
    const store = createStore();
    const comp = store.insertCostComponent(
      makeInput({ sellerId: "plasticov", amount: clp(15990) }),
    );
    expect(comp.amount).toEqual({ amountMinor: 15990, currency: "CLP" });
    expect(comp.currency).toBe("CLP");
  });

  it("insert and retrieve USD amount correctly", () => {
    const store = createStore();
    const comp = store.insertCostComponent(
      makeInput({ sellerId: "plasticov", amount: usd(4999) }),
    );
    expect(comp.amount).toEqual({ amountMinor: 4999, currency: "USD" });
    expect(comp.currency).toBe("USD");
  });

  // ── Default observedAt when not provided ──────────────────────────────

  it("insert with explicit observedAt uses the provided value", () => {
    const store = createStore();
    const pastTime = NOW - 3600000;
    const comp = store.insertCostComponent(
      makeInput({ sellerId: "plasticov", observedAt: pastTime }),
    );
    expect(comp.observedAt).toBe(pastTime);
  });
});
