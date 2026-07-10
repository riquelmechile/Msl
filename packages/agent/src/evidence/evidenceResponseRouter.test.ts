import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  EvidenceResponseRouter,
  type EvidenceResponder,
} from "./evidenceResponseRouter.js";
import {
  createSqliteEvidenceRequestStore,
  migrateEvidenceStore,
} from "@msl/memory";
import type {
  EvidenceKind,
  EvidenceRequestPayload,
  EvidenceResponsePayload,
  EvidenceTargetAgentId,
} from "@msl/domain";

// ── Helpers ──────────────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

function makeRequest(overrides: Partial<EvidenceRequestPayload> = {}): EvidenceRequestPayload {
  return {
    type: "evidence-request",
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    correlationId: "corr-1",
    sourceAgentId: "planner",
    targetAgentId: "cost-supplier",
    sellerId: "plasticov",
    candidateId: "cand-1",
    kind: "cost-margin",
    question: "What is the cost?",
    reason: "Need margin data",
    priority: "high",
    dedupeKey: `dedupe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    evidenceIds: [],
    createdAt: nowISO(),
    noMutationExecuted: true,
    ...overrides,
  };
}

/** Creates an in-memory SQLite store with the evidence schema. */
function createStore() {
  const db = new Database(":memory:");
  migrateEvidenceStore(db);
  return createSqliteEvidenceRequestStore(db);
}

// ── Fake responders ──────────────────────────────────────────────────

function makeFakeResponder(
  agentId: EvidenceTargetAgentId,
  kinds: EvidenceKind[],
  responseOverrides: Partial<EvidenceResponsePayload> = {},
): EvidenceResponder {
  return {
    agentId,
    canHandle(request: EvidenceRequestPayload): boolean {
      return kinds.includes(request.kind);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async answer(request: EvidenceRequestPayload): Promise<EvidenceResponsePayload> {
      return {
        type: "evidence-response",
        responseId: `er-${request.requestId}`,
        requestId: request.requestId,
        correlationId: request.correlationId,
        sourceAgentId: agentId,
        targetAgentId: request.sourceAgentId,
        ...(request.sellerId !== undefined ? { sellerId: request.sellerId } : {}),
        ...(request.candidateId !== undefined ? { candidateId: request.candidateId } : {}),
        status: "answered",
        answer: `Evidence for ${request.kind}`,
        structuredEvidence: { kind: request.kind, result: "ok" },
        evidenceIds: [`ev-${request.requestId}`],
        confidence: "high",
        blockers: [],
        warnings: [],
        createdAt: nowISO(),
        noMutationExecuted: true,
        ...responseOverrides,
      };
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("EvidenceResponseRouter", () => {
  describe("processRequest — delegate to correct responder", () => {
    it("delegates cost-margin → CostSupplier → answered", async () => {
      const store = createStore();
      const req = makeRequest({ kind: "cost-margin", targetAgentId: "cost-supplier" });
      store.enqueueRequest(req);

      const router = new EvidenceResponseRouter({ evidenceRequestStore: store });
      const costSupplier = makeFakeResponder("cost-supplier", ["cost-margin"]);
      router.registerResponder(costSupplier);

      const response = await router.processRequest(req.requestId);

      expect(response.status).toBe("answered");
      expect(response.confidence).toBe("high");
      expect(response.sourceAgentId).toBe("cost-supplier");
      expect(response.requestId).toBe(req.requestId);
      expect(response.noMutationExecuted).toBe(true);
    });
  });

  describe("processRequest — unsupported kind", () => {
    it("marks unsupported when no responder handles the kind", async () => {
      const store = createStore();
      const req = makeRequest({ kind: "unknown", targetAgentId: "unknown" as EvidenceTargetAgentId });
      // Pretend "unknown" target agent for pending lookup; enqueue it as queued
      // Hack: manually insert so it's queued for our fake targetAgentId
      (req as Record<string, unknown>).targetAgentId = "unknown";
      store.enqueueRequest({
        ...req,
        targetAgentId: "unknown" as EvidenceTargetAgentId,
        kind: "unknown",
      });

      const router = new EvidenceResponseRouter({ evidenceRequestStore: store });
      // Register a responder that does NOT match "unknown"
      const costSupplier = makeFakeResponder("cost-supplier", ["cost-margin"]);
      router.registerResponder(costSupplier);

      const response = await router.processRequest(req.requestId);

      expect(response.status).toBe("unsupported");
      expect(response.noMutationExecuted).toBe(true);

      // Verify store state
      const stored = store.getRequest(req.requestId);
      expect(stored?.status).toBe("answered"); // answerRequest called with unsupported response

      // Check the response was stored
      const resp = store.getResponse(response.responseId);
      expect(resp?.status).toBe("unsupported");
    });
  });

  describe("processRequest — responder throws → failed", () => {
    it("transitions to failed and stores error evidence when responder throws", async () => {
      const store = createStore();
      const req = makeRequest({ kind: "cost-margin", targetAgentId: "cost-supplier" });
      store.enqueueRequest(req);

      const router = new EvidenceResponseRouter({ evidenceRequestStore: store });
      const throwingResponder: EvidenceResponder = {
        agentId: "cost-supplier",
        canHandle() {
          return true;
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        async answer() {
          throw new Error("Simulated respond error");
        },
      };
      router.registerResponder(throwingResponder);

      const response = await router.processRequest(req.requestId);

      expect(response.status).toBe("failed");
      expect(response.blockers[0]).toContain("Simulated respond error");
      expect(response.structuredEvidence).toHaveProperty("error");
      expect(response.noMutationExecuted).toBe(true);

      // Store should show failed
      const stored = store.getRequest(req.requestId);
      expect(stored?.status).toBe("failed");
    });
  });

  describe("registerResponder wiring + canHandle dispatch", () => {
    it("dispatches based on canHandle, not just targetAgentId", async () => {
      const store = createStore();
      // Request kind is "market-demand" but targetAgentId says "cost-supplier" — wrong
      const req = makeRequest({
        kind: "market-demand",
        targetAgentId: "cost-supplier",
      });
      store.enqueueRequest(req);

      const router = new EvidenceResponseRouter({ evidenceRequestStore: store });

      const costSupplier = makeFakeResponder("cost-supplier", ["cost-margin"]);
      const marketCatalog = makeFakeResponder("market-catalog", [
        "market-demand",
        "market-competition",
        "listing-performance",
      ]);

      router.registerResponder(costSupplier);
      router.registerResponder(marketCatalog);

      const response = await router.processRequest(req.requestId);

      // Should be handled by market-catalog because canHandle matches
      expect(response.status).toBe("answered");
      expect(response.sourceAgentId).toBe("market-catalog");
      expect(response.noMutationExecuted).toBe(true);
    });

    it("returns unsupported when no registered responder canHandle", async () => {
      const store = createStore();
      const req = makeRequest({
        kind: "claim-support",
        targetAgentId: "account-brain",
      });
      store.enqueueRequest(req);

      const router = new EvidenceResponseRouter({ evidenceRequestStore: store });
      // No responders registered

      const response = await router.processRequest(req.requestId);

      expect(response.status).toBe("unsupported");
      expect(response.noMutationExecuted).toBe(true);
    });
  });
});
