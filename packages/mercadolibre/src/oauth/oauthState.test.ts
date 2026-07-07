import { describe, expect, it, vi, afterEach } from "vitest";
import {
  generateState,
  validateState,
  DEFAULT_STATE_TTL_MS,
  type OAuthStatePayload,
  generateNonce,
} from "./oauthState.js";

function payload(overrides: Partial<OAuthStatePayload> = {}): OAuthStatePayload {
  return {
    role: "source",
    sellerId: "plasticov",
    nonce: "test-nonce",
    createdAt: Date.now(),
    ...overrides,
  };
}

const SECRET = "super-secret-state-key-32bytes!";

describe("oauthState", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trip: generate → validate returns same payload", () => {
    const p = payload();
    const state = generateState(p, SECRET);
    const parsed = validateState(state, SECRET);

    expect(parsed.role).toBe(p.role);
    expect(parsed.sellerId).toBe(p.sellerId);
    expect(parsed.nonce).toBe(p.nonce);
    expect(parsed.createdAt).toBe(p.createdAt);
  });

  it("round-trip with target role", () => {
    const p = payload({ role: "target", sellerId: "maustian" });
    const state = generateState(p, SECRET);
    const parsed = validateState(state, SECRET);

    expect(parsed.role).toBe("target");
    expect(parsed.sellerId).toBe("maustian");
  });

  it("expired state throws", () => {
    const p = payload({ createdAt: Date.now() - 120_000 }); // 2 minutes old
    const state = generateState(p, SECRET);

    // TTL of 60 seconds — should be expired
    expect(() => validateState(state, SECRET, 60_000)).toThrow(
      /State token expired/,
    );
  });

  it("state within default TTL (10 min) validates fine", () => {
    const p = payload({ createdAt: Date.now() - 300_000 }); // 5 minutes old
    const state = generateState(p, SECRET);

    // Default TTL is 10 minutes
    const parsed = validateState(state, SECRET);
    expect(parsed.role).toBe(p.role);
  });

  it("tampered signature throws", () => {
    const p = payload();
    const state = generateState(p, SECRET);

    // Tamper with the signature part
    const parts = state.split(".");
    const tamperedState = `${parts[0]}.tampered_signature`;

    expect(() => validateState(tamperedState, SECRET)).toThrow(
      /Invalid state/,
    );
  });

  it("tampered payload throws", () => {
    const p = payload();
    const state = generateState(p, SECRET);

    // Tamper with the payload by changing a character in base64
    const parts = state.split(".");
    const tamperedPayload = parts[0]!.slice(0, -1) + "X";
    const tamperedState = `${tamperedPayload}.${parts[1]}`;

    expect(() => validateState(tamperedState, SECRET)).toThrow(
      /Invalid state/,
    );
  });

  it("malformed format (no dot) throws", () => {
    expect(() => validateState("no_dot_present", SECRET)).toThrow(
      /Malformed state token: missing signature separator/,
    );
  });

  it("malformed format (empty payload) throws", () => {
    expect(() => validateState(".signature_only", SECRET)).toThrow(
      /Malformed state token/,
    );
  });

  it("malformed format (empty signature) throws", () => {
    expect(() => validateState("payload_only.", SECRET)).toThrow(
      /Malformed state token/,
    );
  });

  it("malformed payload (not valid base64) does not throw HMAC error", () => {
    // Invalid base64 in payload
    expect(() => validateState("!!!not-base64.somesig", SECRET)).toThrow();
  });

  it("different secret produces different state", () => {
    const p = payload();
    const state1 = generateState(p, "secret-A");
    const state2 = generateState(p, "secret-B");

    expect(state1).not.toBe(state2);

    // Cross-validate should fail
    expect(() => validateState(state1, "secret-B")).toThrow(/Invalid state/);
    expect(() => validateState(state2, "secret-A")).toThrow(/Invalid state/);
  });

  it("custom TTL is respected", () => {
    const p = payload({ createdAt: Date.now() - 30_000 }); // 30 seconds old

    // TTL of 20 seconds — should be expired
    const state = generateState(p, SECRET);
    expect(() => validateState(state, SECRET, 20_000)).toThrow(
      /State token expired/,
    );
  });

  it("generateNonce produces different values", () => {
    const n1 = generateNonce();
    const n2 = generateNonce();

    expect(n1).not.toBe(n2);
    expect(n1.length).toBeGreaterThan(0);
  });
});
