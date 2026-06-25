import { describe, expect, it } from "vitest";

import { createSyncJobStubs, criticalSyncSignals, evaluateStaleCriticalSignal } from "./index.js";

describe("MercadoLibre sync job stubs", () => {
  it("creates scoped stubs for every critical business signal", async () => {
    const jobs = createSyncJobStubs("seller-1");

    expect(jobs.map((job) => job.signalKind)).toEqual(criticalSyncSignals);
    await expect(jobs[0]?.run()).resolves.toEqual({ status: "stubbed", signalKind: "order" });
  });
});

describe("stale critical-signal refresh policy", () => {
  it.each(criticalSyncSignals)("enqueues refresh for stale %s signals", (signalKind) => {
    const decision = evaluateStaleCriticalSignal({
      signalKind,
      capturedAt: new Date("2026-06-25T12:00:00.000Z"),
      now: new Date("2026-06-25T12:06:00.000Z"),
    });

    expect(decision).toMatchObject({
      signalKind,
      shouldEnqueueRefresh: true,
      refreshMode: "webhook-or-risk-scheduled",
      disclosure: "critical-signal-stale",
    });
  });

  it("does not enqueue a wasteful refresh for fresh critical signals", () => {
    const decision = evaluateStaleCriticalSignal({
      signalKind: "order",
      capturedAt: new Date("2026-06-25T12:00:00.000Z"),
      now: new Date("2026-06-25T12:01:00.000Z"),
    });

    expect(decision).toMatchObject({
      shouldEnqueueRefresh: false,
      refreshMode: "none",
      disclosure: "not-needed",
    });
  });
});
