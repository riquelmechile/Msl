import { beforeEach, describe, expect, it } from "vitest";
import {
  createEconomicOutcome,
  ECONOMIC_OUTCOME_STATUSES,
  EconomicOutcomeStateError,
  transitionOutcome,
  VALID_OUTCOME_TRANSITIONS,
  type EconomicOutcome,
} from "./economicOutcome.js";

describe("EconomicOutcomeStatus", () => {
  it("has exactly 6 statuses", () => {
    expect(ECONOMIC_OUTCOME_STATUSES).toHaveLength(6);
  });

  it("includes pending, observing, observed, verified, disputed, invalidated", () => {
    expect(ECONOMIC_OUTCOME_STATUSES).toContain("pending");
    expect(ECONOMIC_OUTCOME_STATUSES).toContain("observing");
    expect(ECONOMIC_OUTCOME_STATUSES).toContain("observed");
    expect(ECONOMIC_OUTCOME_STATUSES).toContain("verified");
    expect(ECONOMIC_OUTCOME_STATUSES).toContain("disputed");
    expect(ECONOMIC_OUTCOME_STATUSES).toContain("invalidated");
  });
});

describe("VALID_OUTCOME_TRANSITIONS", () => {
  it("defines valid transitions for every source status", () => {
    for (const status of ECONOMIC_OUTCOME_STATUSES) {
      expect(VALID_OUTCOME_TRANSITIONS).toHaveProperty(status);
    }
  });

  it("allows pending → observing", () => {
    expect(VALID_OUTCOME_TRANSITIONS["pending"]).toContain("observing");
  });

  it("allows observing → observed", () => {
    expect(VALID_OUTCOME_TRANSITIONS["observing"]).toContain("observed");
  });

  it("allows observed → verified", () => {
    expect(VALID_OUTCOME_TRANSITIONS["observed"]).toContain("verified");
  });

  it("allows observed → disputed", () => {
    expect(VALID_OUTCOME_TRANSITIONS["observed"]).toContain("disputed");
  });

  it("allows observed → invalidated", () => {
    expect(VALID_OUTCOME_TRANSITIONS["observed"]).toContain("invalidated");
  });

  it("terminal states have no valid transitions", () => {
    expect(VALID_OUTCOME_TRANSITIONS["verified"]).toHaveLength(0);
    expect(VALID_OUTCOME_TRANSITIONS["disputed"]).toHaveLength(0);
    expect(VALID_OUTCOME_TRANSITIONS["invalidated"]).toHaveLength(0);
  });
});

describe("transitionOutcome", () => {
  let outcome: EconomicOutcome;

  beforeEach(() => {
    outcome = createEconomicOutcome({
      sellerId: "seller-1",
    });
  });

  it("progresses pending → observing → observed → verified", () => {
    let current = outcome;
    expect(current.status).toBe("pending");

    current = transitionOutcome(current, "observing");
    expect(current.status).toBe("observing");

    current = transitionOutcome(current, "observed");
    expect(current.status).toBe("observed");

    current = transitionOutcome(current, "verified");
    expect(current.status).toBe("verified");
  });

  it("allows observed → disputed", () => {
    outcome = transitionOutcome(transitionOutcome(outcome, "observing"), "observed");
    const disputed = transitionOutcome(outcome, "disputed");
    expect(disputed.status).toBe("disputed");
  });

  it("allows observed → invalidated", () => {
    outcome = transitionOutcome(transitionOutcome(outcome, "observing"), "observed");
    const invalidated = transitionOutcome(outcome, "invalidated");
    expect(invalidated.status).toBe("invalidated");
  });

  // ── Rejections ──────────────────────────────────────────────────

  it("rejects verified → observed", () => {
    outcome = transitionOutcome(
      transitionOutcome(transitionOutcome(outcome, "observing"), "observed"),
      "verified",
    );
    expect(() => transitionOutcome(outcome, "observed")).toThrow(EconomicOutcomeStateError);
  });

  it("rejects verified → anything (terminal)", () => {
    outcome = transitionOutcome(
      transitionOutcome(transitionOutcome(outcome, "observing"), "observed"),
      "verified",
    );
    expect(() => transitionOutcome(outcome, "pending")).toThrow(EconomicOutcomeStateError);
    expect(() => transitionOutcome(outcome, "observing")).toThrow(EconomicOutcomeStateError);
    expect(() => transitionOutcome(outcome, "disputed")).toThrow(EconomicOutcomeStateError);
  });

  it("rejects disputed → anything (terminal)", () => {
    outcome = transitionOutcome(
      transitionOutcome(transitionOutcome(outcome, "observing"), "observed"),
      "disputed",
    );
    expect(() => transitionOutcome(outcome, "pending")).toThrow(EconomicOutcomeStateError);
    expect(() => transitionOutcome(outcome, "verified")).toThrow(EconomicOutcomeStateError);
  });

  it("rejects invalidated → anything (terminal)", () => {
    outcome = transitionOutcome(
      transitionOutcome(transitionOutcome(outcome, "observing"), "observed"),
      "invalidated",
    );
    expect(() => transitionOutcome(outcome, "pending")).toThrow(EconomicOutcomeStateError);
    expect(() => transitionOutcome(outcome, "verified")).toThrow(EconomicOutcomeStateError);
  });

  it("rejects pending → observed (skip observing)", () => {
    expect(() => transitionOutcome(outcome, "observed")).toThrow(EconomicOutcomeStateError);
  });

  it("rejects pending → verified (skip all)", () => {
    expect(() => transitionOutcome(outcome, "verified")).toThrow(EconomicOutcomeStateError);
  });

  it("rejects observing → verified (skip observed)", () => {
    outcome = transitionOutcome(outcome, "observing");
    expect(() => transitionOutcome(outcome, "verified")).toThrow(EconomicOutcomeStateError);
  });

  it("invalid transition does not modify the original outcome (immutability)", () => {
    const original = outcome;
    expect(original.status).toBe("pending");

    expect(() => transitionOutcome(original, "verified")).toThrow(EconomicOutcomeStateError);

    // Original is unchanged after failed transition
    expect(original.status).toBe("pending");
    expect(original.confidence).toBe(0);
    expect(original.completeness).toBe(0);
    expect(original.outcomeId).toBeTruthy();
    expect(original.createdAt).toBeGreaterThan(0);
  });

  it("verified cannot transition back to pending", () => {
    const current = transitionOutcome(
      transitionOutcome(transitionOutcome(outcome, "observing"), "observed"),
      "verified",
    );
    expect(current.status).toBe("verified");
    expect(() => transitionOutcome(current, "pending")).toThrow(EconomicOutcomeStateError);
  });

  it("disputed is terminal — cannot transition to anything", () => {
    const current = transitionOutcome(
      transitionOutcome(transitionOutcome(outcome, "observing"), "observed"),
      "disputed",
    );
    expect(current.status).toBe("disputed");
    expect(() => transitionOutcome(current, "pending")).toThrow(EconomicOutcomeStateError);
    expect(() => transitionOutcome(current, "observing")).toThrow(EconomicOutcomeStateError);
    expect(() => transitionOutcome(current, "observed")).toThrow(EconomicOutcomeStateError);
    expect(() => transitionOutcome(current, "verified")).toThrow(EconomicOutcomeStateError);
    expect(() => transitionOutcome(current, "invalidated")).toThrow(EconomicOutcomeStateError);
  });

  it("invalidated is terminal — cannot transition to anything", () => {
    const current = transitionOutcome(
      transitionOutcome(transitionOutcome(outcome, "observing"), "observed"),
      "invalidated",
    );
    expect(current.status).toBe("invalidated");
    expect(() => transitionOutcome(current, "pending")).toThrow(EconomicOutcomeStateError);
    expect(() => transitionOutcome(current, "observing")).toThrow(EconomicOutcomeStateError);
    expect(() => transitionOutcome(current, "observed")).toThrow(EconomicOutcomeStateError);
    expect(() => transitionOutcome(current, "verified")).toThrow(EconomicOutcomeStateError);
    expect(() => transitionOutcome(current, "disputed")).toThrow(EconomicOutcomeStateError);
  });
});

describe("createEconomicOutcome", () => {
  it("creates an outcome with factory defaults", () => {
    const outcome = createEconomicOutcome({ sellerId: "seller-1" });
    expect(outcome.status).toBe("pending");
    expect(outcome.confidence).toBe(0);
    expect(outcome.completeness).toBe(0);
    expect(outcome.evidenceIds).toEqual([]);
    expect(typeof outcome.outcomeId).toBe("string");
    expect(outcome.createdAt).toBeGreaterThan(0);
  });

  it("creates an outcome with all optional fields", () => {
    const outcome = createEconomicOutcome({
      sellerId: "seller-1",
      accountId: "acc-1",
      channel: "mercadolibre",
      proposalId: "prop-1",
      preparedActionId: "action-1",
      executionId: "exec-1",
      correlationId: "corr-1",
      workSessionId: "ws-1",
      originatingAgentId: "agent-1",
      orderId: "order-1",
      itemId: "item-1",
      sku: "SKU-001",
      expectedEconomicImpact: "POSITIVE",
      observationWindow: { start: 1000, end: 2000 },
      baselineReference: "baseline-1",
    });

    expect(outcome.sellerId).toBe("seller-1");
    expect(outcome.accountId).toBe("acc-1");
    expect(outcome.channel).toBe("mercadolibre");
    expect(outcome.proposalId).toBe("prop-1");
    expect(outcome.correlationId).toBe("corr-1");
    expect(outcome.orderId).toBe("order-1");
    expect(outcome.sku).toBe("SKU-001");
    expect(outcome.expectedEconomicImpact).toBe("POSITIVE");
    expect(outcome.observationWindow).toEqual({ start: 1000, end: 2000 });
  });
});
