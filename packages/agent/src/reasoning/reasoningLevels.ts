import { ReasoningLevel } from "./reasoningTypes.js";

// ── Per-Level Timeout (ms) ───────────────────────────────────────────

/**
 * Spec-defined timeouts per reasoning level.
 * Auto-execute levels (classification, summarization, prioritization) get 5s.
 * Recommendation gets 15s. Decision gets 30s.
 */
export const LEVEL_TIMEOUT_MS: Record<ReasoningLevel, number> = {
  [ReasoningLevel.Classification]: 5000,
  [ReasoningLevel.Summarization]: 5000,
  [ReasoningLevel.Prioritization]: 5000,
  [ReasoningLevel.Recommendation]: 15000,
  [ReasoningLevel.Decision]: 30000,
};

// ── Auto-Execute Boundary ────────────────────────────────────────────

/**
 * Levels that are low-risk and may auto-execute without approval
 * (subject to autonomy gate override).
 */
export const AUTO_EXECUTE_LEVELS: ReadonlySet<ReasoningLevel> = new Set([
  ReasoningLevel.Classification,
  ReasoningLevel.Summarization,
  ReasoningLevel.Prioritization,
]);

/**
 * Maps each reasoning level to the autonomy gate risk string
 * used by `AutonomyEngine.canAutoApprove(riskLevel)`.
 */
export const LEVEL_RISK_MAP: Record<ReasoningLevel, string> = {
  [ReasoningLevel.Classification]: "low",
  [ReasoningLevel.Summarization]: "low",
  [ReasoningLevel.Prioritization]: "low",
  [ReasoningLevel.Recommendation]: "medium",
  [ReasoningLevel.Decision]: "high",
};

// ── Helpers ──────────────────────────────────────────────────────────

export function isAutoExecuteLevel(level: ReasoningLevel): boolean {
  return AUTO_EXECUTE_LEVELS.has(level);
}

/**
 * Returns true when the level always requires CEO approval
 * regardless of autonomy level.
 */
export function requiresApprovalByDefault(level: ReasoningLevel): boolean {
  return !isAutoExecuteLevel(level);
}

export function getLevelTimeout(level: ReasoningLevel, overrideMs?: number): number {
  return overrideMs ?? LEVEL_TIMEOUT_MS[level];
}

export function getLevelRisk(level: ReasoningLevel): string {
  return LEVEL_RISK_MAP[level];
}
