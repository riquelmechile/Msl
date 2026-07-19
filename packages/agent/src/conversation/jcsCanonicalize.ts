import { createHash } from "node:crypto";
import type { DeferOptions, SettlementOptions, SettlementOutcome } from "./agentMessageBusStore.js";

const DEFERRAL_TAG = "msl.agent-message-bus.deferral.v1";
const SETTLEMENT_TAG = "msl.agent-message-bus.settlement.v1";

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff)
        throw new TypeError("Lone surrogate is not valid JSON text");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError("Lone surrogate is not valid JSON text");
    }
  }
}

export function jcsCanonicalize(value: unknown): string {
  const active = new WeakSet<object>();

  const serialize = (current: unknown): string => {
    if (current === null) return "null";
    if (typeof current === "boolean") return current ? "true" : "false";
    if (typeof current === "string") {
      assertUnicodeScalarString(current);
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError("JCS numbers must be finite");
      return JSON.stringify(current);
    }
    if (typeof current !== "object") throw new TypeError("Value is not valid JSON");
    if (active.has(current)) throw new TypeError("Circular value is not valid JSON");
    active.add(current);
    try {
      if (Array.isArray(current)) {
        const values = Array.from({ length: current.length }, (_, index) => {
          if (!(index in current)) throw new TypeError("Sparse arrays are not valid JSON");
          return serialize(current[index]);
        });
        return `[${values.join(",")}]`;
      }
      const prototype = Reflect.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError("Value is not a JSON object");
      const object = current as Record<string, unknown>;
      return `{${Object.keys(object)
        .sort()
        .map((key) => {
          assertUnicodeScalarString(key);
          return `${JSON.stringify(key)}:${serialize(object[key])}`;
        })
        .join(",")}}`;
    } finally {
      active.delete(current);
    }
  };

  return serialize(value);
}

function digest(tag: string, envelope: unknown): string {
  const canonical = jcsCanonicalize(envelope);
  return createHash("sha256").update(`${tag}\0${canonical}`, "utf8").digest("hex");
}

export function computeDeferralDigest(messageId: string, options: DeferOptions): string {
  const scopeProjection =
    options.scope.kind === "seller"
      ? { kind: "seller", sellerId: options.scope.sellerId }
      : { kind: "system" };
  return digest(DEFERRAL_TAG, {
    version: 1,
    messageId,
    deferralId: options.deferralId,
    deferralGeneration: options.deferralGeneration,
    deferredUntil: options.deferredUntil ?? null,
    reason: options.reason,
    detail: options.detail ?? null,
    evidenceRef: options.evidenceRef ?? null,
    scopeProjection,
  });
}

export function computeSettlementDigest(
  messageId: string,
  outcome: SettlementOutcome,
  options: SettlementOptions,
): string {
  const payload =
    outcome === "resolved"
      ? {
          result: "result" in options ? (options.result ?? null) : null,
          evidence: options.evidence ?? null,
        }
      : outcome === "failed"
        ? {
            error: "error" in options ? (options.error ?? null) : null,
            evidence: options.evidence ?? null,
          }
        : {
            reason: "reason" in options ? (options.reason ?? null) : null,
            evidence: options.evidence ?? null,
          };
  return digest(SETTLEMENT_TAG, { version: 1, messageId, outcome, payload });
}
