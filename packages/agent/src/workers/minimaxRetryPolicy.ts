import { MinimaxRequestError } from "@msl/creative-studio";

// ── Config ───────────────────────────────────────────────────────────

export type RetryPolicyConfig = {
  /** Base delay in ms for first retry. Default: 1000. */
  baseDelayMs?: number;
  /** Maximum number of retry attempts. Default: 3. */
  maxRetries?: number;
};

// ── Retry Policy ─────────────────────────────────────────────────────

/**
 * Exponential backoff retry policy for MiniMax API calls.
 *
 * Default delays: 1000ms → 2000ms → 4000ms (3 retries max).
 * Skips retry on 4xx errors (auth_error, content_blocked, insufficient_balance).
 * Retries on rate_limited (429) and provider_error (5xx, network, timeout).
 */
export class MinimaxRetryPolicy {
  private readonly baseDelayMs: number;
  private readonly maxRetries: number;

  constructor(config: RetryPolicyConfig = {}) {
    this.baseDelayMs = config.baseDelayMs ?? 1000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  /**
   * Execute an async function with retry logic.
   * The function is called up to maxRetries + 1 times (initial + retries).
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;

        if (!this.shouldRetry(err)) {
          throw err;
        }

        // Don't delay on the last attempt — throw immediately
        if (attempt < this.maxRetries) {
          await this.delay(attempt);
        }
      }
    }

    throw lastError;
  }

  /**
   * Determine whether an error should trigger a retry.
   * Auth, content-blocked, and insufficient-balance are never retried.
   * Rate-limited (429) IS retried per spec. Provider errors retry.
   */
  shouldRetry(error: unknown): boolean {
    if (error instanceof MinimaxRequestError) {
      // Never retry these categories
      const nonRetryable = new Set(["auth_error", "content_blocked", "insufficient_balance"]);
      return !nonRetryable.has(error.category);
    }

    // Unknown errors (network, timeout, etc.) — retry
    return true;
  }

  /**
   * Compute the delay in ms for a given retry attempt.
   * Attempt 0 = 1000ms, Attempt 1 = 2000ms, Attempt 2 = 4000ms.
   */
  getDelayMs(attempt: number): number {
    return this.baseDelayMs * Math.pow(2, attempt);
  }

  private delay(attempt: number): Promise<void> {
    const ms = this.getDelayMs(attempt);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
