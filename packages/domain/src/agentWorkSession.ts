// ── Agent Work Session Domain Types ──────────────────────────────────────────
//
// These types model the session lifecycle, observations, lessons, wake decisions,
// and cache-friendly prompt structure for agent daemon work sessions.
//
// All types carry `sellerId` — scoped to exactly one seller account.
// Plasticov and Maustian data MUST NOT mix within a session.

// ── Session lifecycle ───────────────────────────────────────────────────────

export type SessionStatus = "planned" | "running" | "completed" | "skipped" | "failed";

export type AgentWorkSession = {
  sessionId: string;
  sellerId: string;
  agentId: string;
  laneId: string;
  status: SessionStatus;
  /** SHA-256 hash of the signal array that triggered this session. */
  signalsHash: string;
  /** SHA-256 of the stable prompt prefix (cache-friendly layers 1-6). */
  stablePromptHash: string;
  /** SHA-256 of the variable evidence block (layers 7-9). */
  evidenceHash: string;
  startedAt?: string;
  endedAt?: string;
  lastActiveAt?: string;
  cycleCount: number;
  summaryJson: string;
  errorJson?: string;
};

// ── Observation ─────────────────────────────────────────────────────────────

export type ObservationKind =
  "new_signal" | "risk" | "opportunity" | "missing_data" | "repeated_pattern" | "no_change";

export type AgentObservation = {
  observationId: string;
  sellerId: string;
  agentId: string;
  sessionId: string;
  kind: ObservationKind;
  summary: string;
  severity: "info" | "warning" | "critical";
  metadataJson: string;
};

// ── Lesson ──────────────────────────────────────────────────────────────────

export type AgentLesson = {
  lessonId: string;
  sellerId: string;
  agentId: string;
  sessionId: string;
  lesson: string;
  transferable: boolean;
  learnedAt: string;
};

// ── Wake policy ─────────────────────────────────────────────────────────────

export type AgentWakeDecision = {
  shouldWake: boolean;
  reason: string;
  signalsHash: string;
};

export type SignalDelta = {
  added: string[];
  removed: string[];
  unchanged: string[];
};

// ── Cache-friendly prompt ───────────────────────────────────────────────────

/** The cacheable prefix (layers 1-6) — static per agent+account configuration. */
export type StablePromptBlock = string;

/** The per-cycle variable evidence (layers 7-9) — changes on every cycle. */
export type VariableEvidenceBlock = string;

export type AgentWorkPrompt = {
  stablePrefix: StablePromptBlock;
  variableEvidence: VariableEvidenceBlock;
  stablePromptHash: string;
  evidenceHash: string;
};

// ── Shift summary (store output, not persisted as a separate type) ──────────

export type ShiftSummary = {
  sellerId: string;
  since: string;
  until: string;
  sessionCount: number;
  observationCounts: Record<ObservationKind, number>;
  proposalCount: number;
  lessonCount: number;
  completedSessionIds: string[];
};
