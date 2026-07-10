import { describe, it, expect } from "vitest";
import {
  hashAgentSignals,
  shouldAgentWakeUp,
  computeSignalDelta,
  WAKE_COOLDOWN_MS,
} from "./agentWakePolicy.js";
import type { SignalDescriptor, ShouldWakeInput } from "./agentWakePolicy.js";
import type { AgentWorkSession } from "@msl/domain";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<AgentWorkSession> = {}): AgentWorkSession {
  const now = new Date();
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  return {
    sessionId: "sess-test",
    sellerId: "plasticov-mlc",
    agentId: "product-ads-profitability",
    laneId: "product-ads-profitability",
    status: "completed",
    signalsHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    stablePromptHash: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7",
    evidenceHash: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
    startedAt: thirtyMinAgo,
    endedAt: thirtyMinAgo,
    cycleCount: 1,
    summaryJson: "{}",
    ...overrides,
  };
}

function makeInput(overrides: Partial<ShouldWakeInput> = {}): ShouldWakeInput {
  return {
    sellerId: "plasticov-mlc",
    agentId: "product-ads-profitability",
    signals: [{ type: "unanswered_questions", count: 3 }],
    ...overrides,
  };
}

const qSignals: SignalDescriptor[] = [{ type: "unanswered_questions", count: 3 }];
const qReputationSignals: SignalDescriptor[] = [
  { type: "unanswered_questions", count: 3 },
  { type: "reputation_drop", severity: "critical" },
];

// ── Signal hashing ─────────────────────────────────────────────────────────

describe("hashAgentSignals", () => {
  it("produces same hash for identical signals", () => {
    const h1 = hashAgentSignals(qSignals);
    const h2 = hashAgentSignals(qSignals);
    expect(h1).toBe(h2);
  });

  it("produces different hash for different signals", () => {
    const h1 = hashAgentSignals(qSignals);
    const h2 = hashAgentSignals(qReputationSignals);
    expect(h1).not.toBe(h2);
  });

  it("is deterministic regardless of input order", () => {
    const reversed = [...qReputationSignals].reverse();
    const h1 = hashAgentSignals(qReputationSignals);
    const h2 = hashAgentSignals(reversed);
    expect(h1).toBe(h2);
  });

  it("produces a 64-char hex hash", () => {
    const hash = hashAgentSignals(qSignals);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ── Wake decision — scenarios ──────────────────────────────────────────────

describe("shouldAgentWakeUp", () => {
  it("no wake: same signal hash, session completed recently", () => {
    const signalsHash = hashAgentSignals(qSignals);
    const lastSession = makeSession({ signalsHash });
    const result = shouldAgentWakeUp(makeInput({ signals: qSignals, lastSession }));
    expect(result.shouldWake).toBe(false);
    expect(result.reason).toBe("no new signals");
  });

  it("wake: new unanswered ML question (different hash)", () => {
    const lastSession = makeSession({ signalsHash: "oldhasholdhasholdhasholdhasholdhasholdha" });
    const result = shouldAgentWakeUp(makeInput({ signals: qSignals, lastSession }));
    expect(result.shouldWake).toBe(true);
    expect(result.reason).toBe("new signal");
  });

  it("wake: high severity overrides cooldown", () => {
    const highRiskSignals: SignalDescriptor[] = [{ type: "reputation_drop", severity: "critical" }];
    const signalsHash = hashAgentSignals(highRiskSignals);
    const lastSession = makeSession({ signalsHash });
    const result = shouldAgentWakeUp(makeInput({ signals: highRiskSignals, lastSession }));
    expect(result.shouldWake).toBe(true);
    expect(result.reason).toBe("high severity signal");
  });

  it("no wake: pending equivalent proposal", () => {
    const signalsHash = hashAgentSignals(qSignals);
    const lastSession = makeSession({
      signalsHash,
      endedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // > 1h ago
    });
    const result = shouldAgentWakeUp(
      makeInput({ signals: qSignals, lastSession, pendingProposals: ["prop-1"] }),
    );
    expect(result.shouldWake).toBe(false);
    expect(result.reason).toBe("pending equivalent proposal");
  });

  it("wake: manual override always wakes", () => {
    const signalsHash = hashAgentSignals(qSignals);
    const lastSession = makeSession({ signalsHash });
    const result = shouldAgentWakeUp(makeInput({ signals: qSignals, lastSession, manual: true }));
    expect(result.shouldWake).toBe(true);
    expect(result.reason).toBe("manual override");
  });

  it("wake: no last session + signals present", () => {
    const result = shouldAgentWakeUp(makeInput({ signals: qSignals }));
    expect(result.shouldWake).toBe(true);
    expect(result.reason).toBe("new signal");
  });

  it("no wake: no signals at all", () => {
    const result = shouldAgentWakeUp(makeInput({ signals: [] }));
    expect(result.shouldWake).toBe(false);
    expect(result.reason).toBe("no signals");
  });

  it("cooldown window is respected: session 30min old → no wake", () => {
    const signalsHash = hashAgentSignals(qSignals);
    const recentSession = makeSession({
      signalsHash,
      startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      endedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });
    const result = shouldAgentWakeUp(makeInput({ signals: qSignals, lastSession: recentSession }));
    expect(result.shouldWake).toBe(false);
  });

  it("cooldown window passed: session 2h old → wake", () => {
    const signalsHash = hashAgentSignals(qSignals);
    const oldSession = makeSession({
      signalsHash,
      endedAt: new Date(Date.now() - 2 * WAKE_COOLDOWN_MS).toISOString(),
    });
    const result = shouldAgentWakeUp(makeInput({ signals: qSignals, lastSession: oldSession }));
    expect(result.shouldWake).toBe(true);
    expect(result.reason).toBe("new signal");
  });
});

// ── Seller isolation ───────────────────────────────────────────────────────

describe("shouldAgentWakeUp — seller isolation", () => {
  it("seller A's signals do not affect seller B", () => {
    const plasticovInput = makeInput({
      sellerId: "plasticov-mlc",
      signals: qReputationSignals,
    });

    const maustianInput = makeInput({
      sellerId: "maustian-mlc",
      signals: qSignals,
      lastSession: makeSession({
        sellerId: "maustian-mlc",
        signalsHash: hashAgentSignals(qSignals),
      }),
    });

    const plasticovDecision = shouldAgentWakeUp(plasticovInput);
    const maustianDecision = shouldAgentWakeUp(maustianInput);

    // Plasticov has critical signal → must wake
    expect(plasticovDecision.shouldWake).toBe(true);
    expect(plasticovDecision.reason).toBe("high severity signal");

    // Maustian has same signals as before, recent session → no wake
    expect(maustianDecision.shouldWake).toBe(false);
    expect(maustianDecision.reason).toBe("no new signals");
  });
});

// ── Signal delta ───────────────────────────────────────────────────────────

describe("computeSignalDelta", () => {
  it("detects added signals", () => {
    const prev = ["q_aging"];
    const curr = ["q_aging", "reputation_drop"];
    const delta = computeSignalDelta(prev, curr);
    expect(delta.added).toEqual(["reputation_drop"]);
    expect(delta.removed).toEqual([]);
    expect(delta.unchanged).toEqual(["q_aging"]);
  });

  it("detects removed signals", () => {
    const prev = ["q_aging", "low_stock"];
    const curr = ["q_aging"];
    const delta = computeSignalDelta(prev, curr);
    expect(delta.removed).toEqual(["low_stock"]);
    expect(delta.unchanged).toEqual(["q_aging"]);
  });

  it("detects completely new and completely gone", () => {
    const prev = ["q_aging", "low_stock"];
    const curr = ["reputation_drop", "margin_warning"];
    const delta = computeSignalDelta(prev, curr);
    expect(delta.added.sort()).toEqual(["margin_warning", "reputation_drop"]);
    expect(delta.removed.sort()).toEqual(["low_stock", "q_aging"]);
    expect(delta.unchanged).toEqual([]);
  });

  it("handles empty previous", () => {
    const delta = computeSignalDelta([], ["q_aging"]);
    expect(delta.added).toEqual(["q_aging"]);
    expect(delta.removed).toEqual([]);
    expect(delta.unchanged).toEqual([]);
  });

  it("handles empty current", () => {
    const delta = computeSignalDelta(["q_aging"], []);
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual(["q_aging"]);
    expect(delta.unchanged).toEqual([]);
  });

  it("handles both empty", () => {
    const delta = computeSignalDelta([], []);
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual([]);
    expect(delta.unchanged).toEqual([]);
  });
});
