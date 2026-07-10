import { describe, expect, it } from "vitest";
import type { EvidenceKind, EvidenceRequestPayload } from "@msl/domain";
import { MarketCatalogEvidenceResponder } from "./marketCatalogEvidenceResponder.js";
import type { MarketCatalogTransport } from "./marketCatalogEvidenceResponder.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<EvidenceRequestPayload> = {}): EvidenceRequestPayload {
  return {
    type: "evidence-request",
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    correlationId: "corr-1",
    sourceAgentId: "planner",
    targetAgentId: "market-catalog",
    sellerId: "plasticov",
    candidateId: "cand-1",
    category: "MLA1234",
    kind: "market-demand",
    question: "What is the demand?",
    priority: "medium",
    dedupeKey: `dedupe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    evidenceIds: [],
    createdAt: new Date().toISOString(),
    noMutationExecuted: true,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("MarketCatalogEvidenceResponder", () => {
  const healthyTransport: MarketCatalogTransport = {
    getDemandSignal: () => 75,
    getCompetitorCount: () => 12,
    getAverageObservedPrice: () => 7500,
    getPriceRange: () => ({ min: 5000, max: 12000 }),
    getListingPerformance: () => ({ views: 1500, conversionRate: 0.03, salesVelocity: 5 }),
  };

  it("canHandle matches market-demand, market-competition, listing-performance", () => {
    const responder = new MarketCatalogEvidenceResponder(healthyTransport);
    expect(responder.canHandle(makeRequest({ kind: "market-demand" }))).toBe(true);
    expect(responder.canHandle(makeRequest({ kind: "market-competition" }))).toBe(true);
    expect(responder.canHandle(makeRequest({ kind: "listing-performance" }))).toBe(true);
  });

  it("does not handle other kinds", () => {
    const responder = new MarketCatalogEvidenceResponder(healthyTransport);
    const kinds: EvidenceKind[] = [
      "cost-margin",
      "supplier-stock",
      "creative-assets",
      "account-channel-fit",
      "claim-support",
      "unknown",
    ];
    for (const kind of kinds) {
      expect(responder.canHandle(makeRequest({ kind }))).toBe(false);
    }
  });

  it("answer returns structured evidence with confidence, noMutationExecuted: true", async () => {
    const responder = new MarketCatalogEvidenceResponder(healthyTransport);
    const req = makeRequest({ kind: "market-demand" });
    const result = await responder.answer(req);

    expect(result.status).toBe("answered");
    expect(result.sourceAgentId).toBe("market-catalog");
    expect(result.noMutationExecuted).toBe(true);
    expect(result.structuredEvidence).toHaveProperty("demandSignal");
    expect(result.structuredEvidence).toHaveProperty("competitorCount");
    expect(result.confidence).toBe("high");
  });

  it("handles listing-performance kind", async () => {
    const responder = new MarketCatalogEvidenceResponder(healthyTransport);
    const req = makeRequest({ kind: "listing-performance" });
    const result = await responder.answer(req);

    expect(result.status).toBe("answered");
    expect(result.noMutationExecuted).toBe(true);
    expect(result.structuredEvidence).toHaveProperty("listingPerformance");
  });
});
