import type { RuntimeClock } from "./runtimeDeadline.js";

export type BoundedFanoutOptions = {
  readonly concurrency: number;
  readonly signal?: AbortSignal;
  readonly clock: RuntimeClock;
  readonly timeoutMs: number;
};

/**
 * Executes source work in source order with bounded starts. Once cancelled or
 * timed out, queued work never starts and already-started work is awaited so a
 * caller never leaves orphan promises behind.
 */
export async function runBoundedFanout<T>(
  tasks: readonly ((signal: AbortSignal) => Promise<T>)[],
  options: BoundedFanoutOptions,
): Promise<readonly PromiseSettledResult<T>[]> {
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("Fanout concurrency must be a positive safe integer");
  }
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason ?? new Error("Fanout aborted"));
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timeout = options.clock.setTimeout(
    () => controller.abort(new Error("Fanout timed out")),
    options.timeoutMs,
  );
  const results: PromiseSettledResult<T>[] = Array.from({ length: tasks.length }, () => ({
    status: "rejected",
    reason: new Error("Fanout task was not started"),
  }));
  let next = 0;
  const worker = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      const index = next++;
      if (index >= tasks.length || controller.signal.aborted) return;
      // Each child gets the derived signal so either global abort or the
      // fanout budget cancels in-flight provider work as well as queued starts.
      results[index] = await tasks[index]!(controller.signal).then(
        (value): PromiseFulfilledResult<T> => ({ status: "fulfilled", value }),
        (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason }),
      );
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(options.concurrency, tasks.length) }, worker));
    return results;
  } finally {
    options.clock.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
