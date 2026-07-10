import type { EvidenceRequestStore } from "@msl/memory";
import type { ToolDefinition } from "./types.js";
import { safeString } from "./types.js";

// ── Tool options ──────────────────────────────────────────────────────

export type EvidenceToolsOptions = {
  evidenceRequestStore: EvidenceRequestStore;
};

// ── Tool: get_evidence_request_status ─────────────────────────────────

/**
 * Query the status of a single evidence request by its correlation ID.
 * Returns status, responder agent, confidence, and response payload.
 * Read-only — `noMutationExecuted: true`.
 */
export function createGetEvidenceRequestStatusTool(options: EvidenceToolsOptions): ToolDefinition {
  const store = options.evidenceRequestStore;

  return {
    name: "get_evidence_request_status",
    description:
      "Query the status of an evidence request by correlationId. Returns status, responder, confidence, and response payload. Read-only.",
    parameters: {
      type: "object",
      properties: {
        correlationId: { type: "string", description: "Correlation ID of the evidence request" },
      },
      required: ["correlationId"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const correlationId = safeString(args.correlationId);

      if (!correlationId) {
        return {
          status: "invalid-input",
          error: "correlationId is required",
          noMutationExecuted: true,
        };
      }

      // 1. Try finding responses by correlationId
      const responses = store.listResponsesForCorrelation(correlationId);

      // 2. Extract request info from the first response's requestId
      const requestFromResponse =
        responses.length > 0 ? store.getRequest(responses[0]!.requestId) : null;

      // 3. If no responses and no request, try scanning pending requests across agents
      let request = requestFromResponse;
      if (!request) {
        const agentIds: string[] = [
          "cost-supplier",
          "market-catalog",
          "creative-assets",
          "account-brain",
          "supplier-manager",
        ];
        for (const agentId of agentIds) {
          const pending = store.listPendingRequestsForAgent(agentId as never, undefined, 200);
          const match = pending.find((r) => r.correlationId === correlationId);
          if (match) {
            request = match;
            break;
          }
        }
      }

      if (!request && responses.length === 0) {
        return {
          status: "not-found",
          message: `No evidence request or response found for correlationId: ${correlationId}`,
          correlationId,
          noMutationExecuted: true,
        };
      }

      const result: Record<string, unknown> = {
        status: "found",
        correlationId,
        noMutationExecuted: true,
      };

      if (request) {
        result.request = {
          requestId: request.requestId,
          kind: request.kind,
          targetAgentId: request.targetAgentId,
          question: request.question,
          priority: request.priority,
          requestStatus: request.status ?? "queued",
          createdAt: request.createdAt,
        };
      }

      if (responses.length > 0) {
        result.responses = responses.map((r) => ({
          responseId: r.responseId,
          sourceAgentId: r.sourceAgentId,
          status: r.status,
          confidence: r.confidence,
          answer: r.answer,
          blockers: r.blockers,
          warnings: r.warnings,
          createdAt: r.createdAt,
        }));
      }

      return result;
    },
  };
}

// ── Tool: list_pending_evidence_requests ──────────────────────────────

/**
 * List all pending (queued or claimed) evidence requests, optionally
 * scoped by seller ID. Returns kind, priority, and age.
 * Read-only — `noMutationExecuted: true`.
 */
export function createListPendingEvidenceRequestsTool(
  options: EvidenceToolsOptions,
): ToolDefinition {
  const store = options.evidenceRequestStore;

  return {
    name: "list_pending_evidence_requests",
    description:
      "List pending (queued or claimed) evidence requests, optionally scoped by sellerId. Returns kind, priority, and age. Read-only.",
    parameters: {
      type: "object",
      properties: {
        sellerId: { type: "string", description: "Optional seller ID to filter requests" },
      },
      required: [],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const sellerId = safeString(args.sellerId) || undefined;

      // Collect pending requests across all known agent types
      const agentIds: string[] = [
        "cost-supplier",
        "market-catalog",
        "creative-assets",
        "account-brain",
        "supplier-manager",
      ];

      const allPending: Record<string, unknown>[] = [];

      for (const agentId of agentIds) {
        const pending = store.listPendingRequestsForAgent(agentId as never, sellerId, 50);

        for (const req of pending) {
          const now = new Date().getTime();
          const created = new Date(req.createdAt).getTime();
          const ageMinutes = Math.round((now - created) / 60000);

          allPending.push({
            requestId: req.requestId,
            correlationId: req.correlationId,
            kind: req.kind,
            targetAgentId: req.targetAgentId,
            candidateId: req.candidateId,
            sellerId: req.sellerId,
            priority: req.priority,
            status: req.status,
            ageMinutes,
            createdAt: req.createdAt,
          });
        }
      }

      return {
        status: "ok",
        pendingRequests: allPending,
        count: allPending.length,
        noMutationExecuted: true,
      };
    },
  };
}

// ── Tool: inspect_candidate_evidence ──────────────────────────────────

/**
 * Inspect aggregated evidence for a candidate. Shows confidence,
 * blockers, readiness, and per-kind response summaries.
 * Read-only — `noMutationExecuted: true`.
 */
export function createInspectCandidateEvidenceTool(options: EvidenceToolsOptions): ToolDefinition {
  const store = options.evidenceRequestStore;

  return {
    name: "inspect_candidate_evidence",
    description:
      "Show aggregated evidence responses for a candidate. Returns confidence, blockers, readiness, and per-kind response summaries. Read-only.",
    parameters: {
      type: "object",
      properties: {
        candidateId: { type: "string", description: "Candidate ID to inspect" },
      },
      required: ["candidateId"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const candidateId = safeString(args.candidateId);

      if (!candidateId) {
        return {
          status: "invalid-input",
          error: "candidateId is required",
          noMutationExecuted: true,
        };
      }

      const summary = store.summarizeEvidenceForCandidate(candidateId);

      if (!summary) {
        return {
          status: "not-found",
          message: `No evidence found for candidate: ${candidateId}`,
          candidateId,
          noMutationExecuted: true,
        };
      }

      const readiness =
        summary.pendingCount > 0
          ? "waiting_for_evidence"
          : summary.failedCount > 0
            ? "blocked"
            : "ready";

      const responseSummaries = summary.responses.map((r) => ({
        sourceAgentId: r.sourceAgentId,
        status: r.status,
        confidence: r.confidence,
        answerSummary: (r.answer ?? "").slice(0, 200),
        blockers: r.blockers,
        warnings: r.warnings,
      }));

      return {
        status: "ok",
        candidateId,
        readiness,
        totalRequests: summary.totalRequests,
        answeredCount: summary.answeredCount,
        pendingCount: summary.pendingCount,
        failedCount: summary.failedCount,
        overallConfidence: summary.overallConfidence,
        blockers: summary.blockers,
        responses: responseSummaries,
        updatedAt: summary.updatedAt,
        noMutationExecuted: true,
      };
    },
  };
}
