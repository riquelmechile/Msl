import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import type { EvidenceRequestPayload, EvidenceResponsePayload } from "@msl/domain";

import {
  createSqliteEvidenceRequestStore,
  type EvidenceRequestStore,
} from "./evidenceRequestStore.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayload(overrides: Partial<EvidenceRequestPayload> = {}): EvidenceRequestPayload {
  const ts = new Date("2026-07-10T12:00:00.000Z").toISOString();
  return {
    type: "evidence-request",
    requestId: "req-1",
    correlationId: "corr-1",
    sourceAgentId: "planner",
    targetAgentId: "cost-supplier",
    sellerId: "seller-plasticov",
    candidateId: "cand-1",
    kind: "cost-margin",
    question: "What is the landed cost for widget X?",
    reason: "pricing decision",
    priority: "high",
    evidenceIds: [],
    dedupeKey: "dedupe-1",
    createdAt: ts,
    noMutationExecuted: true,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<EvidenceResponsePayload> = {}): EvidenceResponsePayload {
  const ts = new Date("2026-07-10T12:01:00.000Z").toISOString();
  return {
    type: "evidence-response",
    responseId: "resp-1",
    requestId: "req-1",
    correlationId: "corr-1",
    sourceAgentId: "cost-supplier",
    targetAgentId: "planner",
    sellerId: "seller-plasticov",
    candidateId: "cand-1",
    status: "answered",
    answer: "Cost is $12.50/unit landed.",
    structuredEvidence: { unitCost: 12.5, currency: "USD", margin: 0.35 },
    evidenceIds: ["ev-1"],
    confidence: "high",
    blockers: [],
    warnings: [],
    createdAt: ts,
    noMutationExecuted: true,
    ...overrides,
  };
}

function createStore(): EvidenceRequestStore {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  return createSqliteEvidenceRequestStore(db);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvidenceRequestStore", () => {
  // 1
  it("enqueue persists request as queued with all fields preserved and noMutationExecuted true", () => {
    const store = createStore();
    const payload = makePayload();

    const result = store.enqueueRequest(payload);

    expect(result.status).toBe("queued");
    expect(result.request.requestId).toBe("req-1");
    expect(result.request.status as string | undefined).toBeUndefined();
    expect(result.request.noMutationExecuted).toBe(true);

    // Read back
    const fetched = store.getRequest("req-1");
    expect(fetched).not.toBeNull();
    expect(fetched!.correlationId).toBe("corr-1");
    expect(fetched!.sourceAgentId).toBe("planner");
    expect(fetched!.targetAgentId).toBe("cost-supplier");
    expect(fetched!.sellerId).toBe("seller-plasticov");
    expect(fetched!.candidateId).toBe("cand-1");
    expect(fetched!.kind).toBe("cost-margin");
    expect(fetched!.question).toBe("What is the landed cost for widget X?");
    expect(fetched!.priority).toBe("high");
    expect(fetched!.dedupeKey).toBe("dedupe-1");
    expect(fetched!.noMutationExecuted).toBe(true);
  });

  // 2
  it("claim acquires request with claimed_by and claimed_at", () => {
    const store = createStore();
    store.enqueueRequest(makePayload());

    const result = store.claimRequest("req-1", "cost-supplier");

    expect(result.success).toBe(true);
    expect(result.request).toBeDefined();
    expect(result.request!.noMutationExecuted).toBe(true);

    const fetched = store.getRequest("req-1");
    expect(fetched!.status).toBe("claimed");
  });

  // 3
  it("answer persists response with confidence and noMutationExecuted true", () => {
    const store = createStore();
    store.enqueueRequest(makePayload());
    store.claimRequest("req-1", "cost-supplier");

    const response = makeResponse({
      confidence: "medium",
      blockers: ["missing-supplier-data"],
      warnings: ["stale-cost"],
    });
    store.answerRequest(response);

    // Request should be answered
    const req = store.getRequest("req-1");
    expect(req!.status).toBe("answered");

    // Response should be persisted
    const resp = store.getResponse("resp-1");
    expect(resp).not.toBeNull();
    expect(resp!.confidence).toBe("medium");
    expect(resp!.blockers).toEqual(["missing-supplier-data"]);
    expect(resp!.warnings).toEqual(["stale-cost"]);
    expect(resp!.structuredEvidence).toEqual({ unitCost: 12.5, currency: "USD", margin: 0.35 });
    expect(resp!.noMutationExecuted).toBe(true);
    expect(resp!.answer).toBe("Cost is $12.50/unit landed.");
  });

  // 4
  it("fail transition records error", () => {
    const store = createStore();
    store.enqueueRequest(makePayload());

    store.failRequest("req-1", "Supplier mirror unavailable");

    const req = store.getRequest("req-1");
    expect(req!.status).toBe("failed");
    expect(req!.noMutationExecuted).toBe(true);
  });

  // 5
  it("expire marks unclaimable", () => {
    const store = createStore();
    const payload = makePayload({
      requestId: "req-expire",
      dedupeKey: "dedupe-expire",
      createdAt: new Date("2026-07-01T00:00:00.000Z").toISOString(),
      expiresAt: new Date("2026-07-05T00:00:00.000Z").toISOString(),
    });
    store.enqueueRequest(payload);

    store.expireOldRequests(new Date("2026-07-10T00:00:00.000Z").toISOString());

    const req = store.getRequest("req-expire");
    expect(req!.status).toBe("expired");

    // Should not be claimable after expiry
    const claim = store.claimRequest("req-expire", "cost-supplier");
    expect(claim.success).toBe(false);
  });

  // 6
  it("dedupe returns existing request ID as duplicate", () => {
    const store = createStore();
    const first = store.enqueueRequest(
      makePayload({ requestId: "req-original", dedupeKey: "same-key" }),
    );
    expect(first.status).toBe("queued");

    const second = store.enqueueRequest(
      makePayload({ requestId: "req-duplicate", dedupeKey: "same-key" }),
    );

    expect(second.status).toBe("duplicate");
    expect(second.duplicateOfRequestId).toBe("req-original");
    expect(second.request.requestId).toBe("req-original");
  });

  // 7
  it("enforces seller isolation: Plasticov requests not visible to Maustian queries", () => {
    const store = createStore();

    // Plasticov request
    store.enqueueRequest(
      makePayload({
        requestId: "req-p",
        dedupeKey: "dedupe-p",
        sellerId: "seller-plasticov",
        candidateId: "cand-p",
        targetAgentId: "supplier-manager",
      }),
    );

    // Maustian request
    store.enqueueRequest(
      makePayload({
        requestId: "req-m",
        dedupeKey: "dedupe-m",
        sellerId: "seller-maustian",
        candidateId: "cand-m",
        targetAgentId: "supplier-manager",
      }),
    );

    // Query as supplier-manager with Plasticov scope
    const plasticovPending = store.listPendingRequestsForAgent(
      "supplier-manager",
      "seller-plasticov",
    );
    expect(plasticovPending).toHaveLength(1);
    expect(plasticovPending[0]!.requestId).toBe("req-p");

    // Query as supplier-manager with Maustian scope
    const maustianPending = store.listPendingRequestsForAgent(
      "supplier-manager",
      "seller-maustian",
    );
    expect(maustianPending).toHaveLength(1);
    expect(maustianPending[0]!.requestId).toBe("req-m");

    // Query without seller scope — should see both
    const allPending = store.listPendingRequestsForAgent("supplier-manager");
    expect(allPending).toHaveLength(2);
  });

  // 8
  it("in-memory SQLite factory works", () => {
    const db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    const store = createSqliteEvidenceRequestStore(db);

    store.enqueueRequest(makePayload({ requestId: "mem-req", dedupeKey: "mem-key" }));
    const req = store.getRequest("mem-req");
    expect(req).not.toBeNull();
    expect(req!.requestId).toBe("mem-req");
  });

  // Additional coverage: summarisation
  it("summarizeEvidenceForCandidate aggregates responses correctly", () => {
    const store = createStore();

    // Request 1: answered
    store.enqueueRequest(
      makePayload({
        requestId: "req-s1",
        dedupeKey: "dedupe-s1",
        candidateId: "cand-sum",
        kind: "cost-margin",
      }),
    );
    store.claimRequest("req-s1", "cost-supplier");
    store.answerRequest(
      makeResponse({
        responseId: "resp-s1",
        requestId: "req-s1",
        candidateId: "cand-sum",
        confidence: "high",
        blockers: ["b1"],
      }),
    );

    // Request 2: answered with lower confidence
    store.enqueueRequest(
      makePayload({
        requestId: "req-s2",
        dedupeKey: "dedupe-s2",
        candidateId: "cand-sum",
        kind: "market-demand",
      }),
    );
    store.claimRequest("req-s2", "market-catalog");
    store.answerRequest(
      makeResponse({
        responseId: "resp-s2",
        requestId: "req-s2",
        candidateId: "cand-sum",
        confidence: "medium",
        blockers: ["b2"],
      }),
    );

    // Request 3: still queued
    store.enqueueRequest(
      makePayload({
        requestId: "req-s3",
        dedupeKey: "dedupe-s3",
        candidateId: "cand-sum",
        kind: "supplier-stock",
      }),
    );

    const summary = store.summarizeEvidenceForCandidate("cand-sum");
    expect(summary).not.toBeNull();
    expect(summary!.totalRequests).toBe(3);
    expect(summary!.answeredCount).toBe(2);
    expect(summary!.pendingCount).toBe(1);
    expect(summary!.failedCount).toBe(0);
    expect(summary!.overallConfidence).toBe("medium");
    expect(summary!.blockers).toEqual(["b1", "b2"]);
    expect(summary!.responses).toHaveLength(2);
  });

  // Additional coverage: findDuplicate
  it("findDuplicate returns matching request by dedupe key", () => {
    const store = createStore();
    store.enqueueRequest(makePayload({ requestId: "req-find", dedupeKey: "find-me" }));

    const found = store.findDuplicate("find-me");
    expect(found).not.toBeNull();
    expect(found!.requestId).toBe("req-find");

    const missing = store.findDuplicate("no-such-key");
    expect(missing).toBeNull();
  });

  // Additional coverage: claim failure when not queued
  it("claimRequest fails when request is not in queued status", () => {
    const store = createStore();
    store.enqueueRequest(makePayload({ requestId: "req-claim-fail", dedupeKey: "claim-fail" }));
    store.claimRequest("req-claim-fail", "cost-supplier");

    // Second claim should fail (already claimed)
    const second = store.claimRequest("req-claim-fail", "other-agent");
    expect(second.success).toBe(false);
    expect(second.reason).toContain("claimed");
  });

  // Additional coverage: link and list
  it("linkRequest associates a request with entities and listLinks returns them", () => {
    const store = createStore();
    store.enqueueRequest(makePayload({ requestId: "req-link", dedupeKey: "link-key" }));

    store.linkRequest("req-link", "candidate", "cand-1");
    store.linkRequest("req-link", "projection", "proj-1");

    const links = store.listLinks("req-link");
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.linkedEntityType).sort()).toEqual(["candidate", "projection"]);
  });
});
