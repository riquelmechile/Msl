import type { PreparedAction, RiskLevel, SellerId } from "@msl/domain";

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
  | "competitor";

/** A single structured rule extracted from CEO natural-language text. */
export interface ParsedRule {
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
}

/** A persisted strategy with lifecycle tracking. */
export interface Strategy {
  id: number;
  ruleType: RuleType;
  /** Raw CEO directive text. */
  ruleText: string;
  /** Structured parse result. */
  parsedRule: ParsedRule;
  /** Extraction confidence 0.0-1.0. */
  confidence: number;
  status: "active" | "archived" | "superseded";
  createdAt: string;
  updatedAt: string;
}

/** Result of parsing CEO strategy text. */
export interface ParseResult {
  /** Successfully extracted rules. */
  rules: ParsedRule[];
  /** Text fragments that could not be parsed into rules. */
  unparsed: string[];
  /** Aggregate confidence across all extracted rules (0.0-1.0). */
  confidence: number;
}
