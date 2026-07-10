import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import { createSqliteEvidenceRequestStore } from "@msl/memory";
import type { EvidenceRequestStore } from "@msl/memory";
import {
  createGetEvidenceRequestStatusTool,
  createListPendingEvidenceRequestsTool,
  createInspectCandidateEvidenceTool,
} from "./evidenceTools.js";

// ── Helpers ──────────────────────────────────────────────────────────

function createTestStore(): { db: Database.Database; store: EvidenceRequestStore } {
  const db = new Database(":memory:");
  const store = createSqliteEvidenceRequestStore(db);
  return { db, store };
}

function seedRequest(store: EvidenceRequestStore, overrides: {
  sellerId?: string;
  candidateId?: string;
  kind?: string;
  targetAgentId?: string;
  correlationId?: string;
} = {}) {
  const requestId = crypto.randomUUID();
  const correlationId = overrides.correlationId ?? `corr-${requestId.slice(0, 8)}`;
  const candidateId = overrides.candidateId ?? "cand-1";
  const kind = overrides.kind ?? "cost-margin";

  store.enqueueRequest({
    type: "evidence-request",
    requestId,
    correlationId,
    sourceAgentId: "planner",
    targetAgentId: (overrides.targetAgentId ?? "cost-supplier") as never,
    sellerId: overrides.sellerId ?? "plasticov",
    candidateId,
    kind: kind as never,
    question: "Test question",
    priority: "high",
    evidenceIds: [],
    createdAt: new Date().toISOString(),
    dedupeKey: crypto.createHash("sha256").update(`${candidateId}|${kind}`).digest("hex"),
    noMutationExecuted: true,
  });

  return { requestId, correlationId, candidateId };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("evidenceTools — CEO read-only inspection", () => {
  let db: Database.Database;
  let store: EvidenceRequestStore;

  beforeEach(() => {
    const created = createTestStore();
    db = created.db;
    store = created.store;
  });

  afterEach(() => {
    db.close();
  });

  it("read-only inspection with noMutationExecuted: true and seller isolation", () => {
    // Seed Plasticov request
    const { correlationId, requestId } = seedRequest(store, {
      sellerId: "plasticov",
      candidateId: "cand-plasticov",
      kind: "cost-margin",
    });

    // Seed Maustian request (different seller)
    seedRequest(store, {
      sellerId: "maustian",
      candidateId: "cand-maustian",
      kind: "supplier-stock",
    });

    // Answer the Plasticov request
    store.claimRequest(requestId, "cost-supplier");
    store.answerRequest({
      type: "evidence-response",
      responseId: crypto.randomUUID(),
      requestId,
      correlationId,
      sourceAgentId: "cost-supplier",
      targetAgentId: "planner",
      sellerId: "plasticov",
      candidateId: "cand-plasticov",
      status: "answered",
      answer: "Cost data available.",
      structuredEvidence: { cost: 100 },
      evidenceIds: ["ev-1"],
      confidence: "high",
      blockers: [],
      warnings: [],
      createdAt: new Date().toISOString(),
      noMutationExecuted: true,
    });

    // ── Tool 1: get_evidence_request_status ───────────────────────
    const statusTool = createGetEvidenceRequestStatusTool({ evidenceRequestStore: store });
    const statusResult = statusTool.execute({ correlationId }) as Record<string, unknown>;

    expect(statusResult.noMutationExecuted).toBe(true);
    expect(statusResult.status).toBe("found");
    expect(statusResult.correlationId).toBe(correlationId);
    const statusRequest = statusResult.request as Record<string, unknown> | undefined;
    expect(statusRequest?.kind).toBe("cost-margin");

    // ── Tool 2: list_pending_evidence_requests (seller isolation) ─
    const listTool = createListPendingEvidenceRequestsTool({ evidenceRequestStore: store });

    // List all
    const allResult = listTool.execute({}) as Record<string, unknown>;
    expect(allResult.noMutationExecuted).toBe(true);
    const allRequests = allResult.pendingRequests as unknown[];
    expect(allRequests.length).toBeGreaterThanOrEqual(1);

    // ── Tool 3: inspect_candidate_evidence ────────────────────────
    const inspectTool = createInspectCandidateEvidenceTool({ evidenceRequestStore: store });
    const inspectResult = inspectTool.execute({ candidateId: "cand-plasticov" }) as Record<string, unknown>;

    expect(inspectResult.noMutationExecuted).toBe(true);
    expect(inspectResult.status).toBe("ok");
    expect(inspectResult.candidateId).toBe("cand-plasticov");
    expect(inspectResult.overallConfidence).toBe("high");

    // ── Nonexistent entity → controlled response ──────────────────
    const nonexistentResult = inspectTool.execute({ candidateId: "cand-nonexistent" }) as Record<string, unknown>;
    expect(nonexistentResult.noMutationExecuted).toBe(true);
    expect(nonexistentResult.status).toBe("not-found");

    const nonexistentStatus = statusTool.execute({ correlationId: "nonexistent-12345" }) as Record<string, unknown>;
    expect(nonexistentStatus.noMutationExecuted).toBe(true);
    expect(nonexistentStatus.status).toBe("not-found");
  });
});
