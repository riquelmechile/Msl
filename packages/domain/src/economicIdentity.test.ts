import { describe, expect, it } from "vitest";
import { computeUnitEconomics } from "./economicCalculation.js";
import { createEconomicCostComponent } from "./economicCost.js";

describe("economic entity identities", () => {
  it("uses UUID technical component IDs instead of a productive counter", () => {
    const input = {
      sellerId: "plasticov",
      type: "marketplace_fee" as const,
      amount: { amountMinor: 1200, currency: "CLP" as const },
      source: "mercadolibre" as const,
      sourceRecordId: "order-identity-1",
      sourceVersion: "2026-01-15T10:00:00Z",
      economicMeaning: "marketplace_fee",
      occurredAt: 1_700_000_000_000,
      observedAt: 1_700_000_000_000,
      verification: "verified" as const,
      confidence: 1,
    };

    const first = createEconomicCostComponent(input);
    const second = createEconomicCostComponent(input);

    if (!first.success || !second.success) throw new Error("expected valid components");
    expect(first.component.id).toMatch(/^costcomp-[0-9a-f-]{36}$/);
    expect(second.component.id).toMatch(/^costcomp-[0-9a-f-]{36}$/);
    expect(second.component.id).not.toBe(first.component.id);
  });

  it("derives a deterministic non-PII snapshot key from canonical economic inputs", () => {
    const component = createEconomicCostComponent({
      sellerId: "plasticov",
      type: "marketplace_fee",
      amount: { amountMinor: 1200, currency: "CLP" },
      source: "mercadolibre",
      sourceRecordId: "order-identity-1",
      sourceVersion: "2026-01-15T10:00:00Z",
      economicMeaning: "marketplace_fee",
      occurredAt: 1_700_000_000_000,
      observedAt: 1_700_000_000_000,
      verification: "verified",
      confidence: 1,
    });
    if (!component.success) throw component.error;
    const input = {
      sellerId: "plasticov",
      orderId: "order-identity-1",
      itemId: "MLI-identity-1",
      sourceVersion: "2026-01-15T10:00:00Z",
      grossRevenue: 10_000,
      currency: "CLP" as const,
      costComponents: [component.component],
    };

    const first = computeUnitEconomics(input);
    const second = computeUnitEconomics(input);

    expect(second.snapshotId).toBe(first.snapshotId);
    expect(first.snapshotId).toMatch(/^snapshot-[0-9a-f]{64}$/);
    expect(first.economicChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(first)).not.toContain("buyer");
  });
});
