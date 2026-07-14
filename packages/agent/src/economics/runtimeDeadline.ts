export type RuntimeClock = {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
};

export const systemRuntimeClock: RuntimeClock = {
  now: Date.now,
  setTimeout,
  clearTimeout,
};

export type EconomicDeadlineConfig = {
  readonly maxTimeMs: number;
  readonly requestTimeoutMs: number;
  readonly retryBudgetMs: number;
  readonly rateLimitDelayMs: number;
  readonly paginationTimeoutMs: number;
  readonly fanoutTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
};

export const DEFAULT_ECONOMIC_DEADLINE_CONFIG: EconomicDeadlineConfig = {
  maxTimeMs: 60_000,
  requestTimeoutMs: 15_000,
  retryBudgetMs: 45_000,
  rateLimitDelayMs: 500,
  paginationTimeoutMs: 20_000,
  fanoutTimeoutMs: 30_000,
  shutdownTimeoutMs: 10_000,
};

const MAX_RUNTIME_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

export type OperationTimeout =
  | { readonly status: "allowed"; readonly timeoutMs: number }
  | { readonly status: "expired"; readonly timeoutMs: 0 }
  | { readonly status: "insufficient"; readonly timeoutMs: 0 };

/**
 * Clips a local operation to a global deadline without allowing a zero-length
 * request to start. This pure helper is shared by request, wait, coordination,
 * pagination, fanout, and shutdown boundaries.
 */
export function clipOperationTimeout(input: {
  readonly requestedMs: number;
  readonly remainingMs: number;
  readonly minimumMs?: number;
}): OperationTimeout {
  const minimumMs = input.minimumMs ?? 1;
  if (!Number.isSafeInteger(input.requestedMs) || !Number.isSafeInteger(input.remainingMs)) {
    return { status: "insufficient", timeoutMs: 0 };
  }
  if (input.remainingMs <= 0) return { status: "expired", timeoutMs: 0 };
  const timeoutMs = Math.min(input.requestedMs, input.remainingMs);
  if (timeoutMs < minimumMs) return { status: "insufficient", timeoutMs: 0 };
  return { status: "allowed", timeoutMs };
}

/** Reject unsafe timing relationships before a worker admits economic work. */
export function resolveEconomicDeadlineConfig(
  input: Partial<EconomicDeadlineConfig> = {},
): EconomicDeadlineConfig {
  const config = { ...DEFAULT_ECONOMIC_DEADLINE_CONFIG, ...input };
  const values = Object.values(config);
  if (
    values.some(
      (value) => !Number.isSafeInteger(value) || value < 0 || value > MAX_RUNTIME_TIMEOUT_MS,
    )
  ) {
    throw new Error("Invalid economic deadline configuration");
  }
  if (
    config.maxTimeMs <= 0 ||
    config.requestTimeoutMs <= 0 ||
    config.retryBudgetMs < 0 ||
    config.requestTimeoutMs > config.maxTimeMs ||
    config.retryBudgetMs > config.maxTimeMs ||
    config.paginationTimeoutMs <= 0 ||
    config.fanoutTimeoutMs <= 0 ||
    config.shutdownTimeoutMs <= 0 ||
    config.rateLimitDelayMs > config.retryBudgetMs
  )
    throw new Error("Invalid economic deadline configuration");
  return config;
}

export function remainingDeadlineMs(
  startedAt: number,
  maxTimeMs: number,
  now: () => number,
): number {
  return Math.max(0, startedAt + maxTimeMs - now());
}
