import type {
  EvidenceRequestPayload,
  EvidenceResponsePayload,
  EvidenceTargetAgentId,
} from "@msl/domain";
import type { EvidenceRequestStore } from "@msl/memory";
import type { GraphEngine } from "@msl/memory";
import type { Logger } from "../conversation/observability.js";
import type { AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";
import type { AgentWorkSessionStore } from "../sessions/AgentWorkSessionStore.js";

// ── Responder contract ────────────────────────────────────────────────

export type EvidenceResponder = {
  readonly agentId: EvidenceTargetAgentId;
  canHandle(request: EvidenceRequestPayload): boolean;
  answer(request: EvidenceRequestPayload): Promise<EvidenceResponsePayload>;
};

// ── Router dependencies ───────────────────────────────────────────────

export type EvidenceResponseRouterDeps = {
  evidenceRequestStore: EvidenceRequestStore;
  messageBus?: AgentMessageBusStore;
  sessionStore?: AgentWorkSessionStore;
  cortex?: GraphEngine;
  clock?: { now(): Date };
  logger?: Logger;
};

// ── Router ────────────────────────────────────────────────────────────

/**
 * Dispatches pending evidence requests to registered responders.
 *
 * Lifecycle per request: claim → answer → persist response.
 * Failures are caught and stored as failed with error evidence.
 * Unsupported kinds are marked unsupported.
 * Cortex + session observations are recorded in non-blocking try/catch.
 */
export class EvidenceResponseRouter {
  private readonly evidenceRequestStore: EvidenceRequestStore;
  private readonly messageBus: AgentMessageBusStore | undefined;
  private readonly sessionStore: AgentWorkSessionStore | undefined;
  private readonly cortex: GraphEngine | undefined;
  private readonly clock: () => Date;
  private readonly log: Logger | undefined;

  private readonly responders = new Map<EvidenceTargetAgentId, EvidenceResponder>();

  constructor(deps: EvidenceResponseRouterDeps) {
    this.evidenceRequestStore = deps.evidenceRequestStore;
    this.messageBus = deps.messageBus;
    this.sessionStore = deps.sessionStore;
    this.cortex = deps.cortex;
    this.clock = deps.clock ? () => deps.clock!.now() : () => new Date();
    this.log = deps.logger;
  }

  /** Register a responder so the router can dispatch to it. */
  registerResponder(responder: EvidenceResponder): void {
    this.responders.set(responder.agentId, responder);
    this.log?.info("EvidenceResponseRouter: registered responder", {
      agentId: responder.agentId,
    });
  }

  /**
   * Process all pending requests for a given agent.
   * Returns the list of responses produced.
   */
  async processPendingForAgent(
    agentId: string,
    limit?: number,
  ): Promise<EvidenceResponsePayload[]> {
    const pending = this.evidenceRequestStore.listPendingRequestsForAgent(
      agentId as EvidenceTargetAgentId,
      undefined,
      limit,
    );

    const responses: EvidenceResponsePayload[] = [];
    for (const request of pending) {
      try {
        const response = await this.processRequest(request.requestId);
        responses.push(response);
      } catch (err) {
        this.log?.error(
          "EvidenceResponseRouter: unhandled error processing pending request",
          err instanceof Error ? err : undefined,
        );
      }
    }

    return responses;
  }

  /**
   * Process a single request by ID: claim → dispatch → answer/fail.
   * Returns the evidence response payload.
   */
  async processRequest(requestId: string): Promise<EvidenceResponsePayload> {
    const claimResult = this.evidenceRequestStore.claimRequest(requestId, "router");

    if (!claimResult.success || !claimResult.request) {
      throw new Error(claimResult.reason ?? `Failed to claim request ${requestId}`);
    }

    const request = claimResult.request;

    try {
      const responder = this.findResponder(request);

      if (!responder) {
        const unsupported: EvidenceResponsePayload = {
          type: "evidence-response",
          responseId: `er-unsupported-${request.requestId}-${Date.now()}`,
          requestId: request.requestId,
          correlationId: request.correlationId,
          sourceAgentId: request.targetAgentId,
          targetAgentId: request.sourceAgentId,
          ...(request.sellerId !== undefined ? { sellerId: request.sellerId } : {}),
          ...(request.candidateId !== undefined ? { candidateId: request.candidateId } : {}),
          status: "unsupported",
          answer: `No responder registered for evidence kind: ${request.kind}.`,
          structuredEvidence: {},
          evidenceIds: [],
          confidence: "low",
          blockers: [`Unsupported evidence kind: ${request.kind}.`],
          warnings: [],
          createdAt: this.clock().toISOString(),
          noMutationExecuted: true,
        };

        this.evidenceRequestStore.answerRequest(unsupported);
        this.tryPublishResponse(unsupported);
        this.tryRecordSessionObservation(unsupported, request, "unsupported");
        return unsupported;
      }

      const response = await responder.answer(request);

      // Persist the response
      this.evidenceRequestStore.answerRequest(response);

      // Fire-and-forget: publish response to bus
      this.tryPublishResponse(response);

      // Non-blocking: record session + cortex
      this.tryRecordSessionObservation(response, request, "answered");
      this.tryRecordCortexNode(response, request);

      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      this.evidenceRequestStore.failRequest(request.requestId, errorMessage);

      const failed: EvidenceResponsePayload = {
        type: "evidence-response",
        responseId: `er-failed-${request.requestId}-${Date.now()}`,
        requestId: request.requestId,
        correlationId: request.correlationId,
        sourceAgentId: request.targetAgentId,
        targetAgentId: request.sourceAgentId,
        ...(request.sellerId !== undefined ? { sellerId: request.sellerId } : {}),
        ...(request.candidateId !== undefined ? { candidateId: request.candidateId } : {}),
        status: "failed",
        answer: "Responder threw an error while processing this evidence request.",
        structuredEvidence: { error: errorMessage },
        evidenceIds: [],
        confidence: "low",
        blockers: [errorMessage],
        warnings: [],
        createdAt: this.clock().toISOString(),
        noMutationExecuted: true,
      };

      this.tryPublishResponse(failed);
      this.tryRecordSessionObservation(failed, request, "failed");

      return failed;
    }
  }

  // ── Internal dispatcher ──────────────────────────────────────────────

  /** Find the first registered responder that `canHandle` this request. */
  private findResponder(
    request: EvidenceRequestPayload,
  ): EvidenceResponder | undefined {
    // First try: exact targetAgentId match
    const byTarget = this.responders.get(request.targetAgentId);
    if (byTarget?.canHandle(request)) {
      return byTarget;
    }

    // Second try: iterate all responders for canHandle
    for (const responder of this.responders.values()) {
      if (responder.canHandle(request)) {
        return responder;
      }
    }

    return undefined;
  }

  // ── Optional hooks (fire-and-forget, non-blocking) ───────────────────

  private tryPublishResponse(response: EvidenceResponsePayload): void {
    if (!this.messageBus) return;

    try {
      const input: {
        senderAgentId: string;
        receiverAgentId: string;
        messageType: string;
        payloadJson: string;
        priority: number;
        dedupeKey: string;
        correlationId: string;
        sellerId?: string;
      } = {
        senderAgentId: response.sourceAgentId,
        receiverAgentId: response.targetAgentId,
        messageType: "evidence-response",
        payloadJson: JSON.stringify({
          responseId: response.responseId,
          requestId: response.requestId,
          status: response.status,
          confidence: response.confidence,
          noMutationExecuted: true,
        }),
        priority: 5,
        dedupeKey: `evidence-response:${response.responseId}`,
        correlationId: response.correlationId,
      };

      if (response.sellerId !== undefined) {
        input.sellerId = response.sellerId;
      }

      this.messageBus.enqueue(input);

      this.log?.info("EvidenceResponseRouter: published evidence-response to bus", {
        responseId: response.responseId,
        requestId: response.requestId,
      });
    } catch (err) {
      this.log?.error(
        "EvidenceResponseRouter: failed to publish to message bus",
        err instanceof Error ? err : undefined,
      );
      // Fire-and-forget — never throw
    }
  }

  private tryRecordSessionObservation(
    response: EvidenceResponsePayload,
    request: EvidenceRequestPayload,
    trigger: "answered" | "failed" | "unsupported",
  ): void {
    if (!this.sessionStore) return;

    try {
      const observationId = `obs-ev-${response.responseId}`;

      const kind: "opportunity" | "missing_data" =
        trigger === "unsupported" || trigger === "failed" ? "missing_data" : "opportunity";

      const severity: "info" | "warning" | "critical" =
        trigger === "failed"
          ? "warning"
          : trigger === "unsupported"
            ? "info"
            : response.confidence === "high"
              ? "info"
              : "warning";

      const summary =
        trigger === "answered"
          ? `Evidence response: ${request.kind} from ${response.sourceAgentId} (confidence: ${response.confidence})`
          : trigger === "failed"
            ? `Evidence request failed: ${request.kind} — ${response.blockers.join("; ")}`
            : `Evidence request unsupported: ${request.kind} — no responder available.`;

      this.sessionStore.addObservation({
        observationId,
        sellerId: request.sellerId ?? "unknown",
        agentId: response.sourceAgentId,
        sessionId: `ev-session-${response.correlationId}`,
        kind,
        summary,
        severity,
        metadataJson: JSON.stringify({
          responseId: response.responseId,
          requestId: response.requestId,
          kind: request.kind,
          confidence: response.confidence,
          blockedBy: response.blockers,
          trigger,
          sellerId: request.sellerId,
          candidateId: request.candidateId,
          noMutationExecuted: true,
        }),
      });

      this.log?.info("EvidenceResponseRouter: recorded session observation", {
        observationId,
        trigger,
      });
    } catch (err) {
      this.log?.error(
        "EvidenceResponseRouter: failed to record session observation",
        err instanceof Error ? err : undefined,
      );
      // Non-blocking — never throw
    }
  }

  private tryRecordCortexNode(
    response: EvidenceResponsePayload,
    request: EvidenceRequestPayload,
  ): void {
    if (!this.cortex) return;

    try {
      const sellerId = request.sellerId;
      if (!sellerId) return;

      this.cortex.ensureAccountAssetNode(sellerId);

      const nodeLabel = `evidence-response:${response.responseId}`;
      this.cortex.getOrCreateNode(
        nodeLabel,
        {
          type: "evidence-response",
          responseId: response.responseId,
          requestId: response.requestId,
          kind: request.kind,
          confidence: response.confidence,
          sellerId,
        },
        sellerId,
      );

      this.log?.info("EvidenceResponseRouter: recorded cortex node", {
        responseId: response.responseId,
      });
    } catch (err) {
      this.log?.error(
        "EvidenceResponseRouter: failed to record cortex node",
        err instanceof Error ? err : undefined,
      );
      // Non-blocking — never throw
    }
  }
}
