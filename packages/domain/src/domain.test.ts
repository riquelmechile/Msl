import { describe, expect, it } from "vitest";

import {
  canExecutePreparedAction,
  canExecuteOwnedEcommerceAction,
  canMakeHighConfidenceClaimFromEvidence,
  buildDeepSeekChatCompletionRequest,
  createPreparedAction,
  confidenceForOperationalEvidence,
  DEFAULT_DEEPSEEK_MODEL,
  evaluateFreshness,
  evaluateSpecializationReadiness,
  guardrailsForCandidateEvidence,
  isOwnedEcommerceGuardrailCode,
  isReadSnapshotFresh,
  isReadSnapshotReliable,
  requiresApproval,
  riskLevelForAction,
  resolveDeepSeekCredentialRef,
  resolveDeepSeekRuntimeConfig,
  resolveDeepSeekUserId,
  summarizeProjectionReadiness,
  type ApprovalRecord,
  type CandidateProvenance,
  type OwnedEcommerceExecutionApprovalBinding,
  type MlClaim,
  type Listing,
  type MlMessage,
  type MlOrder,
  type OperationalEvidence,
  type PreparedAction,
  type ReadSnapshot,
  type SellerReputation,
  type StockRecord,
  type WriteActionKind,
} from "./index.js";

const future = new Date("2030-01-01T00:00:00.000Z");
const now = new Date("2026-06-25T12:00:00.000Z");

describe("DeepSeek runtime routing", () => {
  it("uses one shared key with default v4 flash model and optional runtime overrides", () => {
    expect(resolveDeepSeekRuntimeConfig({})).toEqual({
      baseURL: "https://api.deepseek.com",
      model: DEFAULT_DEEPSEEK_MODEL,
    });

    expect(
      resolveDeepSeekRuntimeConfig({
        DEEPSEEK_API_KEY: "synthetic-key",
        DEEPSEEK_BASE_URL: "https://deepseek.example.test",
        DEEPSEEK_MODEL: "deepseek-v4-pro",
      }),
    ).toEqual({
      apiKey: "synthetic-key",
      credentialRef: "env:DEEPSEEK_API_KEY",
      baseURL: "https://deepseek.example.test",
      model: "deepseek-v4-pro",
    });
  });

  it("builds stable lane and seller user_id values without per-agent API keys", () => {
    expect(
      resolveDeepSeekUserId({
        laneId: "Owned Ecommerce",
        sellerId: "Plasticov MLC",
        agentId: "SEO/GEO Worker",
      }),
    ).toBe("msl-lane-owned-ecommerce-seller-plasticov-mlc-agent-seo-geo-worker");

    expect(
      resolveDeepSeekCredentialRef({
        laneId: "Owned Ecommerce",
        sellerId: "Plasticov MLC",
        agentId: "SEO/GEO Worker",
      }),
    ).toBe("env:DEEPSEEK_API_KEY:lane:owned-ecommerce:seller:plasticov-mlc:agent:seo-geo-worker");
  });

  it("passes DeepSeek user_id through OpenAI SDK extra_body", () => {
    expect(
      buildDeepSeekChatCompletionRequest({
        model: DEFAULT_DEEPSEEK_MODEL,
        messages: [{ role: "user", content: "hello" }],
        stream: false,
        userId: "msl-lane-ceo-seller-123",
      }),
    ).toMatchObject({
      model: DEFAULT_DEEPSEEK_MODEL,
      extra_body: { user_id: "msl-lane-ceo-seller-123" },
    });
  });
});

function preparedAction(kind: WriteActionKind): PreparedAction {
  const target = kind.startsWith("owned-ecommerce-")
    ? kind === "owned-ecommerce-price-change" || kind === "owned-ecommerce-stock-change"
      ? ({ type: "ecommerce-catalog-item", itemRef: "jinpeng:XKP-001" } as const)
      : ({ type: "storefront-projection", projectionId: "projection-1" } as const)
    : ({ type: "listing", listingId: "MLC123" } as const);

  return createPreparedAction({
    id: `action-${kind}`,
    sellerId: "seller-1",
    kind,
    target,
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
    "supplier-mirror-publish-proposal",
    "supplier-mirror-price-proposal",
    "supplier-mirror-pause-listing",
    "owned-ecommerce-publish",
    "owned-ecommerce-checkout-activation",
    "owned-ecommerce-price-change",
    "owned-ecommerce-stock-change",
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
      executionStatus: "not-executed",
    };

    expect(approval.executionStatus).toBe("not-executed");
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
      executionStatus: "not-executed",
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
      executionStatus: "not-executed",
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

describe("owned ecommerce execution approval binding", () => {
  function approvedOwnedEcommerceAction(): PreparedAction {
    return {
      ...preparedAction("owned-ecommerce-publish"),
      approvalStatus: "approved",
      rationale: "Publish the approved storefront projection.",
    };
  }

  function executionBinding(
    action: PreparedAction,
    overrides: Partial<OwnedEcommerceExecutionApprovalBinding> = {},
  ): OwnedEcommerceExecutionApprovalBinding {
    return {
      actionId: action.id,
      projectionId: "projection-1",
      projectionVersion: "projection-1:v1",
      target: { type: "storefront-projection", projectionId: "projection-1" },
      operation: "publish",
      approver: "seller",
      risk: action.riskLevel,
      rationale: action.rationale,
      expiresAt: future,
      ...overrides,
    };
  }

  function approvalFor(
    action: PreparedAction,
    binding: OwnedEcommerceExecutionApprovalBinding,
  ): ApprovalRecord {
    return {
      id: "approval-owned-ecommerce-1",
      actionId: action.id,
      sellerId: action.sellerId,
      approvedBy: "seller",
      approvedAt: now,
      exactChangeAccepted: action.exactChange,
      riskAccepted: action.riskLevel,
      executionStatus: "not-executed",
      ownedEcommerceBinding: binding,
    };
  }

  it("authorizes exact owned ecommerce approval bindings", () => {
    const action = approvedOwnedEcommerceAction();
    const binding = executionBinding(action);
    const approval = approvalFor(action, binding);

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action,
          projectionId: "projection-1",
          projectionVersion: "projection-1:v1",
          target: { type: "storefront-projection", projectionId: "projection-1" },
          operation: "publish",
        },
        now,
        approval,
      ),
    ).toEqual({ allowed: true, reason: "approved" });
  });

  it("treats semantically identical targets as matching regardless of property insertion order", () => {
    const action = approvedOwnedEcommerceAction();
    const approval = approvalFor(
      action,
      executionBinding(action, {
        target: { projectionId: "projection-1", type: "storefront-projection" },
      }),
    );

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action,
          projectionId: "projection-1",
          projectionVersion: "projection-1:v1",
          target: { type: "storefront-projection", projectionId: "projection-1" },
          operation: "publish",
        },
        now,
        approval,
      ),
    ).toEqual({ allowed: true, reason: "approved" });
  });

  it("treats an approval without owned ecommerce binding as unapproved for execution", () => {
    const action = approvedOwnedEcommerceAction();
    const approval: ApprovalRecord = {
      id: "approval-no-binding",
      actionId: action.id,
      sellerId: action.sellerId,
      approvedBy: "seller",
      approvedAt: now,
      exactChangeAccepted: action.exactChange,
      riskAccepted: action.riskLevel,
      executionStatus: "not-executed",
    };

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action,
          projectionId: "projection-1",
          projectionVersion: "projection-1:v1",
          target: { type: "storefront-projection", projectionId: "projection-1" },
          operation: "publish",
        },
        now,
        approval,
      ),
    ).toEqual({ allowed: false, reason: "approval-mismatch" });
  });

  it("authorizes exact owned ecommerce approval bindings with critical risk", () => {
    const action = approvedOwnedEcommerceAction();
    const binding = executionBinding(action, { risk: "critical" });
    const approval = approvalFor(action, binding);
    approval.riskAccepted = "critical";

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action: { ...action, riskLevel: "critical" },
          projectionId: "projection-1",
          projectionVersion: "projection-1:v1",
          target: { type: "storefront-projection", projectionId: "projection-1" },
          operation: "publish",
        },
        now,
        approval,
      ),
    ).toEqual({ allowed: true, reason: "approved" });
  });

  it("blocks approvals whose owned ecommerce binding expires exactly at the evaluation moment", () => {
    const action = approvedOwnedEcommerceAction();
    const nowMs = new Date("2026-07-05T12:00:00.000Z").getTime();
    const exactNow = new Date(nowMs);

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action,
          projectionId: "projection-1",
          projectionVersion: "projection-1:v1",
          target: { type: "storefront-projection", projectionId: "projection-1" },
          operation: "publish",
        },
        exactNow,
        approvalFor(action, executionBinding(action, { expiresAt: exactNow })),
      ),
    ).toEqual({ allowed: false, reason: "expired-approval" });
  });

  it("blocks mismatched owned ecommerce approval bindings and expired approvals", () => {
    const action = approvedOwnedEcommerceAction();
    const binding = executionBinding(action);
    const expectedMismatch = { allowed: false, reason: "approval-mismatch" } as const;

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action,
          projectionId: "projection-1",
          projectionVersion: "projection-1:v1",
          target: { type: "storefront-projection", projectionId: "projection-1" },
          operation: "publish",
        },
        now,
        approvalFor(action, executionBinding(action, { actionId: "action-owned-ecommerce-other" })),
      ),
    ).toEqual(expectedMismatch);

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action,
          projectionId: "projection-1",
          projectionVersion: "projection-1:v2",
          target: { type: "storefront-projection", projectionId: "projection-1" },
          operation: "publish",
        },
        now,
        approvalFor(action, binding),
      ),
    ).toEqual(expectedMismatch);

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action,
          projectionId: "projection-2",
          projectionVersion: "projection-1:v1",
          target: { type: "storefront-projection", projectionId: "projection-1" },
          operation: "publish",
        },
        now,
        approvalFor(action, binding),
      ),
    ).toEqual(expectedMismatch);

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action,
          projectionId: "projection-1",
          projectionVersion: "projection-1:v1",
          target: { type: "storefront-projection", projectionId: "projection-2" },
          operation: "publish",
        },
        now,
        approvalFor(action, binding),
      ),
    ).toEqual(expectedMismatch);

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action,
          projectionId: "projection-1",
          projectionVersion: "projection-1:v1",
          target: { type: "storefront-projection", projectionId: "projection-1" },
          operation: "checkout-activation",
        },
        now,
        approvalFor(action, binding),
      ),
    ).toEqual(expectedMismatch);

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action,
          projectionId: "projection-1",
          projectionVersion: "projection-1:v1",
          target: { type: "storefront-projection", projectionId: "projection-1" },
          operation: "publish",
        },
        now,
        approvalFor(action, executionBinding(action, { risk: "critical" })),
      ),
    ).toEqual(expectedMismatch);

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action,
          projectionId: "projection-1",
          projectionVersion: "projection-1:v1",
          target: { type: "storefront-projection", projectionId: "projection-1" },
          operation: "publish",
        },
        now,
        approvalFor(action, executionBinding(action, { rationale: "Different rationale." })),
      ),
    ).toEqual(expectedMismatch);

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action,
          projectionId: "projection-1",
          projectionVersion: "projection-1:v1",
          target: { type: "storefront-projection", projectionId: "projection-1" },
          operation: "publish",
        },
        now,
        approvalFor(action, executionBinding(action, { expiresAt: now })),
      ),
    ).toEqual({ allowed: false, reason: "expired-approval" });

    expect(
      canExecuteOwnedEcommerceAction(
        {
          action,
          projectionId: "projection-1",
          projectionVersion: "projection-1:v1",
          target: { type: "storefront-projection", projectionId: "projection-1" },
          operation: "publish",
        },
        now,
        approvalFor(action, executionBinding(action, { expiresAt: new Date("not-a-date") })),
      ),
    ).toEqual({ allowed: false, reason: "expired-approval" });
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
    ["supplier-mirror-publish-proposal", "high"],
    ["supplier-mirror-price-proposal", "medium"],
    ["supplier-mirror-pause-listing", "high"],
    ["owned-ecommerce-publish", "high"],
    ["owned-ecommerce-checkout-activation", "critical"],
    ["owned-ecommerce-price-change", "high"],
    ["owned-ecommerce-stock-change", "high"],
  ] satisfies Array<[WriteActionKind, string]>)('labels "%s" as %s risk', (kind, risk) => {
    expect(riskLevelForAction(kind)).toBe(risk);
  });
});

describe("owned ecommerce domain contracts", () => {
  it("preserves candidate provenance and evidence identifiers", () => {
    const provenance: CandidateProvenance = {
      source: "supplier-mirror",
      sourceId: "jinpeng:XKP-001",
      supplierId: "jinpeng",
      snapshotIds: ["snapshot-1"],
      cortexNodeIds: ["node-1"],
      evidenceIds: ["evidence-supplier-1", "evidence-stock-1"],
    };

    expect(provenance.source).toBe("supplier-mirror");
    expect(provenance.evidenceIds).toContain("evidence-stock-1");
  });

  it("emits stable risk codes and fails closed for stale or incomplete evidence", () => {
    const checks = guardrailsForCandidateEvidence({
      stockFreshness: "stale",
      marginFreshness: "fresh",
      supplierFreshness: "unknown",
      completeness: "partial",
      evidenceIds: ["evidence-stale-1"],
    });

    expect(checks.map((check) => check.code)).toEqual([
      "stale-stock-evidence",
      "unknown-supplier-evidence",
      "incomplete-evidence",
    ]);
    expect(checks.every((check) => isOwnedEcommerceGuardrailCode(check.code))).toBe(true);
    expect(summarizeProjectionReadiness(checks)).toBe("blocked");
  });

  it("types owned ecommerce actions as approval-only prepared writes", () => {
    const action = createPreparedAction({
      id: "action-owned-ecommerce-publish-1",
      sellerId: "seller-1",
      kind: "owned-ecommerce-publish",
      target: { type: "storefront-projection", projectionId: "projection-1" },
      exactChange: [{ field: "status", from: "preview", to: "published" }],
      rationale: "Publish the approved storefront projection.",
      expiresAt: future,
    });

    expect(action.approvalStatus).toBe("pending");
    expect(requiresApproval(action.kind)).toBe(true);
    expect(riskLevelForAction(action.kind)).toBe("high");
  });

  it("fails closed for invalid owned ecommerce action targets", () => {
    expect(() =>
      createPreparedAction({
        id: "action-invalid-checkout-1",
        sellerId: "seller-1",
        kind: "owned-ecommerce-checkout-activation",
        target: { type: "ecommerce-catalog-item", itemRef: "jinpeng:XKP-001" },
        exactChange: [{ field: "checkout", from: false, to: true }],
        rationale: "Activate checkout for a preview.",
        expiresAt: future,
      }),
    ).toThrow(
      "Invalid target ecommerce-catalog-item for owned-ecommerce-checkout-activation: expected storefront-projection",
    );

    expect(() =>
      createPreparedAction({
        id: "action-invalid-price-1",
        sellerId: "seller-1",
        kind: "owned-ecommerce-price-change",
        target: { type: "storefront-projection", projectionId: "projection-1" },
        exactChange: [{ field: "price", from: 1000, to: 1100 }],
        rationale: "Change the projection price.",
        expiresAt: future,
      }),
    ).toThrow(
      "Invalid target storefront-projection for owned-ecommerce-price-change: expected ecommerce-catalog-item",
    );
  });

  it("accepts valid owned ecommerce action targets deterministically", () => {
    expect(
      createPreparedAction({
        id: "action-valid-checkout-1",
        sellerId: "seller-1",
        kind: "owned-ecommerce-checkout-activation",
        target: { type: "storefront-projection", projectionId: "projection-1" },
        exactChange: [{ field: "checkout", from: false, to: true }],
        rationale: "Activate checkout for an approved projection.",
        expiresAt: future,
      }).riskLevel,
    ).toBe("critical");

    expect(
      createPreparedAction({
        id: "action-valid-stock-1",
        sellerId: "seller-1",
        kind: "owned-ecommerce-stock-change",
        target: { type: "ecommerce-catalog-item", itemRef: "jinpeng:XKP-001" },
        exactChange: [{ field: "inventoryQuantity", from: 10, to: 8 }],
        rationale: "Sync inventory from authoritative evidence.",
        expiresAt: future,
      }).riskLevel,
    ).toBe("high");
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

describe("operational evidence freshness", () => {
  it("prevents stale evidence from supporting high-confidence claims", () => {
    const evidence: OperationalEvidence = {
      evidenceId: "evidence-listing-1",
      snapshotKind: "listing",
      sellerId: "seller-1",
      entityId: "MLC123",
      capturedAt: new Date("2026-06-25T12:00:00.000Z"),
      freshnessStatus: "stale",
      completeness: "complete",
      source: "operational-read-model",
    };

    expect(canMakeHighConfidenceClaimFromEvidence(evidence)).toBe(false);
    expect(confidenceForOperationalEvidence(evidence)).toBe("low");
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

describe("domain types — Listing", () => {
  it("models fulfillment and account-specific exposure strategy independently", () => {
    const listing: Listing = {
      id: "MLC123",
      sellerId: "plasticov-seller",
      title: "Organizer plástico reforzado",
      status: "active",
      price: { amount: 12990, currency: "CLP" },
      availableQuantity: 8,
      fulfillmentMode: "owned-stock",
      accountStrategy: {
        listingType: "premium",
        titleVariant: "high-exposure-storage",
        exposureGoal: "volume",
      },
      supplierSourcingRequired: false,
      updatedAt: now,
    };

    expect(listing.fulfillmentMode).toBe("owned-stock");
    expect(listing.accountStrategy?.listingType).toBe("premium");
    expect(listing.accountStrategy?.exposureGoal).toBe("volume");
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
