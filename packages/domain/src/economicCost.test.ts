import { describe, expect, it } from "vitest";
import {
  COST_COMPONENT_TYPES,
  createEconomicCostComponent,
  CostComponentTypeError,
  type CostComponentType,
  type CostDataSource,
  type CostVerification,
  type EconomicCostComponent,
} from "./economicCost.js";
import type { Money } from "./money.js";

const clp1k: Money = { amountMinor: 1000, currency: "CLP" };
const now = Date.now();

describe("COST_COMPONENT_TYPES", () => {
  it("has exactly 12 cost types", () => {
    expect(COST_COMPONENT_TYPES).toHaveLength(12);
  });

  it("includes all expected cost types", () => {
    expect(COST_COMPONENT_TYPES).toContain("product_cost");
    expect(COST_COMPONENT_TYPES).toContain("marketplace_fee");
    expect(COST_COMPONENT_TYPES).toContain("shipping");
    expect(COST_COMPONENT_TYPES).toContain("advertising");
    expect(COST_COMPONENT_TYPES).toContain("seller_discount");
    expect(COST_COMPONENT_TYPES).toContain("refund");
    expect(COST_COMPONENT_TYPES).toContain("return");
    expect(COST_COMPONENT_TYPES).toContain("tax");
    expect(COST_COMPONENT_TYPES).toContain("financing");
    expect(COST_COMPONENT_TYPES).toContain("landed_cost");
    expect(COST_COMPONENT_TYPES).toContain("packaging");
    expect(COST_COMPONENT_TYPES).toContain("other");
  });
});

describe("createEconomicCostComponent", () => {
  it("creates a valid cost component with all fields", () => {
    const result = createEconomicCostComponent({
      sellerId: "seller-1",
      type: "shipping",
      amount: clp1k,
      source: "carrier",
      sourceRecordId: "shp-42",
      occurredAt: now,
      observedAt: now,
      verification: "verified",
      confidence: 0.95,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    const comp = result.component;

    expect(comp.type).toBe("shipping");
    expect(comp.amount).toEqual(clp1k);
    expect(comp.currency).toBe("CLP");
    expect(comp.source).toBe("carrier");
    expect(comp.sourceRecordId).toBe("shp-42");
    expect(comp.verification).toBe("verified");
    expect(comp.confidence).toBe(0.95);
    expect(comp.sellerId).toBe("seller-1");
    expect(typeof comp.id).toBe("string");
    expect(comp.occurredAt).toBe(now);
    expect(comp.observedAt).toBe(now);
  });

  it("accepts undefined sourceRecordId", () => {
    const result = createEconomicCostComponent({
      sellerId: "seller-1",
      type: "other",
      amount: clp1k,
      source: "manual",
      occurredAt: now,
      observedAt: now,
      verification: "unverified",
      confidence: 0.5,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.component.sourceRecordId).toBeUndefined();
  });

  it("accepts metadata", () => {
    const result = createEconomicCostComponent({
      sellerId: "seller-1",
      type: "marketplace_fee",
      amount: clp1k,
      source: "mercadolibre",
      occurredAt: now,
      observedAt: now,
      verification: "partially_verified",
      confidence: 0.8,
      metadata: { feeCategory: "premium" },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.component.metadata).toEqual({ feeCategory: "premium" });
  });

  // ── All types accepted ──────────────────────────────────────────

  it.each<CostComponentType>([
    "product_cost",
    "marketplace_fee",
    "shipping",
    "advertising",
    "seller_discount",
    "refund",
    "return",
    "tax",
    "financing",
    "landed_cost",
    "packaging",
    "other",
  ])("accepts valid cost type: %s", (type) => {
    const result = createEconomicCostComponent({
      sellerId: "seller-1",
      type,
      amount: clp1k,
      source: "derived",
      occurredAt: now,
      observedAt: now,
      verification: "unverified",
      confidence: 0.5,
    });
    expect(result.success).toBe(true);
  });

  // ── Rejections ──────────────────────────────────────────────────

  it("rejects invalid cost type", () => {
    const result = createEconomicCostComponent({
      sellerId: "seller-1",
      // @ts-expect-error
      type: "rent",
      amount: clp1k,
      source: "unknown",
      occurredAt: now,
      observedAt: now,
      verification: "unverified",
      confidence: 0.5,
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toBeInstanceOf(CostComponentTypeError);
    expect(result.error.message).toContain("rent");
  });

  it("rejects confidence below 0", () => {
    const result = createEconomicCostComponent({
      sellerId: "seller-1",
      type: "shipping",
      amount: clp1k,
      source: "carrier",
      occurredAt: now,
      observedAt: now,
      verification: "unverified",
      confidence: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence above 1", () => {
    const result = createEconomicCostComponent({
      sellerId: "seller-1",
      type: "shipping",
      amount: clp1k,
      source: "carrier",
      occurredAt: now,
      observedAt: now,
      verification: "unverified",
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty sellerId", () => {
    const result = createEconomicCostComponent({
      sellerId: "",
      type: "shipping",
      amount: clp1k,
      source: "carrier",
      occurredAt: now,
      observedAt: now,
      verification: "unverified",
      confidence: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts confidence = 0", () => {
    const result = createEconomicCostComponent({
      sellerId: "seller-1",
      type: "other",
      amount: clp1k,
      source: "unknown",
      occurredAt: now,
      observedAt: now,
      verification: "unverified",
      confidence: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts confidence = 1", () => {
    const result = createEconomicCostComponent({
      sellerId: "seller-1",
      type: "other",
      amount: clp1k,
      source: "unknown",
      occurredAt: now,
      observedAt: now,
      verification: "verified",
      confidence: 1,
    });
    expect(result.success).toBe(true);
  });
});

describe("CostVerification type", () => {
  it("accepts all 4 verification states", () => {
    const states: CostVerification[] = ["unverified", "partially_verified", "verified", "disputed"];
    expect(states).toHaveLength(4);
  });
});

describe("CostDataSource type", () => {
  it("accepts all 7 source types", () => {
    const sources: CostDataSource[] = [
      "mercadolibre",
      "supplier",
      "customs",
      "carrier",
      "manual",
      "derived",
      "unknown",
    ];
    expect(sources).toHaveLength(7);
  });
});
