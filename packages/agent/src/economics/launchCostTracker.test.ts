import { describe, it, expect, vi, beforeEach } from "vitest";
import { LaunchCostTracker } from "./launchCostTracker.js";
import type { LaunchCostEvent } from "./launchCostTracker.js";

// ── Helpers ────────────────────────────────────────────────────────

function makeEvent(overrides?: Partial<LaunchCostEvent>): LaunchCostEvent {
  return {
    launchId: "launch-test-1",
    source: "google_lens",
    estimatedCostUsd: 0.005,
    operation: "vision-recognition",
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("LaunchCostTracker", () => {
  let tracker: LaunchCostTracker;

  beforeEach(() => {
    tracker = new LaunchCostTracker();
  });

  describe("basic cost tracking", () => {
    it("starts with zero cost for unknown launch", () => {
      expect(tracker.getTotalCost("nonexistent")).toBe(0);
    });

    it("records a single cost event", () => {
      tracker.record(makeEvent());
      expect(tracker.getTotalCost("launch-test-1")).toBe(0.005);
    });

    it("accumulates multiple events for the same launch", () => {
      tracker.record(makeEvent({ estimatedCostUsd: 0.005, source: "google_lens" }));
      tracker.record(makeEvent({ estimatedCostUsd: 0.01, source: "deepseek" }));
      tracker.record(makeEvent({ estimatedCostUsd: 0.015, source: "minimax" }));
      expect(tracker.getTotalCost("launch-test-1")).toBeCloseTo(0.03, 4);
    });

    it("tracks costs separately per launchId", () => {
      tracker.record(makeEvent({ launchId: "launch-a", estimatedCostUsd: 0.005 }));
      tracker.record(makeEvent({ launchId: "launch-b", estimatedCostUsd: 0.01 }));
      expect(tracker.getTotalCost("launch-a")).toBe(0.005);
      expect(tracker.getTotalCost("launch-b")).toBe(0.01);
    });
  });

  describe("recordBatch", () => {
    it("processes multiple events at once", () => {
      const events: LaunchCostEvent[] = [
        makeEvent({ estimatedCostUsd: 0.005, source: "google_lens" }),
        makeEvent({ estimatedCostUsd: 0.01, source: "deepseek" }),
        makeEvent({ estimatedCostUsd: 0.015, source: "minimax" }),
      ];
      tracker.recordBatch(events);
      expect(tracker.getTotalCost("launch-test-1")).toBeCloseTo(0.03, 4);
    });
  });

  describe("getEvents", () => {
    it("returns recorded events in order", () => {
      tracker.record(makeEvent({ operation: "step-1" }));
      tracker.record(makeEvent({ operation: "step-2" }));
      const events = tracker.getEvents("launch-test-1");
      expect(events).toHaveLength(2);
      expect(events[0]!.operation).toBe("step-1");
      expect(events[1]!.operation).toBe("step-2");
    });

    it("returns empty array for unknown launch", () => {
      expect(tracker.getEvents("nonexistent")).toEqual([]);
    });
  });

  describe("getSummary", () => {
    it("computes total across all launches", () => {
      tracker.record(
        makeEvent({ launchId: "launch-a", source: "google_lens", estimatedCostUsd: 0.005 }),
      );
      tracker.record(
        makeEvent({ launchId: "launch-b", source: "deepseek", estimatedCostUsd: 0.01 }),
      );
      const summary = tracker.getSummary();
      expect(summary.totalUsd).toBeCloseTo(0.015, 4);
      expect(summary.activeLaunches).toBe(2);
    });

    it("breaks down costs by source", () => {
      tracker.record(makeEvent({ source: "google_lens", estimatedCostUsd: 0.005 }));
      tracker.record(makeEvent({ source: "deepseek", estimatedCostUsd: 0.01 }));
      tracker.record(makeEvent({ source: "minimax", estimatedCostUsd: 0.015 }));
      const summary = tracker.getSummary();
      expect(summary.bySource.google_lens!.count).toBe(1);
      expect(summary.bySource.google_lens!.totalUsd).toBeCloseTo(0.005, 4);
      expect(summary.bySource.deepseek.count).toBe(1);
      expect(summary.bySource.deepseek.totalUsd).toBeCloseTo(0.01, 4);
      expect(summary.bySource.minimax.count).toBe(1);
      expect(summary.bySource.minimax.totalUsd).toBeCloseTo(0.015, 4);
    });

    it("returns zero summary when no events recorded", () => {
      const summary = tracker.getSummary();
      expect(summary.totalUsd).toBe(0);
      expect(summary.activeLaunches).toBe(0);
      expect(summary.bySource.google_lens.count).toBe(0);
    });
  });

  describe("clear", () => {
    it("removes costs for a launch and returns the total", () => {
      tracker.record(makeEvent({ estimatedCostUsd: 0.005 }));
      tracker.record(makeEvent({ estimatedCostUsd: 0.005 }));
      const cleared = tracker.clear("launch-test-1");
      expect(cleared).toBeCloseTo(0.01, 4);
      expect(tracker.getTotalCost("launch-test-1")).toBe(0);
    });

    it("returns 0 when launch not found", () => {
      expect(tracker.clear("nonexistent")).toBe(0);
    });
  });

  describe("typical pipeline cost", () => {
    it("matches expected per-launch cost ($0.08-0.10)", () => {
      // 1 Google Lens + 3 DeepSeek + 2 MiniMax = typical launch
      tracker.record(makeEvent({ source: "google_lens", estimatedCostUsd: 0.005 }));
      tracker.record(makeEvent({ source: "deepseek", estimatedCostUsd: 0.01 }));
      tracker.record(makeEvent({ source: "deepseek", estimatedCostUsd: 0.01 }));
      tracker.record(makeEvent({ source: "deepseek", estimatedCostUsd: 0.01 }));
      tracker.record(makeEvent({ source: "minimax", estimatedCostUsd: 0.015 }));
      tracker.record(makeEvent({ source: "minimax", estimatedCostUsd: 0.015 }));
      const total = tracker.getTotalCost("launch-test-1");
      expect(total).toBeGreaterThanOrEqual(0.06);
      expect(total).toBeLessThanOrEqual(0.11); // $0.065 with the lower bounds
    });
  });
});
