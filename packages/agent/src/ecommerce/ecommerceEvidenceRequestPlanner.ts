import crypto from "node:crypto";
import type { AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";
import type { Logger } from "../conversation/observability.js";
import type { MissingEvidenceReport } from "./ownedEcommerceMerchandisingAdvisor.js";
import type { EvidenceRequestPayload, EvidenceKind, Priority } from "@msl/domain";
import type { EvidenceRequestStore } from "@msl/memory";

// ── Public types ─────────────────────────────────────────────────────

export type EvidenceRequestMessage = {
  targetAgentId:
    "cost-supplier" | "market-catalog" | "creative-assets" | "account-brain" | "supplier-manager";
  candidateId: string;
  question: string;
  reason: string;
  priority: "low" | "medium" | "high";
  /** SHA-256 hex digest of candidateId + targetAgentId + question. */
  messageHash: string;
  timestamp: number;
};

// ── Internal types ───────────────────────────────────────────────────

type PlannerDeps = {
  messageBus?: AgentMessageBusStore;
  evidenceRequestStore?: EvidenceRequestStore;
  clock?: { now: () => Date };
  logger?: Logger;
};

// ── Constants ────────────────────────────────────────────────────────

const SENDER_AGENT_ID = "merchandising-advisor";

// ── Planner ──────────────────────────────────────────────────────────

/**
 * Converts `MissingEvidenceReport[]` into deduplicated `EvidenceRequestMessage[]`,
 * persists them to the EvidenceRequestStore, and optionally enqueues them
 * via the AgentMessageBusStore.
 *
 * When a store is available, requests are persisted before bus emission.
 * When absent, persistence is skipped (existing behavior preserved).
 * Store failures are logged but never thrown — fire-and-forget.
 * All operations carry `noMutationExecuted: true` semantics.
 */
export class EcommerceEvidenceRequestPlanner {
  private readonly messageBus: AgentMessageBusStore | undefined;
  private readonly evidenceRequestStore: EvidenceRequestStore | undefined;
  private readonly clock: () => Date;
  private readonly log: Logger | undefined;

  constructor(deps?: PlannerDeps) {
    this.messageBus = deps?.messageBus;
    this.evidenceRequestStore = deps?.evidenceRequestStore;
    this.clock = deps?.clock?.now ?? (() => new Date());
    this.log = deps?.logger;
  }

  /**
   * Plan evidence request messages from a set of `MissingEvidenceReport`s.
   *
   * Deduplicates by `messageHash` (sha256 of candidateId + targetAgentId + question).
   * When `evidenceRequestStore` is configured, persists each request fire-and-forget.
   * When `messageBus` is configured, enqueues each message fire-and-forget.
   * Returns the full set of planned (non-duplicate) messages.
   */
  planRequests(requests: MissingEvidenceReport[], candidateId: string): EvidenceRequestMessage[] {
    const planned: EvidenceRequestMessage[] = [];
    const seen = new Set<string>();

    for (const req of requests) {
      const messageHash = crypto
        .createHash("sha256")
        .update(`${candidateId}|${req.targetAgentId}|${req.question}`)
        .digest("hex");

      if (seen.has(messageHash)) {
        this.log?.info("EcommerceEvidenceRequestPlanner: skipping duplicate request", {
          candidateId,
          targetAgentId: req.targetAgentId,
          messageHash,
        });
        continue;
      }

      seen.add(messageHash);

      const priority = severityToPriority(req.severity);
      const kind = reportCategoryToEvidenceKind(req);
      const correlationId = crypto.randomUUID();
      const windowKey = this.clock().toISOString().slice(0, 13); // hourly window
      const dedupeKey = crypto
        .createHash("sha256")
        .update(`${candidateId}|${kind}|${windowKey}`)
        .digest("hex");
      const now = this.clock().toISOString();

      const message: EvidenceRequestMessage = {
        targetAgentId: req.targetAgentId,
        candidateId: req.candidateId || candidateId,
        question: req.question,
        reason: req.description,
        priority,
        messageHash,
        timestamp: this.clock().getTime(),
      };

      planned.push(message);

      // Persist to store (fire-and-forget)
      this.tryPersistToStore({
        candidateId: message.candidateId,
        targetAgentId: req.targetAgentId,
        kind,
        question: message.question,
        reason: message.reason,
        priority,
        correlationId,
        dedupeKey,
        createdAt: now,
      });

      // Fire-and-forget via message bus when available
      this.tryEnqueue(message, candidateId, correlationId);
    }

    return planned;
  }

  /**
   * Attempt to persist a request to the EvidenceRequestStore. Failures
   * are logged but never thrown — the structured message is always returned.
   */
  private tryPersistToStore(input: {
    candidateId: string;
    targetAgentId: MissingEvidenceReport["targetAgentId"];
    kind: EvidenceKind;
    question: string;
    reason: string;
    priority: Priority;
    correlationId: string;
    dedupeKey: string;
    createdAt: string;
  }): void {
    if (!this.evidenceRequestStore) return;

    try {
      const requestId = crypto.randomUUID();
      const payload: EvidenceRequestPayload = {
        type: "evidence-request",
        requestId,
        correlationId: input.correlationId,
        sourceAgentId: SENDER_AGENT_ID,
        targetAgentId: input.targetAgentId,
        candidateId: input.candidateId,
        kind: input.kind,
        question: input.question,
        reason: input.reason,
        priority: input.priority,
        evidenceIds: [],
        createdAt: input.createdAt,
        dedupeKey: input.dedupeKey,
        noMutationExecuted: true,
      };

      const result = this.evidenceRequestStore.enqueueRequest(payload);

      if (result.status === "duplicate") {
        this.log?.info(
          "EcommerceEvidenceRequestPlanner: evidence request already exists (dedupe)",
          {
            candidateId: input.candidateId,
            kind: input.kind,
            duplicateOfRequestId: result.duplicateOfRequestId,
          },
        );
      } else {
        this.log?.info("EcommerceEvidenceRequestPlanner: persisted evidence request to store", {
          requestId,
          candidateId: input.candidateId,
          kind: input.kind,
        });
      }
    } catch (err) {
      this.log?.error(
        "EcommerceEvidenceRequestPlanner: failed to persist evidence request to store",
        err instanceof Error ? err : undefined,
      );
      // Never throw — fire-and-forget semantics
    }
  }

  /**
   * Attempt to enqueue a message via the message bus. Failures are logged
   * but never thrown — the structured message is always returned.
   */
  private tryEnqueue(
    message: EvidenceRequestMessage,
    candidateId: string,
    correlationId: string,
  ): void {
    if (!this.messageBus) return;

    try {
      this.messageBus.enqueue({
        senderAgentId: SENDER_AGENT_ID,
        receiverAgentId: message.targetAgentId,
        messageType: "evidence-request",
        payloadJson: JSON.stringify({
          targetAgentId: message.targetAgentId,
          candidateId: message.candidateId,
          question: message.question,
          reason: message.reason,
          priority: message.priority,
          messageHash: message.messageHash,
          timestamp: message.timestamp,
          noMutationExecuted: true,
        }),
        priority: priorityToNumeric(message.priority),
        dedupeKey: `evidence-request:${message.messageHash}`,
        correlationId,
        sellerId: candidateId, // candidateId carries seller context
      });

      this.log?.info("EcommerceEvidenceRequestPlanner: enqueued evidence request", {
        candidateId,
        targetAgentId: message.targetAgentId,
        messageHash: message.messageHash,
        correlationId,
      });
    } catch (err) {
      this.log?.error(
        "EcommerceEvidenceRequestPlanner: failed to enqueue evidence request",
        err instanceof Error ? err : undefined,
      );
      // Never throw — fire-and-forget semantics
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function severityToPriority(
  severity: MissingEvidenceReport["severity"],
): EvidenceRequestMessage["priority"] {
  switch (severity) {
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
  }
}

function priorityToNumeric(priority: EvidenceRequestMessage["priority"]): number {
  switch (priority) {
    case "high":
      return 1;
    case "medium":
      return 5;
    case "low":
      return 9;
  }
}

/**
 * Map a MissingEvidenceReport to an EvidenceKind for store persistence.
 */
function reportCategoryToEvidenceKind(report: MissingEvidenceReport): EvidenceKind {
  const agent = report.targetAgentId;
  const category = report.category;

  if (agent === "cost-supplier") return "cost-margin";
  if (agent === "supplier-manager") {
    return category === "cortex" ? "supplier-freshness" : "supplier-stock";
  }
  if (agent === "market-catalog") {
    if (category === "competition") return "market-competition";
    return "market-demand";
  }
  if (agent === "creative-assets") return "creative-assets";
  if (agent === "account-brain") {
    return category === "account" ? "account-channel-fit" : "claim-support";
  }

  return "unknown";
}
