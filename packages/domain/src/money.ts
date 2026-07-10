export type Currency = "CLP" | "USD";

export const CURRENCIES = ["CLP", "USD"] as const;

export type Money = {
  amountMinor: number;
  currency: Currency;
};

// ── Error types ────────────────────────────────────────────────────────────

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export class CurrencyMismatchError extends MoneyError {
  constructor(a: Currency, b: Currency) {
    super(`Cannot combine ${a} with ${b}: currencies must match.`);
    this.name = "CurrencyMismatchError";
  }
}

// ── Guards ─────────────────────────────────────────────────────────────────

function isFiniteInteger(n: number): boolean {
  return Number.isFinite(n) && Number.isInteger(n);
}

function isValidCurrency(c: string): c is Currency {
  return (CURRENCIES as readonly string[]).includes(c);
}

// ── Factory ────────────────────────────────────────────────────────────────

export type CreateMoneyResult =
  { success: true; money: Money } | { success: false; error: MoneyError };

export function createMoney(amountMinor: number, currency: string): CreateMoneyResult {
  if (!isValidCurrency(currency)) {
    return { success: false, error: new MoneyError(`Unknown currency: "${currency}"`) };
  }
  if (!isFiniteInteger(amountMinor)) {
    const label = Number.isNaN(amountMinor)
      ? "NaN"
      : !Number.isFinite(amountMinor)
        ? String(amountMinor)
        : `non-integer (${amountMinor})`;
    return {
      success: false,
      error: new MoneyError(`amountMinor must be a finite integer, got ${label}`),
    };
  }
  return { success: true, money: { amountMinor, currency } };
}

// ── Arithmetic ─────────────────────────────────────────────────────────────

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function isZero(m: Money): boolean {
  return m.amountMinor === 0;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
}
