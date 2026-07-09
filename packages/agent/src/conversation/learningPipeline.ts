import type { AgentMessageBusStore, AgentMessage } from "./agentMessageBusStore.js";
import type { GraphEngine } from "@msl/memory";

// ── Types ────────────────────────────────────────────────────────────

export type LearningPipelineOptions = {
  /** Max messages to process per batch (default: 50). */
  batchSize?: number;
  /** Scoring strategy: "heuristic" (default) or "passthrough". */
  strategy?: "heuristic" | "passthrough";
  /** Only process messages after this ISO date. */
  since?: string;
};

export type ScoredOutcome = {
  message: AgentMessage;
  outcomeScore: number;
  summary: string;
};

export type LearningPipelineResult = {
  processed: number;
  scored: ScoredOutcome[];
  errors: string[];
};

// ── Scoring heuristics ────────────────────────────────────────────────

/**
 * Compute an outcome score (0.0–1.0) based on message status and payload.
 *
 * Heuristic strategy:
 * - resolved with result_json → base 0.7, adjusted by findings
 * - failed → 0.0–0.3 based on error type
 * - cancelled → 0.0–0.5 based on cancel reason
 */
export function scoreMessage(msg: AgentMessage): { score: number; summary: string } {
  switch (msg.status) {
    case "resolved":
      return scoreResolved(msg);
    case "failed":
      return scoreFailed(msg);
    case "cancelled":
      return scoreCancelled(msg);
    default:
      return { score: 0, summary: `unexpected status: ${msg.status}` };
  }
}

function scoreResolved(msg: AgentMessage): { score: number; summary: string } {
  let score = 0.7;
  let summary = "resolved";
  const parts: string[] = [];

  if (msg.resultJson) {
    try {
      const result = JSON.parse(msg.resultJson) as Record<string, unknown>;
      const findings = Array.isArray(result.findings)
        ? (result.findings as Array<Record<string, unknown>>)
        : [];
      const severity = result.severity as string | undefined;

      if (findings.length > 3) {
        score += 0.15;
      } else if (findings.length > 0) {
        score += 0.05;
      }

      if (severity === "critical") {
        score += 0.1;
      } else if (findings.length === 0) {
        score = Math.min(score, 0.5);
      }

      parts.push(`${findings.length} findings`);
      if (severity) parts.push(`severity:${severity}`);

      if (typeof result.description === "string") {
        summary = result.description;
      } else if (typeof result.summary === "string") {
        summary = result.summary;
      }
    } catch {
      parts.push("unparseable result");
    }
  } else {
    score = 0.5;
    parts.push("no result data");
  }

  return { score: Math.min(score, 1.0), summary: parts.length > 0 ? `${summary} (${parts.join(", ")})` : summary };
}

function scoreFailed(msg: AgentMessage): { score: number; summary: string } {
  let score = 0.2;
  let summary = "failed";
  const errorMsg = msg.errorJson
    ? (() => {
        try {
          return (JSON.parse(msg.errorJson) as Record<string, unknown>).message as string;
        } catch {
          return msg.errorJson;
        }
      })()
    : "";

  if (msg.attempts >= 3 || /exhausted|permanent|denied/i.test(errorMsg)) {
    score = 0.1;
    summary = `permanent failure${errorMsg ? `: ${errorMsg}` : ""}`;
  } else if (/timeout|rate.limit|temporar/i.test(errorMsg)) {
    score = 0.3;
    summary = `transient failure${errorMsg ? `: ${errorMsg}` : ""}`;
  } else {
    score = 0.15;
    summary = `failure${errorMsg ? `: ${errorMsg}` : ""}`;
  }

  return { score, summary };
}

function scoreCancelled(msg: AgentMessage): { score: number; summary: string } {
  const reason = msg.cancelReason ?? "";

  if (/duplicate|superseded/i.test(reason)) {
    return { score: 0.5, summary: `cancelled (superseded): ${reason}` };
  }
  if (/timeout|stale|expired/i.test(reason)) {
    return { score: 0.2, summary: `cancelled (stale): ${reason}` };
  }
  if (/no.longer|irrelevant|abandoned/i.test(reason)) {
    return { score: 0.0, summary: `cancelled (abandoned): ${reason}` };
  }
  if (reason) {
    return { score: 0.3, summary: `cancelled: ${reason}` };
  }
  return { score: 0.15, summary: "cancelled (no reason)" };
}

// ── Learning pipeline ────────────────────────────────────────────────

/**
 * Run a batch learning pipeline cycle.
 *
 * Reads unscored messages from the bus, scores them heuristically,
 * records outcome scores on the bus, and writes learning observations
 * to the Cortex graph.
 *
 * @param bus - Agent message bus store
 * @param cortex - GraphEngine for persisting learning observations
 * @param options - Batch size, strategy, since date
 */
export async function runLearningPipeline(
  bus: AgentMessageBusStore,
  cortex: GraphEngine,
  options?: LearningPipelineOptions,
): Promise<LearningPipelineResult> {
  const batchSize = options?.batchSize ?? 50;
  const strategy = options?.strategy ?? "heuristic";
  const since = options?.since;

  const result: LearningPipelineResult = {
    processed: 0,
    scored: [],
    errors: [],
  };

  const unscored = bus.getUnscoredMessages(since ? { since, limit: batchSize } : { limit: batchSize });
  if (unscored.length === 0) return result;

  const batch = unscored.slice(0, batchSize);
  result.processed = batch.length;

  for (const msg of batch) {
    try {
      let outcomeScore: number;
      let summary: string;

      if (strategy === "passthrough") {
        outcomeScore = msg.outcomeScore ?? 0.5;
        summary = `passthrough: ${msg.status}`;
      } else {
        const scored = scoreMessage(msg);
        outcomeScore = scored.score;
        summary = scored.summary;
      }

      bus.recordOutcome(msg.messageId, outcomeScore, new Date().toISOString());

      cortex.getOrCreateNode(`learning_outcome_${msg.messageId}`, {
        type: "learning_outcome",
        messageId: msg.messageId,
        messageType: msg.messageType,
        senderAgentId: msg.senderAgentId,
        receiverAgentId: msg.receiverAgentId,
        status: msg.status,
        outcomeScore,
        summary,
        sellerId: msg.sellerId,
        correlationId: msg.correlationId,
        scoredAt: new Date().toISOString(),
      });

      result.scored.push({ message: msg, outcomeScore, summary });
    } catch (err) {
      result.errors.push(
        `Failed to score message ${msg.messageId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}
