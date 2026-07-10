import { describe, expect, it } from "vitest";
import type { EvidenceKind, EvidenceRequestPayload } from "@msl/domain";
import { AccountBrainEvidenceResponder } from "./accountBrainEvidenceResponder.js";
import type { AccountBrainTransport } from "./accountBrainEvidenceResponder.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<EvidenceRequestPayload> = {}): EvidenceRequestPayload {
  return {
    type: "evidence-request",
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    correlationId: "corr-1",
    sourceAgentId: "planner",
    targetAgentId: "account-brain",
    sellerId: "plasticov",
    candidateId: "cand-1",
    kind: "account-channel-fit",
    question: "Which account?",
    priority: "medium",
    dedupeKey: `dedupe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    evidenceIds: [],
    createdAt: new Date().toISOString(),
    noMutationExecuted: true,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("AccountBrainEvidenceResponder", () => {
  const healthyTransport: AccountBrainTransport = {
    rankAccounts: () => [
      {
        sellerId: "plasticov",
        accountName: "Plasticov Oficial",
        reputationScore: 95,
        channelFitScore: 88,
        claimHistoryScore: 92,
      },
      {
        sellerId: "maustian",
        accountName: "Maustian Store",
        reputationScore: 80,
        channelFitScore: 75,
        claimHistoryScore: 85,
      },
    ],
    getDecisionLogic: () => "Reputation-weighted channel fit with claim history penalty.",
  };

  it("canHandle matches account-channel-fit and claim-support", () => {
    const responder = new AccountBrainEvidenceResponder(healthyTransport);
    expect(responder.canHandle(makeRequest({ kind: "account-channel-fit" }))).toBe(true);
    expect(responder.canHandle(makeRequest({ kind: "claim-support" }))).toBe(true);
  });

  it("does not handle other kinds", () => {
    const responder = new AccountBrainEvidenceResponder(healthyTransport);
    const kinds: EvidenceKind[] = [
      "cost-margin",
      "supplier-stock",
      "market-demand",
      "market-competition",
      "creative-assets",
      "unknown",
    ];
    for (const kind of kinds) {
      expect(responder.canHandle(makeRequest({ kind }))).toBe(false);
    }
  });

  it("answer returns structured evidence with confidence, noMutationExecuted: true", async () => {
    const responder = new AccountBrainEvidenceResponder(healthyTransport);
    const req = makeRequest({ kind: "account-channel-fit" });
    const result = await responder.answer(req);

    expect(result.status).toBe("answered");
    expect(result.sourceAgentId).toBe("account-brain");
    expect(result.noMutationExecuted).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.structuredEvidence).toHaveProperty("recommendedSellerId");
    expect(result.structuredEvidence).toHaveProperty("ranking");
    expect(result.structuredEvidence).toHaveProperty("decisionLogic");
  });

  it("handles claim-support kind with claim-specific answer", async () => {
    const responder = new AccountBrainEvidenceResponder(healthyTransport);
    const req = makeRequest({ kind: "claim-support" });
    const result = await responder.answer(req);

    expect(result.status).toBe("answered");
    expect(result.answer).toContain("claim support");
    expect(result.noMutationExecuted).toBe(true);
  });
});
