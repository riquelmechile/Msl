import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import { createSqliteEvidenceRequestStore } from "@msl/memory";
import type { EvidenceRequestStore } from "@msl/memory";
import { OwnedEcommerceEvidenceAggregator } from "./ownedEcommerceEvidenceAggregator.js";
import type {
  EvidenceRequestPayload,
  EvidenceResponsePayload,
  StorefrontCandidate,
} from "@msl/domain";

// ── Helpers ──────────────────────────────────────────────────────────

function uniqueKindKey(candidateId: string, kind: string): string {
  return crypto.createHash("sha256").update(`${candidateId}|${kind}`).digest("hex");
}

function makeRequest(overrides: Partial<EvidenceRequestPayload> = {}): EvidenceRequestPayload {
  const id = overrides.requestId ?? crypto.randomUUID();
  const candidateId = overrides.candidateId ?? "cand-1";
  const kind = overrides.kind ?? "cost-margin";
  return {
    type: "evidence-request",
    requestId: id,
    correlationId: overrides.correlationId ?? `corr-${id.slice(0, 8)}`,
    sourceAgentId: overrides.sourceAgentId ?? "planner",
    targetAgentId: overrides.targetAgentId ?? "cost-supplier",
    ...(overrides.sellerId !== undefined ? { sellerId: overrides.sellerId } : { sellerId: "plasticov" }),
    candidateId,
    kind,
    question: overrides.question ?? "What is the cost?",
    priority: overrides.priority ?? "high",
    evidenceIds: overrides.evidenceIds ?? [],
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    dedupeKey: overrides.dedupeKey ?? uniqueKindKey(candidateId, kind),
    noMutationExecuted: true,
    ...(overrides.expiresAt !== undefined ? { expiresAt: overrides.expiresAt } : {}),
  };
}

function makeResponse(
  request: EvidenceRequestPayload,
  overrides: Partial<EvidenceResponsePayload> = {},
): EvidenceResponsePayload {
  return {
    type: "evidence-response",
    responseId: overrides.responseId ?? crypto.randomUUID(),
    requestId: request.requestId,
    correlationId: request.correlationId,
    sourceAgentId: overrides.sourceAgentId ?? request.targetAgentId,
    targetAgentId: overrides.targetAgentId ?? request.sourceAgentId,
    ...(request.sellerId !== undefined ? { sellerId: request.sellerId } : {}),
    ...(request.candidateId !== undefined ? { candidateId: request.candidateId } : {}),
    status: overrides.status ?? "answered",
    answer: overrides.answer ?? "Evidence found.",
    structuredEvidence: overrides.structuredEvidence ?? {},
    evidenceIds: overrides.evidenceIds ?? [`ev-${request.requestId}`],
    confidence: overrides.confidence ?? "high",
    blockers: overrides.blockers ?? [],
    warnings: overrides.warnings ?? [],
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    noMutationExecuted: true,
  };
}

function makeCandidate(overrides: Partial<StorefrontCandidate> = {}): StorefrontCandidate {
  return {
    id: overrides.id ?? "cand-1",
    itemRef: overrides.itemRef ?? "ref-1",
    title: overrides.title ?? "Test Candidate",
    provenance: overrides.provenance ?? {
      source: "supplier-mirror",
      sourceId: "src-1",
      snapshotIds: [],
      evidenceIds: [],
    },
    evidenceIds: overrides.evidenceIds ?? [],
    evidenceState: overrides.evidenceState ?? {
      stockFreshness: "unknown",
      marginFreshness: "unknown",
      supplierFreshness: "unknown",
      completeness: "partial",
      evidenceIds: [],
    },
    stock: overrides.stock ?? { status: "unknown", authority: "unknown" },
    blockedReasons: overrides.blockedReasons ?? [],
    redactedReasons: overrides.redactedReasons ?? [],
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

function createTestStore(): { db: Database.Database; store: EvidenceRequestStore } {
  const db = new Database(":memory:");
  const store = createSqliteEvidenceRequestStore(db);
  return { db, store };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("OwnedEcommerceEvidenceAggregator", () => {
  let db: Database.Database;
  let store: EvidenceRequestStore;
  let aggregator: OwnedEcommerceEvidenceAggregator;

  beforeEach(() => {
    const created = createTestStore();
    db = created.db;
    store = created.store;
    aggregator = new OwnedEcommerceEvidenceAggregator({ evidenceRequestStore: store });
  });

  afterEach(() => {
    db.close();
  });

  // ── Test 1: Joins responses with min confidence ──────────────────

  it("joins responses with min confidence (high+medium+high → medium)", async () => {
    const req1 = makeRequest({ candidateId: "cand-1", kind: "cost-margin" });
    const req2 = makeRequest({ candidateId: "cand-1", kind: "market-demand" });
    const req3 = makeRequest({ candidateId: "cand-1", kind: "creative-assets" });

    store.enqueueRequest(req1);
    store.enqueueRequest(req2);
    store.enqueueRequest(req3);

    store.claimRequest(req1.requestId, "cost-supplier");
    store.claimRequest(req2.requestId, "market-catalog");
    store.claimRequest(req3.requestId, "creative-assets");

    store.answerRequest(makeResponse(req1, { confidence: "high" }));
    store.answerRequest(makeResponse(req2, { confidence: "medium" }));
    store.answerRequest(makeResponse(req3, { confidence: "high" }));

    const summary = await aggregator.aggregateCandidateEvidence("cand-1");

    expect(summary.responses).toHaveLength(3);
    expect(summary.answeredCount).toBe(3);
    expect(summary.pendingCount).toBe(0);
    expect(summary.overallConfidence).toBe("medium");
  });

  // ── Test 2: Missing kind → waiting_for_evidence ──────────────────

  it("missing kind → waiting_for_evidence", async () => {
    // Candidate with no evidence requests at all
    const readiness = await aggregator.checkReadiness("cand-nonexistent");
    expect(readiness).toBe("waiting_for_evidence");
  });

  // ── Test 3: Expired response → confidence downgrade + blocker ────

  it("expired response → confidence downgrade + blocker listed", async () => {
    // Create an expired request + an answered request for the same candidate
    const expiredReq = makeRequest({
      candidateId: "cand-expired",
      kind: "cost-margin",
      expiresAt: new Date(Date.now() - 3600_000).toISOString(), // 1 hour ago
    });
    store.enqueueRequest(expiredReq);

    // Also create a valid answered request
    const okReq = makeRequest({
      candidateId: "cand-expired",
      kind: "market-demand",
    });
    store.enqueueRequest(okReq);
    store.claimRequest(okReq.requestId, "market-catalog");
    store.answerRequest(makeResponse(okReq, { confidence: "high" }));

    // Expire old requests
    store.expireOldRequests(new Date().toISOString());

    const summary = await aggregator.aggregateCandidateEvidence("cand-expired");

    // Expired counted in failedCount
    expect(summary.failedCount).toBe(1);
    expect(summary.answeredCount).toBe(1);
    expect(summary.totalRequests).toBe(2);

    // Readiness: expired in failedCount → blocked
    const readiness = await aggregator.checkReadiness("cand-expired");
    expect(readiness).toBe("blocked");
  });

  // ── Test 4: applyEvidenceResponsesToCandidate enriches candidate ─

  it("enriches candidate with evidence response IDs", async () => {
    const candidate = makeCandidate({ id: "cand-4" });

    const req = makeRequest({ candidateId: "cand-4", kind: "cost-margin" });
    store.enqueueRequest(req);
    store.claimRequest(req.requestId, "cost-supplier");
    store.answerRequest(makeResponse(req, {
      confidence: "high",
      evidenceIds: ["ev-cost-1", "ev-cost-2"],
      blockers: [],
    }));

    const enriched = await aggregator.applyEvidenceResponsesToCandidate(candidate);

    expect(enriched.evidenceIds).toContain("ev-cost-1");
    expect(enriched.evidenceIds).toContain("ev-cost-2");
    expect(enriched.evidenceState.completeness).toBe("complete");
  });
});
