import { describe, expect, it } from "vitest";
import {
  clipOperationTimeout,
  DEFAULT_ECONOMIC_DEADLINE_CONFIG,
  resolveEconomicDeadlineConfig,
} from "./runtimeDeadline.js";

describe("economic runtime deadline configuration", () => {
  it("validates all bounded coordination timeouts before work admission", () => {
    expect(resolveEconomicDeadlineConfig()).toEqual(DEFAULT_ECONOMIC_DEADLINE_CONFIG);
    expect(() =>
      resolveEconomicDeadlineConfig({ fanoutTimeoutMs: Number.POSITIVE_INFINITY }),
    ).toThrow("Invalid economic deadline configuration");
    expect(() => resolveEconomicDeadlineConfig({ rateLimitDelayMs: 45_001 })).toThrow(
      "Invalid economic deadline configuration",
    );
  });

  it("clips operations without starting expired or insufficient work", () => {
    expect(clipOperationTimeout({ requestedMs: 10, remainingMs: 5 })).toEqual({
      status: "allowed",
      timeoutMs: 5,
    });
    expect(clipOperationTimeout({ requestedMs: 10, remainingMs: 0 })).toEqual({
      status: "expired",
      timeoutMs: 0,
    });
    expect(clipOperationTimeout({ requestedMs: 10, remainingMs: 2, minimumMs: 3 })).toEqual({
      status: "insufficient",
      timeoutMs: 0,
    });
  });
});
