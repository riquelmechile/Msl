import { describe, expect, it } from "vitest";

import {
  canExecutePreparedAction,
  createPreparedAction,
  evaluateFreshness,
  evaluateSpecializationReadiness,
  isReadSnapshotFresh,
  isReadSnapshotReliable,
  requiresApproval,
  riskLevelForAction,
  type ApprovalRecord,
  type MlClaim,
  type MlMessage,
  type MlOrder,
  type PreparedAction,
  type ReadSnapshot,
  type SellerReputation,
  type StockRecord,
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
    ["honey-pot-deploy", "high"],
    ["probe-analysis", "high"],
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

describe("read snapshots", () => {
  it("represents fresh complete metadata as reliable", () => {
    const snapshot: ReadSnapshot<{ id: string }> = {
      sellerId: "seller-1",
      kind: "listing",
      source: "mercadolibre-api",
      data: [{ id: "MLC123" }],
      completeness: "complete",
      freshness: evaluateFreshness({
        source: "mercadolibre-api",
        signalKind: "listing",
        capturedAt: new Date("2026-06-25T12:00:00.000Z"),
        now: new Date("2026-06-25T12:05:00.000Z"),
      }),
      confidence: "high",
    };

    expect(snapshot.freshness.status).toBe("fresh");
    expect(isReadSnapshotFresh(snapshot)).toBe(true);
    expect(isReadSnapshotReliable(snapshot)).toBe(true);
  });

  it("exposes stale metadata instead of treating old reads as fresh", () => {
    const snapshot: ReadSnapshot<{ id: string }> = {
      sellerId: "seller-1",
      kind: "message",
      source: "local-cache",
      data: [{ id: "message-1" }],
      completeness: "complete",
      freshness: evaluateFreshness({
        source: "local-cache",
        signalKind: "message",
        capturedAt: new Date("2026-06-25T12:00:00.000Z"),
        now: new Date("2026-06-25T12:06:00.000Z"),
      }),
      confidence: "medium",
    };

    expect(snapshot.freshness.status).toBe("stale");
    expect(isReadSnapshotFresh(snapshot)).toBe(false);
    expect(isReadSnapshotReliable(snapshot)).toBe(false);
  });

  it("keeps partial low-confidence evidence visible", () => {
    const snapshot: ReadSnapshot<{ score: number | null }> = {
      sellerId: "seller-1",
      kind: "reputation",
      source: "mercadolibre-api",
      data: { score: null },
      completeness: "partial",
      freshness: evaluateFreshness({
        source: "mercadolibre-api",
        signalKind: "reputation",
        capturedAt: new Date("2026-06-25T12:00:00.000Z"),
        now: new Date("2026-06-25T12:01:00.000Z"),
      }),
      confidence: "low",
    };

    expect(snapshot.completeness).toBe("partial");
    expect(snapshot.confidence).toBe("low");
    expect(isReadSnapshotReliable(snapshot)).toBe(false);
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

describe("domain types — Order", () => {
  it("constructs an MlOrder with valid data", () => {
    const order: MlOrder = {
      orderId: "order-1" as MlOrder["orderId"],
      sellerId: "seller-1",
      buyerId: "buyer-42",
      status: "paid",
      totalAmount: 25990,
      items: [{ itemId: "MLC123", title: "Zapatillas running", quantity: 1, unitPrice: 25990 }],
      createdAt: "2026-06-25T12:00:00.000Z",
    };

    expect(order.orderId).toBe("order-1");
    expect(order.status).toBe("paid");
    expect(order.items).toHaveLength(1);
    expect(order.shippedAt).toBeUndefined();
  });

  it("supports all order statuses", () => {
    const statuses: MlOrder["status"][] = [
      "pending",
      "paid",
      "shipped",
      "delivered",
      "cancelled",
      "returned",
    ];
    // Each status should be assignable — compilation check, no runtime assertion needed
    expect(statuses).toHaveLength(6);
  });
});

describe("domain types — Message", () => {
  it("constructs an MlMessage with valid data", () => {
    const message: MlMessage = {
      messageId: "msg-1" as MlMessage["messageId"],
      sellerId: "seller-1",
      itemId: "MLC123",
      from: "buyer",
      text: "¿Tienen talle 42?",
      status: "unanswered",
      createdAt: "2026-06-25T12:00:00.000Z",
    };

    expect(message.from).toBe("buyer");
    expect(message.status).toBe("unanswered");
    expect(message.answeredAt).toBeUndefined();
  });
});

describe("domain types — Reputation", () => {
  it("constructs a SellerReputation with valid data", () => {
    const reputation: SellerReputation = {
      sellerId: "seller-1",
      level: "green",
      powerSellerStatus: "platinum",
      transactions: { total: 500, completed: 490, cancelled: 10 },
      metrics: {
        claimsRate: 0.02,
        delayedHandlingRate: 0.05,
        salesCompletionRate: 0.98,
        customerServiceRate: 0.95,
      },
    };

    expect(reputation.level).toBe("green");
    expect(reputation.powerSellerStatus).toBe("platinum");
    expect(reputation.metrics.claimsRate).toBe(0.02);
  });

  it("orders reputation levels correctly (green > red)", () => {
    const ordered: SellerReputation["level"][] = [
      "green",
      "light_green",
      "yellow",
      "orange",
      "red",
    ];

    const greenIdx = ordered.indexOf("green");
    const redIdx = ordered.indexOf("red");

    // "green" should appear before "red" — lower index is better reputation
    expect(greenIdx).toBeLessThan(redIdx);
  });
});

describe("domain types — Claim", () => {
  it("constructs an MlClaim with valid data", () => {
    const claim: MlClaim = {
      claimId: "claim-1" as MlClaim["claimId"],
      sellerId: "seller-1",
      orderId: "order-1" as MlClaim["orderId"],
      type: "item_not_received",
      status: "open",
      createdAt: "2026-06-25T12:00:00.000Z",
    };

    expect(claim.type).toBe("item_not_received");
    expect(claim.status).toBe("open");
    expect(claim.resolution).toBeUndefined();
  });

  it("allows resolution on resolved claims", () => {
    const claim: MlClaim = {
      claimId: "claim-2" as MlClaim["claimId"],
      sellerId: "seller-1",
      orderId: "order-2" as MlClaim["orderId"],
      type: "buyer_protection",
      status: "resolved",
      resolution: "Reembolso completo emitido al comprador.",
      createdAt: "2026-06-25T10:00:00.000Z",
      resolvedAt: "2026-06-26T10:00:00.000Z",
    };

    expect(claim.status).toBe("resolved");
    expect(claim.resolution).toBe("Reembolso completo emitido al comprador.");
    expect(claim.resolvedAt).toBe("2026-06-26T10:00:00.000Z");
  });
});

describe("domain types — Stock", () => {
  it("constructs a StockRecord with valid data", () => {
    const stock: StockRecord = {
      sellerId: "seller-1",
      itemId: "MLC123",
      availableQuantity: 15,
      reservedQuantity: 3,
      minimumThreshold: 5,
      lastUpdated: "2026-06-25T12:00:00.000Z",
    };

    expect(stock.availableQuantity).toBe(15);
    expect(stock.reservedQuantity).toBe(3);
    expect(stock.minimumThreshold).toBe(5);
  });

  it("reflects low stock when available falls below threshold", () => {
    const stock: StockRecord = {
      sellerId: "seller-1",
      itemId: "MLC456",
      availableQuantity: 2,
      reservedQuantity: 1,
      minimumThreshold: 5,
      lastUpdated: "2026-06-25T12:00:00.000Z",
    };

    expect(stock.availableQuantity).toBeLessThan(stock.minimumThreshold);
  });
});
