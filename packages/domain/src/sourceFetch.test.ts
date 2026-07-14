import { describe, expect, it } from "vitest";
import {
  MAX_SOURCE_FETCH_COUNTER,
  MAX_SOURCE_FETCH_RETRY_AFTER_MS,
  createClaimsBacklogIdentity,
  createSourceFetchResult,
  isSourceFetchResult,
} from "./sourceFetch.js";

const base = {
  source: "claims" as const,
  observedAt: 1_700_000_000_000,
  attemptedAt: 1_700_000_000_001,
  attempts: 1,
  pages: 1,
  records: 0,
  cursor: { afterOccurredAt: 1_700_000_000_000, afterSourceRecordId: "claim-1" },
} as const;

describe("SourceFetchResult", () => {
  it.each([
    ["success-with-data", undefined, false, null, 2],
    ["success-empty", "no-records", false, null, 0],
    ["unavailable", "source-unavailable", false, null, 0],
    ["unauthorized", "credentials-rejected", false, null, 0],
    ["forbidden", "access-denied", false, null, 0],
    ["rate-limited", "rate-limit-exceeded", true, 1_000, 0],
    ["source-timeout", "request-timed-out", true, null, 0],
    ["transient-failure", "temporary-provider-failure", true, null, 0],
    ["malformed-response", "invalid-provider-response", false, null, 0],
  ] as const)(
    "creates bounded %s outcomes",
    (status, reasonCode, retryable, retryAfterMs, records) => {
      const created = createSourceFetchResult({
        ...base,
        status,
        ...(reasonCode === undefined ? {} : { reasonCode }),
        retryable,
        retryAfterMs,
        records,
      });

      expect(created.success).toBe(true);
      if (!created.success) return;
      expect(created.result.status).toBe(status);
      expect(created.result.retryable).toBe(retryable);
      expect(() => JSON.stringify(created.result)).not.toThrow();
      expect(isSourceFetchResult(created.result)).toBe(true);
    },
  );

  it("models global abort without consuming an unstarted request", () => {
    const created = createSourceFetchResult({
      ...base,
      status: "aborted",
      reasonCode: "global-abort",
      attemptedAt: null,
      attempts: 0,
      pages: 0,
    });

    expect(created.success).toBe(true);
    if (!created.success) return;
    expect(created.result.status).toBe("aborted");
    expect(created.result.reasonCode).toBe("global-abort");
    expect(created.result.attempts).toBe(0);
    expect(created.result.retryable).toBe(false);
  });

  it("accepts successful emptiness only as success-empty", () => {
    expect(createSourceFetchResult({ ...base, status: "success-with-data", records: 0 })).toEqual({
      success: false,
      reason: "invalid-source-fetch-result",
    });
    expect(
      createSourceFetchResult({
        ...base,
        status: "success-empty",
        reasonCode: "no-records",
        records: 1,
      }),
    ).toEqual({ success: false, reason: "invalid-source-fetch-result" });
    expect(
      createSourceFetchResult({ ...base, status: "unavailable", reasonCode: "source-unavailable" }),
    ).toEqual(expect.objectContaining({ success: true }));
  });

  it("rejects unbounded counters, retry windows, and malformed raw-shaped values", () => {
    expect(
      isSourceFetchResult({
        ...base,
        status: "unavailable",
        reasonCode: "source-unavailable",
        retryable: false,
        retryAfterMs: null,
        cursor: {},
      }),
    ).toBe(false);
    expect(
      createSourceFetchResult({
        ...base,
        status: "rate-limited",
        reasonCode: "rate-limit-exceeded",
        retryAfterMs: MAX_SOURCE_FETCH_RETRY_AFTER_MS + 1,
      }),
    ).toEqual({ success: false, reason: "invalid-source-fetch-result" });
    expect(
      createSourceFetchResult({
        ...base,
        status: "malformed-response",
        reasonCode: "invalid-provider-response",
        pages: MAX_SOURCE_FETCH_COUNTER + 1,
      }),
    ).toEqual({ success: false, reason: "invalid-source-fetch-result" });
    expect(
      isSourceFetchResult({
        ...base,
        status: "unavailable",
        reasonCode: "source-unavailable",
        retryable: false,
        retryAfterMs: null,
        payload: { buyer: "buyer@example.test" },
      }),
    ).toBe(false);
  });
});

describe("Claims backlog identity", () => {
  it("is restart-stable across JSON order variants and excludes raw/PII fields", () => {
    const firstInput = {
      sellerId: "plasticov",
      range: { from: 1_700_000_000_000, to: 1_700_000_100_000 },
      cursor: { afterOccurredAt: null, afterSourceRecordId: null },
      rawPayload: { buyer: "buyer@example.test", order: "MLA-unsafe" },
    };
    const secondInput = {
      cursor: { afterSourceRecordId: null, afterOccurredAt: null },
      range: { to: 1_700_000_100_000, from: 1_700_000_000_000 },
      sellerId: "plasticov",
      headers: { authorization: "Bearer secret" },
    };

    const first = createClaimsBacklogIdentity(firstInput);
    const second = createClaimsBacklogIdentity(secondInput);

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(first?.key).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(first)).not.toContain("buyer@example.test");
    expect(JSON.stringify(first)).not.toContain("Bearer secret");
  });

  it("keeps seller identity and normalized cursor material in the hash", () => {
    const input = {
      sellerId: "plasticov",
      range: { from: null, to: null },
      cursor: { afterOccurredAt: null, afterSourceRecordId: null },
    };
    const first = createClaimsBacklogIdentity(input);
    const otherSeller = createClaimsBacklogIdentity({ ...input, sellerId: "maustian" });
    const laterCursor = createClaimsBacklogIdentity({
      ...input,
      cursor: { afterOccurredAt: 1_700_000_000_000, afterSourceRecordId: "claim-2" },
    });

    expect(first?.key).not.toBe(otherSeller?.key);
    expect(first?.key).not.toBe(laterCursor?.key);
  });
});
