// ── Reasoning Level Enum ─────────────────────────────────────────────

export enum ReasoningLevel {
  Classification = "classification",
  Summarization = "summarization",
  Prioritization = "prioritization",
  Recommendation = "recommendation",
  Decision = "decision",
}

// ── ReasoningCall ────────────────────────────────────────────────────

export type ReasoningCall = {
  /** Unique identifier for the calling lane, used for cost attribution. */
  laneId: string;
  /** The reasoning level determines model, timeout, and approval requirements. */
  level: ReasoningLevel;
  /** Immutable system prompt — deepseek prefix-cache anchored at token 0. */
  stablePrefix: string;
  /** Slow-changing context (daily/weekly) — still cached but may differ per call. */
  cacheableContext?: string;
  /** Per-call user input — uncached, changes every invocation. */
  volatileInput: string;
  /** Optional JSON Schema to validate the LLM response shape. */
  expectedSchema?: Record<string, unknown>;
  /** When true, forces deepseek-v4-pro regardless of level defaults. */
  forcePro?: boolean;
  /** Override the per-level default timeout (ms). */
  timeoutMs?: number;
  /** Department ID for cost ledger attribution. */
  departmentId: string;
  /** Agent ID recorded in cost ledger entries. */
  agentId: string;
};

// ── CostTelemetry ────────────────────────────────────────────────────

export type CostTelemetry = {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  estimatedCostMicros: number;
};

// ── ReasoningResult ──────────────────────────────────────────────────

export type ReasoningResult = {
  status: "success" | "fallback";
  summary: string;
  confidence: number;
  recommendations: unknown[];
  modelUsed: string;
  costTelemetry: CostTelemetry;
  requiresApproval: boolean;
  rawResponse?: string;
};
