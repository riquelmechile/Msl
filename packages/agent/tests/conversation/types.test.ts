import { describe, expect, it } from "vitest";

import type {
  AgentProposal,
  ConversationMessage,
  ConversationState,
  StreamingChunk,
} from "../../src/conversation/types.js";

describe("ConversationMessage", () => {
  it("is constructable with required fields", () => {
    const msg: ConversationMessage = {
      role: "user",
      content: "Hola, ¿cómo están las ventas hoy?",
      timestamp: new Date("2026-06-26T10:00:00Z"),
    };

    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hola, ¿cómo están las ventas hoy?");
    expect(msg.timestamp).toBeInstanceOf(Date);
  });

  it("supports optional toolCalls and toolCallId", () => {
    const toolMsg: ConversationMessage = {
      role: "assistant",
      content: "Voy a consultar el contexto del negocio.",
      timestamp: new Date(),
      toolCalls: [
        {
          id: "call_1",
          name: "get_business_context",
          arguments: { query: "ventas hoy" },
        },
      ],
    };

    expect(toolMsg.toolCalls).toHaveLength(1);
    expect(toolMsg.toolCalls![0].name).toBe("get_business_context");

    const response: ConversationMessage = {
      role: "tool",
      content: JSON.stringify({ totalSales: 5000000 }),
      timestamp: new Date(),
      toolCallId: "call_1",
    };

    expect(response.role).toBe("tool");
    expect(response.toolCallId).toBe("call_1");
  });
});

describe("AgentProposal", () => {
  it("maps to PreparedAction shape with naturalSummary and riskLevel", () => {
    const proposal: AgentProposal = {
      action: {
        id: "prop-1",
        sellerId: "seller-1",
        kind: "price-change",
        target: { type: "listing", listingId: "MLC-123" },
        exactChange: [{ field: "price", from: 15000, to: 13500 }],
        rationale: "Competencia bajó el precio en 10% esta semana.",
        expiresAt: new Date("2026-06-27T12:00:00Z"),
      },
      naturalSummary: "¿Bajo el precio del listing MLC-123 en 10%?",
      riskLevel: "medium",
    };

    expect(proposal.action.kind).toBe("price-change");
    expect(proposal.naturalSummary).toContain("MLC-123");
    expect(proposal.riskLevel).toBe("medium");
    // action must NOT have approvalStatus or riskLevel (those are
    // derived later in the pipeline)
    expect("approvalStatus" in proposal.action).toBe(false);
    expect("riskLevel" in proposal.action).toBe(false);
  });
});

describe("StreamingChunk", () => {
  it("carries delta text and completion flag", () => {
    const chunk: StreamingChunk = { delta: "Hola, ", done: false };
    expect(chunk.delta).toBe("Hola, ");
    expect(chunk.done).toBe(false);

    const final: StreamingChunk = { delta: "", done: true };
    expect(final.done).toBe(true);
  });
});

describe("ConversationState", () => {
  it("tracks messages, context window limit, and session metadata", () => {
    const state: ConversationState = {
      messages: [
        {
          role: "system",
          content: "Eres un asistente comercial.",
          timestamp: new Date("2026-06-26T10:00:00Z"),
        },
        {
          role: "user",
          content: "¿Cómo van las ventas?",
          timestamp: new Date("2026-06-26T10:01:00Z"),
        },
      ],
      contextWindowLimit: 20,
      sessionMetadata: {
        sellerId: "seller-1",
        startedAt: new Date("2026-06-26T10:00:00Z"),
        lastActivityAt: new Date("2026-06-26T10:01:00Z"),
      },
    };

    expect(state.messages).toHaveLength(2);
    expect(state.contextWindowLimit).toBe(20);
    expect(state.sessionMetadata.sellerId).toBe("seller-1");
    expect(state.sessionMetadata.startedAt).toBeInstanceOf(Date);
  });
});
