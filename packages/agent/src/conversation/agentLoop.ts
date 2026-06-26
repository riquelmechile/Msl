import type { AgentProposal, ConversationMessage, ConversationState, StreamingChunk } from "./types.js";
import { spanishValidator, harmfulContentFilter } from "./guardrails.js";

/**
 * The result of a single turn of the agent conversation loop.
 */
export type ConverseResult = {
  /** The assistant's Spanish text response. */
  response: string;
  /** Updated conversation state reflecting the new messages. */
  updatedState: ConversationState;
  /** An optional action proposal the seller must confirm before execution. */
  proposal?: AgentProposal;
};

/**
 * Configuration for the agent loop factory.
 */
export type AgentLoopConfig = {
  /** The system prompt (Block A) to use for identity and hard rules. */
  systemPrompt: string;
  /** When true, uses an internal mock LLM client instead of a real API. */
  mockClient?: boolean;
};

/**
 * A minimal LLM client interface consumed by the agent loop.
 *
 * In production this wraps the OpenAI/DeepSeek chat completions API.
 * For testing, `mockClient: true` activates an internal mock.
 */
export type LlmClient = {
  chat(
    messages: Array<{ role: string; content: string }>,
  ): Promise<{ content: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }> }>;
};

/**
 * Creates an agent loop instance.
 *
 * The agent loop orchestrates a single conversational turn:
 *   1. Validate input (Spanish-only, no harmful content)
 *   2. Build the messages array (cache strategy)
 *   3. Send to LLM (mock or real)
 *   4. Parse response for action proposals
 *   5. Update conversation state
 */
export function createAgentLoop(config: AgentLoopConfig) {
  const client: LlmClient = config.mockClient
    ? createMockClient()
    : createNoopClient();

  return {
    /**
     * Process a single user message through the agent conversation loop.
     *
     * @param userMessage — The seller's latest message in Spanish.
     * @param state — The current conversation state (may be empty on first turn).
     * @returns The agent's response, optional proposal, and updated state.
     */
    async converse(
      userMessage: string,
      state: ConversationState,
    ): Promise<ConverseResult> {
      // --- Input guardrails ---
      const spanishCheck = spanishValidator(userMessage);
      if (!spanishCheck.passed) {
        return blockAndRespond(state, userMessage, spanishCheck.reason);
      }

      const harmfulCheck = harmfulContentFilter(userMessage);
      if (!harmfulCheck.passed) {
        return blockAndRespond(state, userMessage, harmfulCheck.reason);
      }

      // --- Build messages array ---
      const systemMsg: Array<{ role: string; content: string }> = [
        { role: "system", content: config.systemPrompt },
      ];

      // Append conversation history (only user/assistant roles).
      const historyMsgs: Array<{ role: string; content: string }> = [];
      for (const msg of state.messages) {
        if (msg.role === "user" || msg.role === "assistant") {
          historyMsgs.push({ role: msg.role, content: msg.content });
        }
      }

      // Current user message.
      const userMsg = { role: "user" as const, content: userMessage };

      const llmMessages = [...systemMsg, ...historyMsgs, userMsg];

      // --- Send to LLM ---
      const llmResponse = await client.chat(llmMessages);

      // --- Parse response ---
      const responseText = llmResponse.content;
      let proposal: AgentProposal | undefined;

      // Check if the LLM requested tool calls (prepare_action).
      if (
        llmResponse.toolCalls &&
        llmResponse.toolCalls.length > 0
      ) {
        const toolCall = llmResponse.toolCalls[0]!;
        if (toolCall.name === "prepare_action") {
          proposal = parseProposalFromToolCall(toolCall.arguments);
        }
      }

      // If the user said "dale" / "sí" / "ok" and there's a pending proposal
      // in the state, confirm execution.
      if (isConfirmation(userMessage)) {
        const pendingProposal = extractPendingProposal(state.messages);
        if (pendingProposal) {
          proposal = pendingProposal;
        }
      }

      // --- Update state ---
      const now = new Date();
      const newMessages: ConversationMessage[] = [
        ...state.messages,
        {
          role: "user",
          content: userMessage,
          timestamp: now,
        },
        {
          role: "assistant",
          content: responseText,
          timestamp: now,
        },
      ];

      // Enforce context window limit: evict oldest messages first.
      const trimmedMessages = enforceContextWindow(
        newMessages,
        state.contextWindowLimit,
      );

      const updatedState: ConversationState = {
        messages: trimmedMessages,
        contextWindowLimit: state.contextWindowLimit,
        sessionMetadata: {
          ...state.sessionMetadata,
          lastActivityAt: now,
        },
      };

      return { response: responseText, updatedState, ...(proposal !== undefined ? { proposal } : {}) };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock LLM client
// ---------------------------------------------------------------------------

function createMockClient(): LlmClient {
  return {
    async chat(
      messages: Array<{ role: string; content: string }>,
    ): Promise<{
      content: string;
      toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
    }> {
      // Extract the last user message.
      const userMsgs = messages.filter((m) => m.role === "user");
      const lastUser =
        userMsgs.length > 0
          ? userMsgs[userMsgs.length - 1]!.content.toLowerCase()
          : "";

      // Intent-based routing (mock behavior, no real LLM call).
      if (/precio|margen/.test(lastUser)) {
        return {
          content:
            "Analicé tus márgenes actuales. El margen promedio de la tienda " +
            "es 32.4%. En la categoría Hogar y Muebles, los márgenes están entre " +
            "28% y 38%. Veo 89 listings con precio por encima del promedio de " +
            "categoría que podrían estar perdiendo visibilidad. ¿Querés que te " +
            "prepare una propuesta de ajuste de precios para esos listings?",
        };
      }

      if (/reclamo|reputación/.test(lastUser)) {
        return {
          content:
            "Revisé tu situación actual de reclamos. Tenés 3 reclamos abiertos: " +
            "1 en mediación y 2 esperando tu respuesta. Tu tasa de reclamos es " +
            "0.4%, muy por debajo del promedio de categoría (1.2%), así que tu " +
            "reputación está bien protegida. Te recomiendo priorizar los 2 reclamos " +
            "en espera — si no respondés en 24h, pueden escalar a mediación. " +
            "¿Querés que te ayude a redactar las respuestas?",
        };
      }

      if (/dale|sí\b|sí,|ok\b|confirmo|confirmar|ejecutá|ejecutar/i.test(lastUser)) {
        return {
          content:
            "¡Perfecto! La acción fue confirmada y quedó registrada. " +
            "Se ejecutará en los próximos minutos. ¿Necesitás algo más?",
        };
      }

      // Default: ask a clarifying question in Spanish.
      return {
        content:
          "Entendido. Para poder ayudarte mejor, ¿podrías contarme un poco más? " +
          "Por ejemplo: ¿querés revisar ventas, márgenes, reputación, reclamos, " +
          "o prioridades del día? También puedo prepararte una acción concreta " +
          "si ya tenés claro qué necesitás.",
      };
    },
  };
}

function createNoopClient(): LlmClient {
  return {
    async chat(): Promise<{ content: string }> {
      return {
        content: "Lo siento, el servicio de IA no está disponible en este momento.",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blockAndRespond(
  state: ConversationState,
  _userMessage: string,
  reason: string | undefined,
): ConverseResult {
  const now = new Date();
  const responseText = reason
    ? `⛔ ${reason}`
    : "⛔ Mensaje bloqueado por razones de seguridad.";

  return {
    response: responseText,
    updatedState: {
      ...state,
      messages: [
        ...state.messages,
        {
          role: "user",
          content: "[mensaje bloqueado]",
          timestamp: now,
        },
        {
          role: "assistant",
          content: responseText,
          timestamp: now,
        },
      ],
      sessionMetadata: {
        ...state.sessionMetadata,
        lastActivityAt: now,
      },
    },
  };
}

function isConfirmation(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return /^(dale|s[iíí]|ok|confirmo|confirmar|ejecut[áa]|ejecutar)\b/.test(trimmed);
}

/**
 * Extracts a pending AgentProposal from the conversation history.
 *
 * Searches recent assistant messages for a serialized proposal pattern.
 * This is a simple heuristic for the mock implementation; in production
 * the state would carry pending proposals explicitly.
 */
function extractPendingProposal(
  messages: ConversationMessage[],
): AgentProposal | undefined {
  // Search recent messages (last 5) for proposal patterns.
  const recent = messages.slice(-5);
  for (const msg of recent) {
    if (msg.role === "assistant" && msg.content.includes("propuesta de ajuste")) {
      return {
        action: {
          id: "prop-pending",
          sellerId: "seller-1",
          kind: "price-change",
          target: { type: "listing", listingId: "MLC-42" },
          exactChange: [{ field: "price", from: 15000, to: 13500 }],
          rationale: "Ajuste recomendado por análisis de margen.",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        naturalSummary: "¿Bajo el precio del listing MLC-42 en 10%?",
        riskLevel: "medium",
      };
    }
  }
  return undefined;
}

/**
 * Parses an AgentProposal from tool call arguments.
 */
function parseProposalFromToolCall(
  args: Record<string, unknown>,
): AgentProposal {
  const kind = String(args.kind ?? "price-change") as AgentProposal["action"]["kind"];
  const targetType = String(args.targetType ?? "listing");
  const targetId = String(args.targetId ?? "");

  const target: AgentProposal["action"]["target"] =
    targetType === "listing"
      ? { type: "listing", listingId: targetId }
      : targetType === "order"
        ? { type: "order", orderId: targetId }
        : targetType === "message"
          ? { type: "message", threadId: targetId }
          : { type: "creative-asset", assetId: targetId };

  return {
    action: {
      id: String(args.id ?? ""),
      sellerId: String(args.sellerId ?? ""),
      kind,
      target,
      exactChange: [
        {
          field: String(args.field ?? ""),
          from: (args.fromValue as string | number | boolean | null) ?? null,
          to: (args.toValue as string | number | boolean | null) ?? null,
        },
      ],
      rationale: String(args.rationale ?? ""),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    naturalSummary: String(args.summary ?? ""),
    riskLevel: "medium",
  };
}

/**
 * Enforces the context window limit by evicting the oldest messages.
 *
 * Always preserves the system message (role === "system") and keeps
 * at most `limit` total messages. Evicts oldest user/assistant messages
 * first when the limit is exceeded.
 */
function enforceContextWindow(
  messages: ConversationMessage[],
  limit: number,
): ConversationMessage[] {
  if (messages.length <= limit) {
    return messages;
  }

  const systemMessages = messages.filter((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");

  // Evict from the front (oldest) of non-system messages.
  const overflow = otherMessages.length - (limit - systemMessages.length);
  if (overflow <= 0) {
    return messages;
  }

  const keptOther = otherMessages.slice(overflow);
  return [...systemMessages, ...keptOther];
}
