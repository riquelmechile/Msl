import crypto from "node:crypto";

import type { AgentWorkSession, AgentObservation, AgentLesson } from "@msl/domain";
import type { GraphEngine } from "@msl/memory";

import type { AgentWorkSessionStore } from "./AgentWorkSessionStore.js";
import { hashAgentSignals, shouldAgentWakeUp } from "./agentWakePolicy.js";
import type { SignalDescriptor } from "./agentWakePolicy.js";
import { buildAgentWorkPrompt } from "../prompts/cacheFriendlyPromptBuilder.js";
import type { CacheFriendlyPromptConfig } from "../prompts/cacheFriendlyPromptBuilder.js";
import type { AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";
import type { CeoInboxStore } from "../conversation/ceoInboxStore.js";
import type { AccountAssetStore } from "../conversation/accountAssetStore.js";
import type {
  DeepSeekTransport,
  DeepSeekChatRequest,
} from "../conversation/transports/deepseekTransport.js";
import {
  recordWorkSessionToCortex,
  recordObservationsToCortex,
  recordLessonsToCortex,
} from "./agentWorkCortexBridge.js";

// ── Public types ────────────────────────────────────────────────────────────

export type AgentWorkSessionRunnerInput = {
  sellerId: string;
  agentId: string;
  laneId: string;
  signals: SignalDescriptor[];
  accountContext: string;
  evidence: string;
  openQuestions: string;
  outputSchema: string;
  /** Force-wake even when policy says skip. */
  manual?: boolean;
};

export type AgentWorkSessionRunnerConfig = {
  workSessionStore: AgentWorkSessionStore;
  accountAssetStore: AccountAssetStore;
  cortex: GraphEngine;
  ceoInboxStore: CeoInboxStore;
  messageBus: AgentMessageBusStore;
  deepSeekTransport: DeepSeekTransport;
  clock?: { now: () => Date };
  logger?: { info: (msg: string) => void; error: (msg: string) => void };
};

/** Expected output shape from DeepSeek for a work session. */
type DeepSeekSessionOutput = {
  observations?: Array<{
    kind: string;
    summary: string;
    severity: string;
    metadata?: Record<string, unknown>;
  }>;
  proposals?: Array<{
    type: string;
    summary: string;
    payload: Record<string, unknown>;
    risk_level?: string;
  }>;
  lessons?: Array<{
    lesson: string;
    transferable?: boolean;
  }>;
  summary?: string;
  noMutationExecuted?: boolean;
};

// ── Constants ───────────────────────────────────────────────────────────────

const DEEPSEEK_MODEL = "deepseek-v4-flash";
const VALID_OBSERVATION_KINDS = new Set([
  "new_signal",
  "risk",
  "opportunity",
  "missing_data",
  "repeated_pattern",
  "no_change",
]);
const VALID_SEVERITIES = new Set(["info", "warning", "critical"]);

// ── Runner ──────────────────────────────────────────────────────────────────

export type AgentWorkSessionRunner = {
  runWorkSession: (input: AgentWorkSessionRunnerInput) => Promise<AgentWorkSession>;
};

export function createAgentWorkSessionRunner(
  config: AgentWorkSessionRunnerConfig,
): AgentWorkSessionRunner {
  const clock = config.clock ?? { now: () => new Date() };
  const logger = config.logger ?? {
    info: () => {},
    error: () => {},
  };

  const runWorkSession = async (input: AgentWorkSessionRunnerInput): Promise<AgentWorkSession> => {
    const startTime = clock.now().toISOString();

    // 1. Hash signals
    const signalsHash = hashAgentSignals(input.signals);

    // 2. shouldAgentWakeUp
    const lastSession = config.workSessionStore.getLastSessionForSignals(
      input.sellerId,
      input.agentId,
      signalsHash,
    );
    const pendingProposals = config.ceoInboxStore
      .getBySellerId(input.sellerId)
      .filter((p) => p.status === "pending")
      .map((p) => p.proposal_id);

    const wakeDecision = shouldAgentWakeUp({
      sellerId: input.sellerId,
      agentId: input.agentId,
      signals: input.signals,
      ...(lastSession ? { lastSession } : {}),
      ...(input.manual !== undefined ? { manual: input.manual } : {}),
      pendingProposals,
    });

    if (!wakeDecision.shouldWake) {
      // 3. skipSession
      const sessionId = generateSessionId(input.sellerId, input.agentId, input.laneId);
      const skippedSession: AgentWorkSession = {
        sessionId,
        sellerId: input.sellerId,
        agentId: input.agentId,
        laneId: input.laneId,
        status: "planned",
        signalsHash,
        stablePromptHash: "",
        evidenceHash: "",
        cycleCount: lastSession ? lastSession.cycleCount + 1 : 0,
        summaryJson: JSON.stringify({ reason: wakeDecision.reason }),
      };
      const started = config.workSessionStore.startSession(skippedSession);
      config.workSessionStore.skipSession(sessionId, input.sellerId, wakeDecision.reason);
      logger.info(
        `[work-session] Skipped ${input.agentId}/${input.sellerId}: ${wakeDecision.reason}`,
      );
      return config.workSessionStore.getSession(sessionId, input.sellerId) ?? started;
    }

    // 4. startSession
    const sessionId = generateSessionId(input.sellerId, input.agentId, input.laneId);
    const recentMemory = lastSession?.summaryJson ? lastSession.summaryJson.slice(0, 300) : "";
    const recentLessons = config.workSessionStore.listRecentLessons(
      input.sellerId,
      input.agentId,
      3,
    );

    // 5. buildAgentWorkPrompt
    const promptConfig: CacheFriendlyPromptConfig = {
      sellerId: input.sellerId,
      agentId: input.agentId,
      accountContext: input.accountContext,
      recentMemory,
      evidence: input.evidence,
      openQuestions: input.openQuestions,
      outputSchema: input.outputSchema,
      lessons: recentLessons,
    };
    const prompt = buildAgentWorkPrompt(promptConfig);

    // Calculate cycle count
    const cycleCount = lastSession ? lastSession.cycleCount + 1 : 0;

    const newSession: AgentWorkSession = {
      sessionId,
      sellerId: input.sellerId,
      agentId: input.agentId,
      laneId: input.laneId,
      status: "planned",
      signalsHash,
      stablePromptHash: prompt.stablePromptHash,
      evidenceHash: prompt.evidenceHash,
      cycleCount,
      summaryJson: "{}",
    };

    config.workSessionStore.startSession(newSession);

    // 6. call deepSeekTransport
    const fullPrompt = `${prompt.stablePrefix}\n\n---\n\n${prompt.variableEvidence}`;

    try {
      const request: DeepSeekChatRequest = {
        model: DEEPSEEK_MODEL,
        messages: [{ role: "user", content: fullPrompt }],
        extra_body: { disk_cache_ttl: "86400" },
      };

      const response = await config.deepSeekTransport.createChatCompletion(request);
      const content = response.choices[0]?.message.content;

      if (!content) {
        // Empty response — treat as failed
        const errorJson = JSON.stringify({ error: "empty response from DeepSeek" });
        config.workSessionStore.failSession(sessionId, input.sellerId, errorJson);
        logger.error(`[work-session] DeepSeek empty response for ${sessionId}`);
        return config.workSessionStore.getSession(sessionId, input.sellerId)!;
      }

      // 7. parse structured JSON output
      let parsed: DeepSeekSessionOutput;
      try {
        parsed = JSON.parse(content) as DeepSeekSessionOutput;
      } catch {
        // Invalid JSON — save as error but don't crash
        const errorJson = JSON.stringify({
          error: "invalid json output",
          raw: content.slice(0, 500),
        });
        config.workSessionStore.failSession(sessionId, input.sellerId, errorJson);
        logger.error(`[work-session] Invalid JSON from DeepSeek for ${sessionId}`);
        return config.workSessionStore.getSession(sessionId, input.sellerId)!;
      }

      // 8. record observations
      const observations = (parsed.observations ?? []).slice(0, 20); // cap at 20
      for (let i = 0; i < observations.length; i++) {
        const obs = observations[i];
        if (!obs) continue;
        const kind = VALID_OBSERVATION_KINDS.has(obs.kind) ? obs.kind : "no_change";
        const severity = VALID_SEVERITIES.has(obs.severity) ? obs.severity : "info";
        const observation: AgentObservation = {
          observationId: `${sessionId}-obs-${i + 1}`,
          sellerId: input.sellerId,
          agentId: input.agentId,
          sessionId,
          kind: kind as AgentObservation["kind"],
          summary: (obs.summary ?? "").slice(0, 1024),
          severity: severity as AgentObservation["severity"],
          metadataJson: JSON.stringify(obs.metadata ?? {}),
        };
        config.workSessionStore.addObservation(observation);
      }

      // 9. record proposals to CEO inbox
      const proposals = parsed.proposals ?? [];
      for (const proposal of proposals) {
        const proposalId = crypto.randomUUID();
        config.ceoInboxStore.insert({
          proposal_id: proposalId,
          sender_agent_id: input.agentId,
          proposal_type: proposal.type ?? "proposal",
          payload_json: JSON.stringify({
            ...proposal.payload,
            noMutationExecuted: true,
            sessionId,
            sellerId: input.sellerId,
          }),
          normalized_summary: proposal.summary ?? "",
          risk_level: normalizeRiskLevel(proposal.risk_level),
          seller_id: input.sellerId,
        });
        config.workSessionStore.addProposalLink(sessionId, proposalId, input.sellerId);

        // Enqueue to message bus
        config.messageBus.enqueue({
          senderAgentId: input.agentId,
          receiverAgentId: "ceo",
          messageType: "daemon-proposal",
          payloadJson: JSON.stringify({
            type: proposal.type ?? "proposal",
            summary: proposal.summary ?? "",
            severity: proposal.risk_level ?? "low",
            noMutationExecuted: true,
            sessionId,
            sellerId: input.sellerId,
          }),
        });
      }

      // 10. record lessons
      const lessons = (parsed.lessons ?? []).slice(0, 5); // cap at 5
      for (let i = 0; i < lessons.length; i++) {
        const lesson = lessons[i];
        if (!lesson) continue;
        const agentLesson: AgentLesson = {
          lessonId: `${sessionId}-lesson-${i + 1}`,
          sellerId: input.sellerId,
          agentId: input.agentId,
          sessionId,
          lesson: (lesson.lesson ?? "").slice(0, 2048),
          transferable: lesson.transferable ?? false,
          learnedAt: clock.now().toISOString(),
        };
        config.workSessionStore.addLesson(agentLesson);
      }

      // 11. record to Cortex
      const completedSession = config.workSessionStore.getSession(sessionId, input.sellerId);
      if (completedSession) {
        recordWorkSessionToCortex(config.cortex, completedSession, input.sellerId);
        recordObservationsToCortex(config.cortex, [], completedSession, input.sellerId);
        recordLessonsToCortex(config.cortex, [], completedSession, input.sellerId);
      }

      // 12. completeSession
      const summaryObj = {
        title: parsed.summary ?? "Work session completed",
        observationCount: observations.length,
        proposalCount: proposals.length,
        lessonCount: lessons.length,
        startedAt: startTime,
        endedAt: clock.now().toISOString(),
        noMutationExecuted: parsed.noMutationExecuted ?? true,
      };
      config.workSessionStore.completeSession(
        sessionId,
        input.sellerId,
        JSON.stringify(summaryObj),
      );

      logger.info(
        `[work-session] Completed ${input.agentId}/${input.sellerId}: ${observations.length} obs, ${proposals.length} proposals`,
      );

      return config.workSessionStore.getSession(sessionId, input.sellerId)!;
    } catch (err) {
      // DeepSeek failure — failSession with errorJson
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorJson = JSON.stringify({
        error: "DeepSeek call failed",
        message: errorMessage,
        timestamp: clock.now().toISOString(),
      });
      config.workSessionStore.failSession(sessionId, input.sellerId, errorJson);
      logger.error(`[work-session] DeepSeek failed for ${sessionId}: ${errorMessage}`);
      return config.workSessionStore.getSession(sessionId, input.sellerId)!;
    }
  };

  return { runWorkSession };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateSessionId(sellerId: string, agentId: string, laneId: string): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString("hex");
  return `aws-${sellerId}-${agentId}-${laneId}-${timestamp}-${random}`.slice(0, 64);
}

function normalizeRiskLevel(raw: unknown): "low" | "medium" | "high" | "critical" {
  if (typeof raw === "string") {
    const lowered = raw.toLowerCase();
    if (lowered === "critical") return "critical";
    if (lowered === "high") return "high";
    if (lowered === "medium") return "medium";
  }
  return "low";
}
