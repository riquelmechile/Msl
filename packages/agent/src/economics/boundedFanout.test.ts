import { describe, expect, it, vi } from "vitest";
import { systemRuntimeClock } from "./runtimeDeadline.js";
import { runBoundedFanout } from "./boundedFanout.js";

describe("bounded fanout", () => {
  it("returns results in source order with bounded starts", async () => {
    const started: number[] = [];
    const results = await runBoundedFanout(
      [0, 1, 2].map((value) => () => {
        started.push(value);
        return Promise.resolve(value);
      }),
      { concurrency: 2, clock: systemRuntimeClock, timeoutMs: 1_000 },
    );
    expect(started).toEqual([0, 1, 2]);
    expect(results).toEqual([
      { status: "fulfilled", value: 0 },
      { status: "fulfilled", value: 1 },
      { status: "fulfilled", value: 2 },
    ]);
  });

  it("does not start queued work after a global abort", async () => {
    const controller = new AbortController();
    controller.abort(new Error("shutdown"));
    const task = vi.fn(() => Promise.resolve(1));
    const results = await runBoundedFanout([task, task], {
      concurrency: 1,
      signal: controller.signal,
      clock: systemRuntimeClock,
      timeoutMs: 1_000,
    });
    expect(task).not.toHaveBeenCalled();
    expect(results.every((result) => result.status === "rejected")).toBe(true);
  });

  it("propagates abort through the derived signal and starts no later task", async () => {
    const controller = new AbortController();
    let derivedSignal: AbortSignal | undefined;
    const queued = vi.fn(() => Promise.resolve(2));
    const results = await runBoundedFanout(
      [
        (signal) => {
          derivedSignal = signal;
          controller.abort("shutdown");
          return Promise.reject(new DOMException("Aborted", "AbortError"));
        },
        queued,
      ],
      {
        concurrency: 1,
        signal: controller.signal,
        clock: systemRuntimeClock,
        timeoutMs: 1_000,
      },
    );
    expect(derivedSignal).not.toBe(controller.signal);
    expect(derivedSignal?.aborted).toBe(true);
    expect(queued).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
  });
});
