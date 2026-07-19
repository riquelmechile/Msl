import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeDeferralDigest,
  computeSettlementDigest,
  jcsCanonicalize,
} from "../../src/conversation/jcsCanonicalize.js";
import type {
  DeferOptions,
  SettlementOptions,
  SettlementOutcome,
} from "../../src/conversation/agentMessageBusStore.js";

type Vectors = {
  canonical: { name: string; input: unknown; canonical: string }[];
  deferrals: { name: string; messageId: string; options: DeferOptions; digest: string }[];
  settlements: {
    outcome: SettlementOutcome;
    messageId: string;
    options: SettlementOptions;
    digest: string;
  }[];
};

const vectors = JSON.parse(
  readFileSync(new URL("./fixtures/deferral-digest-vectors.json", import.meta.url), "utf8"),
) as Vectors;

describe("RFC 8785 JCS and message bus digests", () => {
  it.each(vectors.canonical)("canonicalizes $name", ({ input, canonical }) => {
    expect(jcsCanonicalize(input)).toBe(canonical);
  });

  it("uses ECMA-262 number serialization", () => {
    expect(jcsCanonicalize([0.000001, 1e-7, 1e30, 4.5, 1e-27, -0])).toBe(
      "[0.000001,1e-7,1e+30,4.5,1e-27,0]",
    );
    expect(() => jcsCanonicalize(Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });

  it.each(vectors.deferrals)("matches deferral vector: $name", ({ messageId, options, digest }) => {
    expect(computeDeferralDigest(messageId, options)).toBe(digest);
  });

  it("makes system deferral digests independent of operation identity", () => {
    const base = vectors.deferrals[1]!;
    expect(
      computeDeferralDigest(base.messageId, {
        ...base.options,
        scope: { kind: "system", operationId: "other", reason: "other", evidenceRef: "other" },
      }),
    ).toBe(base.digest);
  });

  it("normalizes absent deferral fields to present nulls", () => {
    const vector = vectors.deferrals[1]!;
    expect(computeDeferralDigest(vector.messageId, vector.options)).toBe(
      computeDeferralDigest(vector.messageId, {
        ...vector.options,
        deferredUntil: null,
        detail: null,
        evidenceRef: null,
      }),
    );
  });

  it.each(vectors.settlements)(
    "matches $outcome settlement vector",
    ({ messageId, outcome, options, digest }) => {
      expect(computeSettlementDigest(messageId, outcome, options)).toBe(digest);
    },
  );

  it("normalizes absent settlement fields to present nulls", () => {
    const vector = vectors.settlements[1]!;
    expect(computeSettlementDigest(vector.messageId, vector.outcome, vector.options)).toBe(
      computeSettlementDigest(vector.messageId, vector.outcome, {
        ...vector.options,
        evidence: null,
      }),
    );
  });

  it("excludes settlement identity and scope from settlement digests", () => {
    const vector = vectors.settlements[0]!;
    expect(
      computeSettlementDigest(vector.messageId, vector.outcome, {
        ...vector.options,
        settlementId: "other",
        scope: { kind: "system", operationId: "op", reason: "audit", evidenceRef: "ref" },
      }),
    ).toBe(vector.digest);
  });

  it.each([
    { name: "value", input: { value: "\ud800" } },
    { name: "key", input: { ["\udc00"]: "value" } },
  ])("rejects a lone-surrogate $name without producing a digest", ({ input }) => {
    expect(() => jcsCanonicalize(input)).toThrow(/Lone surrogate/);
    expect(() =>
      computeSettlementDigest("msg", "resolved", {
        settlementId: "set",
        scope: { kind: "seller", sellerId: "seller" },
        result: input,
      }),
    ).toThrow(/Lone surrogate/);
  });
});
