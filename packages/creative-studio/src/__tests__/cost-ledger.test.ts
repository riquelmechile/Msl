import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CostLedger } from "../domain/cost-ledger.js";

describe("CostLedger", () => {
  const maxDaily = 5.0;
  const maxJob = 0.5;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("canAfford", () => {
    it("allows a job within budget", () => {
      const ledger = new CostLedger({ maxDailyUsd: maxDaily, maxJobUsd: maxJob });
      const result = ledger.canAfford(0.015);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("rejects a job exceeding maxJobUsd", () => {
      const ledger = new CostLedger({ maxDailyUsd: maxDaily, maxJobUsd: maxJob });
      const result = ledger.canAfford(0.75);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("max job USD");
    });

    it("rejects a job that would exceed daily budget", () => {
      const ledger = new CostLedger({ maxDailyUsd: maxDaily, maxJobUsd: maxJob });
      // Spend most of daily budget
      ledger.recordSpend(4.99);
      const result = ledger.canAfford(0.02);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Daily budget exceeded");
    });

    it("allows a job that exactly fills remaining daily budget", () => {
      const ledger = new CostLedger({ maxDailyUsd: maxDaily, maxJobUsd: maxJob });
      ledger.recordSpend(4.5);
      const result = ledger.canAfford(0.5);
      expect(result.allowed).toBe(true);
    });
  });

  describe("recordSpend", () => {
    it("accumulates daily spend correctly", () => {
      const ledger = new CostLedger({ maxDailyUsd: maxDaily, maxJobUsd: maxJob });
      ledger.recordSpend(0.01);
      ledger.recordSpend(0.02);
      ledger.recordSpend(0.03);
      expect(ledger.getDailySpent()).toBeCloseTo(0.06);
    });
  });

  describe("UTC midnight reset", () => {
    it("resets daily spend when crossing UTC midnight", () => {
      // Set clock to 2024-01-01 23:59:00 UTC
      vi.setSystemTime(new Date("2024-01-01T23:59:00Z"));
      const ledger = new CostLedger({ maxDailyUsd: maxDaily, maxJobUsd: maxJob });
      ledger.recordSpend(4.0);
      expect(ledger.getDailySpent()).toBeCloseTo(4.0);

      // Advance past UTC midnight
      vi.setSystemTime(new Date("2024-01-02T00:01:00Z"));

      // The next check should auto-reset
      expect(ledger.getDailySpent()).toBeCloseTo(0);
    });

    it("allows spending after daily reset", () => {
      vi.setSystemTime(new Date("2024-01-01T23:59:00Z"));
      const ledger = new CostLedger({ maxDailyUsd: maxDaily, maxJobUsd: maxJob });
      ledger.recordSpend(4.5);

      // Past midnight
      vi.setSystemTime(new Date("2024-01-02T00:01:00Z"));

      const result = ledger.canAfford(0.4);
      expect(result.allowed).toBe(true);
    });

    it("resets only once at the boundary, not on every check", () => {
      vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));
      const ledger = new CostLedger({ maxDailyUsd: maxDaily, maxJobUsd: maxJob });
      ledger.recordSpend(3.0);

      vi.setSystemTime(new Date("2024-01-02T00:01:00Z"));
      // First call after midnight — resets
      expect(ledger.getDailySpent()).toBeCloseTo(0);

      // Spend again
      ledger.recordSpend(1.0);
      expect(ledger.getDailySpent()).toBeCloseTo(1.0);

      // Still same day — no reset
      expect(ledger.getDailySpent()).toBeCloseTo(1.0);
    });
  });

  describe("getConfig", () => {
    it("returns a copy of the config", () => {
      const ledger = new CostLedger({ maxDailyUsd: 10, maxJobUsd: 1 });
      const config = ledger.getConfig();
      expect(config.maxDailyUsd).toBe(10);
      expect(config.maxJobUsd).toBe(1);

      // Mutating returned config should not affect internal state
      config.maxDailyUsd = 99;
      expect(ledger.getConfig().maxDailyUsd).toBe(10);
    });
  });
});
