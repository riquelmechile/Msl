import { describe, expect, it } from "vitest";

import type {
  AgentProposal,
  ConversationMessage,
  ConversationState,
  DecoyProposal,
  ProbeAlert,
  ProbeOutcome,
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
    expect(toolMsg.toolCalls![0]!.name).toBe("get_business_context");

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

// ── Honey-Pot Probing types ─────────────────────────────────────────

describe("ProbeAlert", () => {
  it("is constructable with required fields", () => {
    const alert: ProbeAlert = {
      pattern: "question_spike",
      confidence: 0.85,
      description: "Múltiples preguntas sobre precios en un lapso de 60s.",
    };

    expect(alert.pattern).toBe("question_spike");
    expect(alert.confidence).toBe(0.85);
    expect(alert.description).toBe("Múltiples preguntas sobre precios en un lapso de 60s.");
  });

  it("supports optional competitorId and recommendedAction", () => {
    const alert: ProbeAlert = {
      pattern: "new_competitor",
      confidence: 0.7,
      competitorId: "TiendaX",
      description: "Apareció un nuevo competidor en la categoría.",
      recommendedAction: "monitor",
    };

    expect(alert.competitorId).toBe("TiendaX");
    expect(alert.recommendedAction).toBe("monitor");
  });
});

describe("DecoyProposal", () => {
  it("requires id, type, description, riskLevel, tosCompliant, and tosWarning", () => {
    const proposal: DecoyProposal = {
      id: "decoy-001",
      type: "price_probe",
      description: "Listing señuelo con precio 15% menor al promedio.",
      riskLevel: "medium",
      tosCompliant: true,
      tosWarning:
        "⚠️ Las operaciones de contrainteligencia deben cumplir con los Términos y Condiciones de MercadoLibre. No se permite la creación de listings falsos o engañosos.",
    };

    expect(proposal.id).toBe("decoy-001");
    expect(proposal.type).toBe("price_probe");
    expect(proposal.riskLevel).toBe("medium");
    expect(proposal.tosCompliant).toBe(true);
    expect(proposal.tosWarning).toContain("MercadoLibre");
  });

  it("always carries a populated tosWarning", () => {
    const proposal: DecoyProposal = {
      id: "decoy-002",
      type: "stock_signal",
      description: "Señal de stock bajo para atraer competidores.",
      riskLevel: "high",
      tosCompliant: false,
      tosWarning:
        "Este tipo de operación puede violar los TOS de ML si no se maneja con transparencia.",
    };

    // Regaurdless of tosCompliant, tosWarning MUST be populated
    expect(proposal.tosWarning.length).toBeGreaterThan(0);
  });
});

describe("ProbeOutcome", () => {
  it("captures success/failure and optional competitor reaction", () => {
    const outcome: ProbeOutcome = {
      proposalId: "decoy-001",
      success: true,
      competitorReaction: "Competidor bajó su precio en 5% a las 2h del deploy.",
      learnedAt: "2026-06-26T14:00:00Z",
    };

    expect(outcome.proposalId).toBe("decoy-001");
    expect(outcome.success).toBe(true);
    expect(outcome.competitorReaction).toContain("Competidor");
    expect(outcome.learnedAt).toBe("2026-06-26T14:00:00Z");
  });

  it("omits competitorReaction when none is observed", () => {
    const outcome: ProbeOutcome = {
      proposalId: "decoy-003",
      success: false,
      learnedAt: "2026-06-26T14:00:00Z",
    };

    expect(outcome.competitorReaction).toBeUndefined();
  });
});
