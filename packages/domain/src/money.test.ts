import { describe, expect, it } from "vitest";
import {
  addMoney,
  createMoney,
  CurrencyMismatchError,
  isZero,
  micros,
  MoneyError,
  subtractMoney,
  usdToMicros,
  type Currency,
  type Money,
} from "./money.js";

describe("micros", () => {
  it("rounds USD to integer micros", () => {
    expect(usdToMicros(0.0000155)).toBe(16);
  });

  it("rejects fractional and unsafe micros", () => {
    expect(() => micros(5.3)).toThrow("safe integer");
    expect(() => micros(Number.MAX_SAFE_INTEGER + 1)).toThrow("safe integer");
  });
});

describe("createMoney", () => {
  // ── Valid creations ─────────────────────────────────────────────

  it("creates CLP money from an integer amountMinor", () => {
    const result = createMoney(150000, "CLP");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.money).toEqual<Money>({ amountMinor: 150000, currency: "CLP" });
  });

  it("creates USD money from an integer amountMinor", () => {
    const result = createMoney(4999, "USD");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.money).toEqual<Money>({ amountMinor: 4999, currency: "USD" });
  });

  it("accepts negative amounts (loss/refund)", () => {
    const result = createMoney(-5000, "CLP");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.money.amountMinor).toBe(-5000);
  });

  it("accepts zero as explicit value", () => {
    const result = createMoney(0, "CLP");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.money.amountMinor).toBe(0);
  });

  // ── Rejections ──────────────────────────────────────────────────

  it("rejects NaN", () => {
    const result = createMoney(NaN, "CLP");
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toBeInstanceOf(MoneyError);
    expect(result.error.message).toContain("NaN");
  });

  it("rejects Infinity", () => {
    const result = createMoney(Infinity, "CLP");
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toBeInstanceOf(MoneyError);
  });

  it("rejects negative Infinity", () => {
    const result = createMoney(-Infinity, "CLP");
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toBeInstanceOf(MoneyError);
  });

  it("rejects decimal (non-integer) amounts", () => {
    const result = createMoney(1500.75, "CLP");
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toBeInstanceOf(MoneyError);
  });

  it("rejects invalid currency values", () => {
    const result = createMoney(1000, "EUR");
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toBeInstanceOf(MoneyError);
  });
});

describe("addMoney", () => {
  it("adds two CLP amounts", () => {
    const a: Money = { amountMinor: 1000, currency: "CLP" };
    const b: Money = { amountMinor: 500, currency: "CLP" };
    expect(addMoney(a, b)).toEqual<Money>({ amountMinor: 1500, currency: "CLP" });
  });

  it("adds two negative amounts", () => {
    const a: Money = { amountMinor: -1000, currency: "CLP" };
    const b: Money = { amountMinor: -500, currency: "CLP" };
    expect(addMoney(a, b)).toEqual<Money>({ amountMinor: -1500, currency: "CLP" });
  });

  it("throws on currency mismatch", () => {
    const a: Money = { amountMinor: 1000, currency: "CLP" };
    const b: Money = { amountMinor: 500, currency: "USD" };
    expect(() => addMoney(a, b)).toThrow(CurrencyMismatchError);
  });
});

describe("subtractMoney", () => {
  it("subtracts two CLP amounts", () => {
    const a: Money = { amountMinor: 1000, currency: "CLP" };
    const b: Money = { amountMinor: 300, currency: "CLP" };
    expect(subtractMoney(a, b)).toEqual<Money>({ amountMinor: 700, currency: "CLP" });
  });

  it("throws on currency mismatch", () => {
    const a: Money = { amountMinor: 1000, currency: "CLP" };
    const b: Money = { amountMinor: 500, currency: "USD" };
    expect(() => subtractMoney(a, b)).toThrow(CurrencyMismatchError);
  });
});

describe("isZero", () => {
  it("returns true for zero amountMinor", () => {
    expect(isZero({ amountMinor: 0, currency: "CLP" })).toBe(true);
  });

  it("returns false for positive amounts", () => {
    expect(isZero({ amountMinor: 100, currency: "CLP" })).toBe(false);
  });

  it("returns false for negative amounts", () => {
    expect(isZero({ amountMinor: -100, currency: "CLP" })).toBe(false);
  });
});

describe("Currency type", () => {
  it("accepts valid currencies at type level", () => {
    const clp: Currency = "CLP";
    const usd: Currency = "USD";
    expect(clp).toBe("CLP");
    expect(usd).toBe("USD");
  });
});
