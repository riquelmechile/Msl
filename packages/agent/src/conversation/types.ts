import type { PreparedAction, RiskLevel, SellerId } from "@msl/domain";

// ── Autonomy Levels ─────────────────────────────────────────────────

/** Graduated autonomy levels controlling auto-execution permissions. */
export enum AutonomyLevel {
  /** Solo responde preguntas — no auto-execution. */
  CONSULTA = 0,
  /** Propone acciones, siempre pide "dale". */
  SUGIERE = 1,
  /** Propone + pre-llena detalles, pide "dale". */
  PREPARA = 2,
  /** Auto-aprueba acciones de bajo riesgo. */
  BAJO_RIESGO = 3,
  /** Auto-aprueba acciones de bajo y medio riesgo. */
  MEDIO_RIESGO = 4,
  /** Auto-aprueba todo salvo critical, notifica después. */
  FULL = 5,
}

/** Snapshot of KPI values recorded after an action execution. */
export type KpiSnapshot = {
  /** Autonomy level at the moment the KPI was recorded. */
  level: AutonomyLevel;
  /** 0-1 — whether the price respected the CEO margin strategy. */
  marginCompliance: number;
  /** 0-1 — fraction of actions that executed without error. */
  successRate: number;
  /** Count of safety guardrail violations recorded. */
  safetyViolations: number;
  /** 0-1 — accuracy of agent responses in this period. */
  responseAccuracy: number;
  /** ISO timestamp of when the snapshot was created. */
  timestamp: string;
  /** Optional seller scoping — the account this KPI belongs to. */
  sellerId?: string;
};

/** Recorded when the autonomy level drops due to KPI breaches. */
export type DegradationEvent = {
  /** Level before the degradation. */
  from: AutonomyLevel;
  /** Level after the degradation. */
  to: AutonomyLevel;
  /** Spanish explanation of which thresholds were breached. */
  reason: string;
  /** The KPI snapshot that triggered the evaluation. */
  kpiSnapshot: KpiSnapshot;
  /** ISO timestamp of when the degradation was recorded. */
  timestamp: string;
};

// ── Conversation Core ───────────────────────────────────────────────

/** Role of the message author in a conversation. */
export type ConversationRole = "user" | "assistant" | "system" | "tool";

/** A tool call requested by the assistant in a message. */
export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/** A single turn in the conversation. */
export type ConversationMessage = {
  role: ConversationRole;
  content: string;
  timestamp: Date;
  /** Assistant messages may include pending tool calls. */
  toolCalls?: ToolCall[];
  /** Tool messages carry the toolCallId they respond to. */
  toolCallId?: string;
};

/**
 * An action proposed by the agent that requires explicit seller approval
 * before execution.
 *
 * Maps LLM output into the domain's PreparedAction pipeline:
 *   AgentProposal → guardrail validation → PreparedAction → ApprovalRecord → AuditRecord
 */
export type AgentProposal = {
  /** The PreparedAction data without approvalStatus (always "pending") and riskLevel (validated separately). */
  action: Omit<PreparedAction, "approvalStatus" | "riskLevel">;
  /** Natural Spanish summary shown to the seller, e.g. "¿Bajo el precio del listing #42 en 10%?" */
  naturalSummary: string;
  /** Risk level the agent has assigned to this proposal. */
  riskLevel: RiskLevel;
};

/** A streaming delta from the LLM response. */
export type StreamingChunk = {
  /** Text delta from this chunk. */
  delta: string;
  /** Whether the stream has completed. */
  done: boolean;
};

/** Runtime state for an active conversation session. */
export type ConversationState = {
  messages: ConversationMessage[];
  /** Maximum messages retained in the context window (oldest evicted first). */
  contextWindowLimit: number;
  sessionMetadata: {
    sellerId: SellerId;
    startedAt: Date;
    lastActivityAt: Date;
  };
};

// ── CEO Strategy Injection ─────────────────────────────────────────

/**
 * Classification of a parsed CEO rule.
 *
 * Maps Spanish business directives into structured rule types
 * used by the strategy parser, store, and injection layers.
 */
export type RuleType =
  | "margin"
  | "stock"
  | "category"
  | "pricing"
  | "customer"
  | "competitive"
  | "priority"
  | "timing"
  | "competitor"
  | "probe";

/** A single structured rule extracted from CEO natural-language text. */
export type ParsedRule = {
  /** Which business domain the rule governs. */
  ruleType: RuleType;
  /** Semantic target label, e.g. "margen", "stock", "categoría". */
  target: string;
  /** Comparison or action operator, e.g. ">=", "<=", "priorizar", "evitar". */
  operator: string;
  /** The numeric or textual value, e.g. "50%", "+10", "electrónica". */
  value: string;
  /** Optional qualifier narrowing the scope, e.g. "productos estrella". */
  scope?: string;
  /** Importance 1-10; higher means more critical. */
  priority: number;
  /** The exact CEO text that produced this rule. */
  originalText: string;
};

/** A persisted strategy with lifecycle tracking. */
export type Strategy = {
  id: number;
  ruleType: RuleType;
  /** Raw CEO directive text. */
  ruleText: string;
  /** Structured parse result. */
  parsedRule: ParsedRule;
  /** Extraction confidence 0.0-1.0. */
  confidence: number;
  status: "active" | "archived" | "superseded";
  /** Optional seller scoping — NULL means global. */
  sellerId?: string;
  createdAt: string;
  updatedAt: string;
};

/** Result of parsing CEO strategy text. */
export type ParseResult = {
  /** Successfully extracted rules. */
  rules: ParsedRule[];
  /** Text fragments that could not be parsed into rules. */
  unparsed: string[];
  /** Aggregate confidence across all extracted rules (0.0-1.0). */
  confidence: number;
};

// ── Actor Models / Shadow Actors ──────────────────────────────────

/** Counter-party actor types for market simulation. */
export type ActorType = "comprador" | "proveedor" | "competidor";

/** Structured result from an actor simulation. */
export type SimulationResult = {
  actorType: ActorType;
  recommendation: string;
  confidence: number;
  rationale: string;
  simulationId: string;
};

/** Persisted actor simulation row. */
export type ActorSimulationRecord = {
  id: number;
  actorType: ActorType;
  query: string;
  /** JSON-serialized SimulationResult. */
  result: string;
  created_at: string;
};

// ── Honey-Pot Probing ──────────────────────────────────────────────

/** A structured alert generated when competitor probing behaviour is detected. */
export type ProbeAlert = {
  pattern: "question_spike" | "view_anomaly" | "price_reaction" | "new_competitor";
  /** Detection confidence 0-1. Threshold is 0.6. */
  confidence: number;
  /** Seller name or "unknown" when the competitor cannot be identified. */
  competitorId?: string;
  /** Spanish description of the detected activity. */
  description: string;
  /** Suggested counter-action, e.g. "deploy_decoy", "monitor". */
  recommendedAction?: string;
};

/** A honey-pot decoy operation proposed by the agent. */
export type DecoyProposal = {
  /** Unique identifier for this proposal. */
  id: string;
  /** Kind of decoy the agent proposes to deploy. */
  type: "price_probe" | "category_entry" | "stock_signal";
  /** Spanish description explaining the decoy operation. */
  description: string;
  /** Risk assessment for this specific decoy. */
  riskLevel: "low" | "medium" | "high";
  /** Whether the proposal respects MercadoLibre TOS. */
  tosCompliant: boolean;
  /** MANDATORY — Spanish ML TOS reminder, ALWAYS populated. */
  tosWarning: string;
};

// ── El Escribano — Memory Scribe ──────────────────────────────────

/** Configuration for the Escribano memory scribe observer. */
export type EscribanoConfig = {
  /** Cortex graph engine for Hebbian writes. */
  engine: import("@msl/memory").GraphEngine;
  /** Trigger Darwinian pruning every N turns (default 10, 0 to disable). */
  pruneInterval?: number;
  /** Maximum concept nodes before FIFO cleanup (default 5000). */
  maxConceptNodes?: number;
};

/** Outcome of a conversation turn from the observer's perspective. */
export type TurnOutcome = "confirmed" | "rejected" | "blocked" | "none";

/** Outcome recorded after a decoy proposal is executed. */
export type ProbeOutcome = {
  /** References the DecoyProposal.id that was executed. */
  proposalId: string;
  /** Whether the decoy successfully elicited competitor behaviour. */
  success: boolean;
  /** Observed competitor reaction, if any. */
  competitorReaction?: string;
  /** ISO timestamp of when the outcome was recorded. */
  learnedAt: string;
};
