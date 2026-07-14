import { describe, expect, it } from "vitest";
import {
  isValidSupplierWebSignal,
  type SupplierWebSignalPayload,
  type SupplierWebSignalKind,
} from "./supplierWebSignal.js";

function validPayload(overrides: Partial<SupplierWebSignalPayload> = {}): SupplierWebSignalPayload {
  return {
    type: "supplier-web-signal",
    signalKind: "new-supplier-product",
    supplierId: "jinpeng",
    supplierItemId: "JINPENG-001",
    evidenceIds: ["supplier-item:JINPENG-001"],
    recommendedAction: "prepare-storefront-candidate",
    severity: "warning",
    capturedAt: new Date("2026-07-10T12:00:00.000Z").toISOString(),
    noMutationExecuted: true,
    ...overrides,
  };
}

describe("isValidSupplierWebSignal", () => {
  // ── Valid signals ──────────────────────────────────────────────

  it("accepts a fully valid SupplierWebSignalPayload", () => {
    expect(isValidSupplierWebSignal(validPayload())).toBe(true);
  });

  it("accepts a signal with affectedSellerIds", () => {
    const payload = validPayload({
      signalKind: "stock-gap",
      affectedSellerIds: ["plasticov", "maustian"],
      recommendedAction: "review-storefront-availability",
      severity: "critical",
    });
    expect(isValidSupplierWebSignal(payload)).toBe(true);
  });

  it("accepts all 6 signal kinds", () => {
    const kinds: SupplierWebSignalKind[] = [
      "new-supplier-product",
      "stock-gap",
      "supplier-price-change",
      "supplier-stock-restored",
      "supplier-stock-out",
      "publish-opportunity",
    ];
    for (const kind of kinds) {
      expect(isValidSupplierWebSignal(validPayload({ signalKind: kind }))).toBe(true);
    }
  });

  it("accepts all severity levels", () => {
    const severities = ["info", "warning", "critical"] as const;
    for (const severity of severities) {
      expect(isValidSupplierWebSignal(validPayload({ severity }))).toBe(true);
    }
  });

  it("requires noMutationExecuted to be true", () => {
    const payload = validPayload();
    // It is already true — should pass
    expect(isValidSupplierWebSignal(payload)).toBe(true);

    const bad = { ...payload, noMutationExecuted: false };
    expect(isValidSupplierWebSignal(bad)).toBe(false);
  });

  it("accepts all recommended actions", () => {
    const actions = [
      "prepare-product-page",
      "prepare-storefront-candidate",
      "review-storefront-availability",
      "prepare-availability-pause",
      "prepare-price-review",
      "prepare-reactivation-review",
      "request-creative-assets",
      "collect-more-evidence",
    ] as const;
    for (const action of actions) {
      expect(isValidSupplierWebSignal(validPayload({ recommendedAction: action }))).toBe(true);
    }
  });

  // ── Invalid payloads ───────────────────────────────────────────

  it("rejects null", () => {
    expect(isValidSupplierWebSignal(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isValidSupplierWebSignal(undefined)).toBe(false);
  });

  it("rejects non-object values", () => {
    expect(isValidSupplierWebSignal("string")).toBe(false);
    expect(isValidSupplierWebSignal(42)).toBe(false);
    expect(isValidSupplierWebSignal(true)).toBe(false);
  });

  it("rejects object with wrong type", () => {
    expect(isValidSupplierWebSignal({ type: "ceo-proposal" })).toBe(false);
  });

  it("rejects object missing type", () => {
    const { type: _, ...rest } = validPayload();
    expect(isValidSupplierWebSignal(rest)).toBe(false);
  });

  it("rejects invalid signalKind", () => {
    expect(isValidSupplierWebSignal(validPayload({ signalKind: "banana" as never }))).toBe(false);
  });

  it("rejects empty supplierId", () => {
    expect(isValidSupplierWebSignal(validPayload({ supplierId: "" }))).toBe(false);
  });

  it("rejects missing supplierId", () => {
    const { supplierId: _, ...rest } = validPayload();
    expect(isValidSupplierWebSignal(rest)).toBe(false);
  });

  it("rejects empty supplierItemId", () => {
    expect(isValidSupplierWebSignal(validPayload({ supplierItemId: "" }))).toBe(false);
  });

  it("rejects missing supplierItemId", () => {
    const { supplierItemId: _, ...rest } = validPayload();
    expect(isValidSupplierWebSignal(rest)).toBe(false);
  });

  it("rejects affectedSellerIds with non-string elements", () => {
    expect(
      isValidSupplierWebSignal(validPayload({ affectedSellerIds: [42 as unknown as string] })),
    ).toBe(false);
  });

  it("rejects non-array evidenceIds", () => {
    expect(isValidSupplierWebSignal(validPayload({ evidenceIds: "not-an-array" as never }))).toBe(
      false,
    );
  });

  it("rejects evidenceIds with non-string elements", () => {
    expect(isValidSupplierWebSignal(validPayload({ evidenceIds: [42 as unknown as string] }))).toBe(
      false,
    );
  });

  it("rejects invalid recommendedAction", () => {
    expect(
      isValidSupplierWebSignal(validPayload({ recommendedAction: "publish-now" as never })),
    ).toBe(false);
  });

  it("rejects invalid severity", () => {
    expect(isValidSupplierWebSignal(validPayload({ severity: "extreme" as never }))).toBe(false);
  });

  it("rejects empty capturedAt", () => {
    expect(isValidSupplierWebSignal(validPayload({ capturedAt: "" }))).toBe(false);
  });

  it("rejects missing capturedAt", () => {
    const { capturedAt: _, ...rest } = validPayload();
    expect(isValidSupplierWebSignal(rest)).toBe(false);
  });
});
