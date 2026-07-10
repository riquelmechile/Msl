import crypto from "node:crypto";
import type { AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";
import type { Logger } from "../conversation/observability.js";
import type { MissingEvidenceReport } from "./ownedEcommerceMerchandisingAdvisor.js";

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
  clock?: { now: () => Date };
  logger?: Logger;
};

// ── Constants ────────────────────────────────────────────────────────

const SENDER_AGENT_ID = "merchandising-advisor";

// ── Planner ──────────────────────────────────────────────────────────

/**
 * Converts `MissingEvidenceReport[]` into deduplicated `EvidenceRequestMessage[]`
 * and optionally enqueues them via the `AgentMessageBusStore`.
 *
 * When a message bus is available, messages are sent fire-and-forget.
 * When absent, only structured messages are returned — no side effects.
 * All operations carry `noMutationExecuted: true` semantics.
 */
export class EcommerceEvidenceRequestPlanner {
  private readonly messageBus: AgentMessageBusStore | undefined;
  private readonly clock: () => Date;
  private readonly log: Logger | undefined;

  constructor(deps?: PlannerDeps) {
    this.messageBus = deps?.messageBus;
    this.clock = deps?.clock?.now ?? (() => new Date());
    this.log = deps?.logger;
  }

  /**
   * Plan evidence request messages from a set of `MissingEvidenceReport`s.
   *
   * Deduplicates by `messageHash` (sha256 of candidateId + targetAgentId + question).
   * When a `messageBus` is configured, enqueues each message fire-and-forget.
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

      // Fire-and-forget via message bus when available
      this.tryEnqueue(message, candidateId);
    }

    return planned;
  }

  /**
   * Attempt to enqueue a message via the message bus. Failures are logged
   * but never thrown — the structured message is always returned.
   */
  private tryEnqueue(message: EvidenceRequestMessage, candidateId: string): void {
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
        }),
        priority: priorityToNumeric(message.priority),
        dedupeKey: `evidence-request:${message.messageHash}`,
        sellerId: candidateId, // candidateId carries seller context
      });

      this.log?.info("EcommerceEvidenceRequestPlanner: enqueued evidence request", {
        candidateId,
        targetAgentId: message.targetAgentId,
        messageHash: message.messageHash,
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
