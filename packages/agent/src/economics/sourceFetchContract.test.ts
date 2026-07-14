import { describe, expect, it } from "vitest";
import {
  createClaimsBacklogIdentity,
  createSourceFetchResult,
  isSourceFetchKind,
  isSourceFetchResult,
} from "./sourceFetchContract.js";

describe("agent source fetch contract", () => {
  it("reuses the domain constructors and guards without provider payloads", () => {
    const result = createSourceFetchResult({
      source: "claims",
      status: "success-empty",
      reasonCode: "no-records",
      observedAt: 1_700_000_000_000,
      attemptedAt: 1_700_000_000_001,
      attempts: 1,
      pages: 1,
      records: 0,
      cursor: { afterOccurredAt: null, afterSourceRecordId: null },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(isSourceFetchKind("product-ads")).toBe(true);
    expect(isSourceFetchKind("raw-payload")).toBe(false);
    expect(isSourceFetchResult(result.result)).toBe(true);
    expect(
      createClaimsBacklogIdentity({
        sellerId: "plasticov",
        range: { from: null, to: null },
        cursor: result.result.cursor,
      })?.key,
    ).toMatch(/^[0-9a-f]{64}$/);
  });
});
