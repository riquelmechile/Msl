import { describe, expect, it } from "vitest";
import type { EvidenceKind, EvidenceRequestPayload } from "@msl/domain";
import { SupplierManagerEvidenceResponder } from "./supplierManagerEvidenceResponder.js";
import type { SupplierManagerTransport } from "./supplierManagerEvidenceResponder.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<EvidenceRequestPayload> = {}): EvidenceRequestPayload {
  return {
    type: "evidence-request",
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    correlationId: "corr-1",
    sourceAgentId: "planner",
    targetAgentId: "supplier-manager",
    sellerId: "plasticov",
    candidateId: "cand-1",
    supplierId: "sup-1",
    supplierItemId: "si-1",
    kind: "supplier-stock",
    question: "Is stock available?",
    priority: "high",
    dedupeKey: `dedupe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    evidenceIds: [],
    createdAt: new Date().toISOString(),
    noMutationExecuted: true,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("SupplierManagerEvidenceResponder", () => {
  const healthyTransport: SupplierManagerTransport = {
    getLastSeenAt: () => "2026-07-10T10:00:00Z",
    getPriceFreshness: () => "fresh",
    getStockFreshness: () => "fresh",
    getReliability: () => 0.92,
  };

  it("canHandle matches supplier-stock and supplier-freshness", () => {
    const responder = new SupplierManagerEvidenceResponder(healthyTransport);
    expect(responder.canHandle(makeRequest({ kind: "supplier-stock" }))).toBe(true);
    expect(responder.canHandle(makeRequest({ kind: "supplier-freshness" }))).toBe(true);
  });

  it("does not handle other kinds", () => {
    const responder = new SupplierManagerEvidenceResponder(healthyTransport);
    const kinds: EvidenceKind[] = [
      "cost-margin",
      "market-demand",
      "market-competition",
      "creative-assets",
      "account-channel-fit",
      "claim-support",
      "unknown",
    ];
    for (const kind of kinds) {
      expect(responder.canHandle(makeRequest({ kind }))).toBe(false);
    }
  });

  it("answer returns structured evidence with high confidence when fresh", async () => {
    const responder = new SupplierManagerEvidenceResponder(healthyTransport);
    const req = makeRequest({ kind: "supplier-stock" });
    const result = await responder.answer(req);

    expect(result.status).toBe("answered");
    expect(result.sourceAgentId).toBe("supplier-manager");
    expect(result.noMutationExecuted).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.structuredEvidence).toHaveProperty("supplierId");
    expect(result.structuredEvidence).toHaveProperty("lastSeenAt");
    expect(result.structuredEvidence).toHaveProperty("reliability");
  });

  it("returns low confidence when supplier data is missing", async () => {
    const emptyTransport: SupplierManagerTransport = {
      getLastSeenAt: () => null,
      getPriceFreshness: () => null,
      getStockFreshness: () => null,
      getReliability: () => null,
    };

    const responder = new SupplierManagerEvidenceResponder(emptyTransport);
    const req = makeRequest();
    const result = await responder.answer(req);

    expect(result.confidence).toBe("low");
    expect(result.noMutationExecuted).toBe(true);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("handles supplier-freshness kind", async () => {
    const responder = new SupplierManagerEvidenceResponder(healthyTransport);
    const req = makeRequest({ kind: "supplier-freshness" });
    const result = await responder.answer(req);

    expect(result.status).toBe("answered");
    expect(result.noMutationExecuted).toBe(true);
    expect(result.answer).toContain("freshness");
  });
});
