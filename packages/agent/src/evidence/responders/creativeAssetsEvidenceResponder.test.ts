import { describe, expect, it } from "vitest";
import type { EvidenceKind, EvidenceRequestPayload } from "@msl/domain";
import { CreativeAssetsEvidenceResponder } from "./creativeAssetsEvidenceResponder.js";
import type { CreativeAssetsTransport } from "./creativeAssetsEvidenceResponder.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<EvidenceRequestPayload> = {}): EvidenceRequestPayload {
  return {
    type: "evidence-request",
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    correlationId: "corr-1",
    sourceAgentId: "planner",
    targetAgentId: "creative-assets",
    sellerId: "plasticov",
    candidateId: "cand-1",
    kind: "creative-assets",
    question: "Are images ready?",
    priority: "medium",
    dedupeKey: `dedupe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    evidenceIds: [],
    createdAt: new Date().toISOString(),
    noMutationExecuted: true,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("CreativeAssetsEvidenceResponder", () => {
  const healthyTransport: CreativeAssetsTransport = {
    areImagesReady: () => true,
    getImageCount: () => 5,
    getMissingImages: () => [],
    getCreativeRequestId: () => null,
    getConstraints: () => null,
  };

  it("canHandle matches creative-assets", () => {
    const responder = new CreativeAssetsEvidenceResponder(healthyTransport);
    expect(responder.canHandle(makeRequest({ kind: "creative-assets" }))).toBe(true);
  });

  it("does not handle other kinds", () => {
    const responder = new CreativeAssetsEvidenceResponder(healthyTransport);
    const kinds: EvidenceKind[] = [
      "cost-margin",
      "supplier-stock",
      "market-demand",
      "market-competition",
      "account-channel-fit",
      "claim-support",
      "unknown",
    ];
    for (const kind of kinds) {
      expect(responder.canHandle(makeRequest({ kind }))).toBe(false);
    }
  });

  it("answer returns structured evidence with high confidence when images ready", async () => {
    const responder = new CreativeAssetsEvidenceResponder(healthyTransport);
    const req = makeRequest();
    const result = await responder.answer(req);

    expect(result.status).toBe("answered");
    expect(result.sourceAgentId).toBe("creative-assets");
    expect(result.noMutationExecuted).toBe(true);
    expect(result.structuredEvidence).toMatchObject({
      imageReady: true,
      imageCount: 5,
    });
    expect(result.confidence).toBe("high");
  });

  it("returns low confidence when images are missing", async () => {
    const missingTransport: CreativeAssetsTransport = {
      areImagesReady: () => false,
      getImageCount: () => 2,
      getMissingImages: () => ["front", "side"],
      getCreativeRequestId: () => "cr-1",
      getConstraints: () => "Min resolution: 1200x1200",
    };

    const responder = new CreativeAssetsEvidenceResponder(missingTransport);
    const req = makeRequest();
    const result = await responder.answer(req);

    expect(result.status).toBe("answered");
    expect(result.confidence).toBe("low");
    expect(result.noMutationExecuted).toBe(true);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.structuredEvidence).toHaveProperty("missingImages");
  });
});
