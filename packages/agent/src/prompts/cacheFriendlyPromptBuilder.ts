import crypto from "node:crypto";

import type { AgentWorkPrompt, StablePromptBlock, VariableEvidenceBlock } from "@msl/domain";
import type { AgentLesson } from "@msl/domain";

// ── Public types ────────────────────────────────────────────────────────────

export type CacheFriendlyPromptConfig = {
  /** Seller identifier for per-account customization. */
  sellerId: string;
  /** Agent identifier — determines lane contract and role prompt. */
  agentId: string;
  /** Account-level context: seller name, profit goal, etc. */
  accountContext: string;
  /** Compressed summary from the most recent session (max 300 chars). */
  recentMemory: string;
  /** Evidential signals this cycle (unanswered questions, risks, etc.). */
  evidence: string;
  /** Open questions pending resolution. */
  openQuestions: string;
  /** Expected JSON output schema for the agent's response. */
  outputSchema: string;
  /** Recent transferable lessons to inject (max 3). */
  lessons?: AgentLesson[];
};

// ── Policy blocks ───────────────────────────────────────────────────────────

const SYSTEM_POLICY = `You are an autonomous business agent operating within strict safety boundaries.
You observe, analyze, and recommend — you do NOT execute mutations directly.
All proposed actions must go through CEO approval before execution.`;

const SAFETY_POLICY = `WRITE PROHIBITION: You are read-only. Do not create, update, or delete any resource.
Expected output must include "noMutationExecuted": true in every response.`;

// ── Pure functions ──────────────────────────────────────────────────────────

/**
 * Build the stable prefix block (layers 1-6).
 * This changes infrequently — only when account configuration, agent role,
 * or lessons change. DeepSeek disk cache hits are maximized when this stays
 * constant across sessions for the same agent+account.
 */
export function buildStableAgentPrompt(config: CacheFriendlyPromptConfig): StablePromptBlock {
  const lessonsBlock = buildLessonsBlock(config.lessons);
  return [
    SYSTEM_POLICY,
    `## Your Role\nYou are the "${config.agentId}" agent.\nSeller: ${config.sellerId}`,
    `## Company Rules\n- Never execute a mutation without CEO approval\n- Always provide evidence for every recommendation`,
    SAFETY_POLICY,
    `## Account Context\n${config.accountContext}`,
    `## Recent Memory\n${config.recentMemory || "No recent session memory available."}`,
    ...(lessonsBlock ? [lessonsBlock] : []),
  ].join("\n\n");
}

/**
 * Build the variable evidence block (layers 7-9).
 * This changes per cycle — it's the tail of the prompt that
 * forces a cache miss for the evidence portion but allows the
 * stable prefix to remain cached.
 */
export function buildVariableEvidenceBlock(
  config: CacheFriendlyPromptConfig,
): VariableEvidenceBlock {
  return [
    `## New Evidence (this cycle)\n${config.evidence || "No new evidence."}`,
    `## Open Questions\n${config.openQuestions || "No pending questions."}`,
    `## Expected Output\n${config.outputSchema}`,
  ].join("\n\n");
}

/**
 * Full prompt assembly: stable prefix + cache break + variable evidence.
 * Returns the complete prompt and the two hashes for session tracking.
 */
export function buildAgentWorkPrompt(config: CacheFriendlyPromptConfig): AgentWorkPrompt {
  const stablePrefix = buildStableAgentPrompt(config);
  const variableEvidence = buildVariableEvidenceBlock(config);
  const stablePromptHash = computeHash(stablePrefix);
  const evidenceHash = computeHash(variableEvidence);

  return { stablePrefix, variableEvidence, stablePromptHash, evidenceHash };
}

/**
 * Compute the full assembled prompt from a prompt config.
 * The complete prompt is: stablePrefix + "\n\n---\n\n" + variableEvidence.
 */
export function assembleFullPrompt(config: CacheFriendlyPromptConfig): string {
  const prompt = buildAgentWorkPrompt(config);
  return `${prompt.stablePrefix}\n\n---\n\n${prompt.variableEvidence}`;
}

// ── Lessons injection ───────────────────────────────────────────────────────

function buildLessonsBlock(lessons: AgentLesson[] | undefined): string {
  if (!lessons || lessons.length === 0) return "";

  // Max 3 most recent, seller-scoped, transferable
  const injectable = lessons.filter((l) => l.transferable).slice(-3);

  if (injectable.length === 0) return "";

  const lines = injectable.map((l, i) => `${i + 1}. ${l.lesson}`);
  return `## Lessons Learned\n${lines.join("\n")}`;
}

// ── Hashing ─────────────────────────────────────────────────────────────────

export function computeHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}
