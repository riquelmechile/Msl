import { describe, expect, it } from "vitest";

import {
  canExecutePreparedAction,
  createPreparedAction,
  evaluateFreshness,
  evaluateSpecializationReadiness,
  requiresApproval,
  riskLevelForAction,
  type ApprovalRecord,
  type PreparedAction,
  type WriteActionKind,
} from "./index.js";

const future = new Date("2030-01-01T00:00:00.000Z");
const now = new Date("2026-06-25T12:00:00.000Z");

function preparedAction(kind: WriteActionKind): PreparedAction {
  return createPreparedAction({
    id: `action-${kind}`,
    sellerId: "seller-1",
    kind,
    target: { type: "listing", listingId: "MLC123" },
    exactChange: [{ field: "price", from: 1000, to: 1100 }],
    rationale: "Improve margin while keeping the offer competitive.",
    expiresAt: future,
  });
}

describe("approval-required writes", () => {
  it.each<WriteActionKind>([
    "price-change",
    "stock-change",
    "customer-message",
    "cancellation",
    "refund",
    "listing-edit",
    "creative-publication",
  ])("requires explicit approval before executing %s", (kind) => {
    const action = preparedAction(kind);

    expect(requiresApproval(kind)).toBe(true);
    expect(canExecutePreparedAction(action, now)).toEqual({
      allowed: false,
      reason: "missing-approval",
    });
  });

  it("allows execution only when the prepared action has a matching approval", () => {
    const action: PreparedAction = {
      ...preparedAction("price-change"),
      approvalStatus: "approved",
    };
    const approval: ApprovalRecord = {
      id: "approval-1",
      actionId: action.id,
      sellerId: action.sellerId,
      approvedBy: "seller",
      approvedAt: now,
      exactChangeAccepted: action.exactChange,
      riskAccepted: action.riskLevel,
    };

    expect(canExecutePreparedAction(action, now, approval)).toEqual({
      allowed: true,
      reason: "approved",
    });
  });

  it("blocks stale or tampered approvals bound to another action, seller, change, or risk", () => {
    const action: PreparedAction = {
      ...preparedAction("price-change"),
      approvalStatus: "approved",
    };
    const approval: ApprovalRecord = {
      id: "approval-1",
      actionId: action.id,
      sellerId: action.sellerId,
      approvedBy: "seller",
      approvedAt: now,
      exactChangeAccepted: action.exactChange,
      riskAccepted: action.riskLevel,
    };

    expect(
      canExecutePreparedAction(action, now, { ...approval, actionId: "action-other" }),
    ).toEqual({
      allowed: false,
      reason: "approval-mismatch",
    });
    expect(canExecutePreparedAction(action, now, { ...approval, sellerId: "seller-2" })).toEqual({
      allowed: false,
      reason: "approval-mismatch",
    });
    expect(
      canExecutePreparedAction(action, now, {
        ...approval,
        exactChangeAccepted: [{ field: "price", from: 1000, to: 1200 }],
      }),
    ).toEqual({ allowed: false, reason: "approval-mismatch" });
    expect(canExecutePreparedAction(action, now, { ...approval, riskAccepted: "high" })).toEqual({
      allowed: false,
      reason: "approval-mismatch",
    });
  });

  it("uses the injected timestamp when checking expiry", () => {
    const action: PreparedAction = {
      ...preparedAction("price-change"),
      approvalStatus: "approved",
      expiresAt: new Date("2026-06-25T12:00:00.000Z"),
    };
    const approval: ApprovalRecord = {
      id: "approval-1",
      actionId: action.id,
      sellerId: action.sellerId,
      approvedBy: "seller",
      approvedAt: now,
      exactChangeAccepted: action.exactChange,
      riskAccepted: action.riskLevel,
    };

    expect(
      canExecutePreparedAction(action, new Date("2026-06-25T11:59:59.000Z"), approval),
    ).toEqual({
      allowed: true,
      reason: "approved",
    });
    expect(canExecutePreparedAction(action, now, approval)).toEqual({
      allowed: false,
      reason: "expired-action",
    });
  });
});

describe("risk labels", () => {
  it.each([
    ["price-change", "medium"],
    ["stock-change", "medium"],
    ["customer-message", "medium"],
    ["cancellation", "high"],
    ["refund", "high"],
    ["listing-edit", "high"],
    ["creative-publication", "high"],
  ] satisfies Array<[WriteActionKind, string]>)('labels "%s" as %s risk', (kind, risk) => {
    expect(riskLevelForAction(kind)).toBe(risk);
  });
});

describe("freshness by business risk", () => {
  it("marks critical signals stale after the near-real-time freshness window", () => {
    const freshness = evaluateFreshness({
      source: "local-cache",
      signalKind: "claim",
      capturedAt: new Date("2026-06-25T12:00:00.000Z"),
      now: new Date("2026-06-25T12:06:00.000Z"),
    });

    expect(freshness).toMatchObject({ risk: "critical", status: "stale" });
  });

  it("keeps low-risk historical summaries usable for daily analysis", () => {
    const freshness = evaluateFreshness({
      source: "local-cache",
      signalKind: "historical-summary",
      capturedAt: new Date("2026-06-25T00:00:00.000Z"),
      now: new Date("2026-06-25T12:00:00.000Z"),
    });

    expect(freshness).toMatchObject({ risk: "low", status: "fresh" });
  });
});

describe("specialization evidence", () => {
  it("blocks premature specialization when examples and decision criteria are incomplete", () => {
    const readiness = evaluateSpecializationReadiness({
      sellerId: "seller-1",
      workflowName: "supplier sourcing after sale",
      observedExamples: 1,
      hasDecisionCriteria: false,
      hasOutcomeHistory: false,
      hasSafetyBoundaries: false,
      learnedFromCorrections: false,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.requiredEvidence).toContain("at least three observed workflow examples");
    expect(readiness.requiredEvidence).toContain("seller decision criteria");
    expect(readiness.requiredEvidence).toContain("approval, audit, and rollback boundaries");
  });
});
