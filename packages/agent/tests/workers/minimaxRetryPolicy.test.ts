import { describe, it, expect, vi } from "vitest";
import { MinimaxRetryPolicy } from "../../src/workers/minimaxRetryPolicy.js";
import { MinimaxRequestError } from "@msl/creative-studio";

// ── Tests ────────────────────────────────────────────────────────────

describe("MinimaxRetryPolicy", () => {
  describe("getDelayMs", () => {
    it("returns baseDelayMs for attempt 0", () => {
      const policy = new MinimaxRetryPolicy({ baseDelayMs: 1000 });
      expect(policy.getDelayMs(0)).toBe(1000);
    });

    it("doubles delay each attempt", () => {
      const policy = new MinimaxRetryPolicy({ baseDelayMs: 1000 });
      expect(policy.getDelayMs(0)).toBe(1000);
      expect(policy.getDelayMs(1)).toBe(2000);
      expect(policy.getDelayMs(2)).toBe(4000);
    });

    it("uses custom base delay", () => {
      const policy = new MinimaxRetryPolicy({ baseDelayMs: 500 });
      expect(policy.getDelayMs(0)).toBe(500);
      expect(policy.getDelayMs(1)).toBe(1000);
      expect(policy.getDelayMs(2)).toBe(2000);
    });
  });

  describe("shouldRetry", () => {
    it("retries on rate_limited errors", () => {
      const policy = new MinimaxRetryPolicy();
      const error = new MinimaxRequestError("rate_limited", "Rate limited");
      expect(policy.shouldRetry(error)).toBe(true);
    });

    it("retries on provider_error", () => {
      const policy = new MinimaxRetryPolicy();
      const error = new MinimaxRequestError("provider_error", "Server error");
      expect(policy.shouldRetry(error)).toBe(true);
    });

    it("does not retry on auth_error", () => {
      const policy = new MinimaxRetryPolicy();
      const error = new MinimaxRequestError("auth_error", "Unauthorized");
      expect(policy.shouldRetry(error)).toBe(false);
    });

    it("does not retry on content_blocked", () => {
      const policy = new MinimaxRetryPolicy();
      const error = new MinimaxRequestError("content_blocked", "Content rejected");
      expect(policy.shouldRetry(error)).toBe(false);
    });

    it("does not retry on insufficient_balance", () => {
      const policy = new MinimaxRetryPolicy();
      const error = new MinimaxRequestError("insufficient_balance", "No funds");
      expect(policy.shouldRetry(error)).toBe(false);
    });

    it("retries on unknown errors (network, timeout)", () => {
      const policy = new MinimaxRetryPolicy();
      expect(policy.shouldRetry(new Error("Network timeout"))).toBe(true);
      expect(policy.shouldRetry("string error")).toBe(true);
    });
  });

  describe("execute", () => {
    it("returns result on first success", async () => {
      const policy = new MinimaxRetryPolicy({ maxRetries: 3 });
      const fn = vi.fn().mockResolvedValue("ok");

      const result = await policy.execute(fn);
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries on retryable error and succeeds", async () => {
      const policy = new MinimaxRetryPolicy({ maxRetries: 3, baseDelayMs: 1 });
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new MinimaxRequestError("rate_limited", "too fast"))
        .mockResolvedValueOnce("ok");

      const result = await policy.execute(fn);
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("throws after exhausting retries", async () => {
      const policy = new MinimaxRetryPolicy({ maxRetries: 2, baseDelayMs: 1 });
      const error = new MinimaxRequestError("rate_limited", "always rate limited");
      const fn = vi.fn().mockRejectedValue(error);

      await expect(policy.execute(fn)).rejects.toThrow(MinimaxRequestError);
      expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it("does not retry on non-retryable errors", async () => {
      const policy = new MinimaxRetryPolicy({ maxRetries: 3 });
      const fn = vi.fn().mockRejectedValue(new MinimaxRequestError("auth_error", "bad key"));

      await expect(policy.execute(fn)).rejects.toThrow(MinimaxRequestError);
      expect(fn).toHaveBeenCalledTimes(1); // no retry
    });

    it("uses default config values", () => {
      const policy = new MinimaxRetryPolicy();
      expect(policy.getDelayMs(0)).toBe(1000);
      expect(policy.getDelayMs(1)).toBe(2000);
      expect(policy.getDelayMs(2)).toBe(4000);
    });
  });
});
