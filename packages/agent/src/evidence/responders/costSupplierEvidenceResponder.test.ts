import { describe, expect, it } from "vitest";
import type { EvidenceKind, EvidenceRequestPayload } from "@msl/domain";
import { CostSupplierEvidenceResponder } from "./costSupplierEvidenceResponder.js";
import type { CostSupplierTransport } from "./costSupplierEvidenceResponder.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<EvidenceRequestPayload> = {}): EvidenceRequestPayload {
  return {
    type: "evidence-request",
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    correlationId: "corr-1",
    sourceAgentId: "planner",
    targetAgentId: "cost-supplier",
    sellerId: "plasticov",
    candidateId: "cand-1",
    supplierId: "sup-1",
    supplierItemId: "si-1",
    kind: "cost-margin",
    question: "What is the cost?",
    priority: "high",
    dedupeKey: `dedupe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    evidenceIds: [],
    createdAt: new Date().toISOString(),
    noMutationExecuted: true,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("CostSupplierEvidenceResponder", () => {
  const healthyTransport: CostSupplierTransport = {
    isCostKnown: () => true,
    getEstimatedCost: () => 4500,
    getSuggestedPrice: () => 8000,
    getMarginPct: () => 0.44,
    isStockKnown: () => true,
    getStockAvailable: () => 120,
    getSupplierFreshness: () => "fresh",
  };

  it("canHandle matches cost-margin", () => {
    const responder = new CostSupplierEvidenceResponder(healthyTransport);
    const req = makeRequest({ kind: "cost-margin" });
    expect(responder.canHandle(req)).toBe(true);
  });

  it("does not handle other kinds", () => {
    const responder = new CostSupplierEvidenceResponder(healthyTransport);
    const kinds: EvidenceKind[] = [
      "supplier-stock",
      "market-demand",
      "creative-assets",
      "account-channel-fit",
      "claim-support",
      "unknown",
    ];
    for (const kind of kinds) {
      expect(responder.canHandle(makeRequest({ kind }))).toBe(false);
    }
  });

  it("answer returns structured evidence with confidence and noMutationExecuted: true", async () => {
    const responder = new CostSupplierEvidenceResponder(healthyTransport);
    const req = makeRequest();

    const result = await responder.answer(req);

    expect(result.type).toBe("evidence-response");
    expect(result.status).toBe("answered");
    expect(result.sourceAgentId).toBe("cost-supplier");
    expect(result.noMutationExecuted).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.structuredEvidence).toMatchObject({
      costKnown: true,
      estimatedCost: 4500,
      stockKnown: true,
    });
  });

  it("returns low confidence when no cost data available", async () => {
    const emptyTransport: CostSupplierTransport = {
      isCostKnown: () => false,
      getEstimatedCost: () => null,
      getSuggestedPrice: () => null,
      getMarginPct: () => null,
      isStockKnown: () => false,
      getStockAvailable: () => null,
      getSupplierFreshness: () => null,
    };

    const responder = new CostSupplierEvidenceResponder(emptyTransport);
    const req = makeRequest();
    const result = await responder.answer(req);

    expect(result.confidence).toBe("low");
    expect(result.noMutationExecuted).toBe(true);
    expect(result.blockers.length).toBeGreaterThan(0);
  });
});
