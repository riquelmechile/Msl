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
