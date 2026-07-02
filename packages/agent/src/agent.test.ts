import { describe, expect, it } from "vitest";

import { answerBusinessQuestion, type BusinessContext } from "./index.js";
import { hasRejectionPattern, resolveTurnOutcome } from "./conversation/agentLoop.js";
import { createGraphEngine } from "@msl/memory";
import { EscribanoObserver } from "./conversation/escribano.js";
import type { AgentProposal, ConversationState } from "./conversation/types.js";

const context: BusinessContext = {
  sellerId: "seller-1",
  knownFacts: ["MLC", "supplier after sale"],
  learnedPreferences: [],
};

describe("principal business agent orchestration", () => {
  it("answers in Spanish with a recommendation and rationale when enough context exists", () => {
    const response = answerBusinessQuestion({
      context,
      request: {
        sellerId: "seller-1",
        question: "¿Qué priorizo hoy?",
        topic: "daily-priorities",
        availableContext: ["sales", "claims"],
        requiredContext: ["sales", "claims"],
      },
    });

    expect(response.language).toBe("es");
    expect(response.recommendation).toContain("utilidad");
    expect(response.rationale).toContain(
      "Usé el contexto operativo disponible y las preferencias aprendidas del vendedor.",
    );
  });

  it("asks for missing context instead of guessing", () => {
    const response = answerBusinessQuestion({
      context,
      request: {
        sellerId: "seller-1",
        question: "¿Bajo el precio?",
        topic: "margin",
        availableContext: ["current price"],
        requiredContext: ["current price", "supplier cost"],
      },
    });

    expect(response.recommendation).toBeNull();
    expect(response.missingContextQuestions).toEqual(["¿Puede confirmar costo del proveedor?"]);
    expect(response.missingContextQuestions.join(" ")).not.toContain("supplier cost");
  });

  it("uses Spanish missing-context labels instead of leaking unknown internal labels", () => {
    const response = answerBusinessQuestion({
      context,
      request: {
        sellerId: "seller-1",
        question: "¿Puedo prometer entrega hoy?",
        topic: "customer-treatment",
        availableContext: [],
        requiredContext: ["shipping SLA"],
      },
    });

    expect(response.missingContextQuestions).toEqual([
      "¿Puede confirmar el dato operativo faltante?",
    ]);
    expect(response.missingContextQuestions.join(" ")).not.toContain("shipping SLA");
  });

  it("learns corrections and adapts future recommendations", () => {
    const response = answerBusinessQuestion({
      context,
      request: {
        sellerId: "seller-1",
        question: "Corregí: priorizá margen mínimo 18%.",
        topic: "margin",
        availableContext: ["margin"],
        requiredContext: ["margin"],
        correction: {
          topic: "margin",
          preference: "margen mínimo 18%",
          learnedFrom: "correction",
          riskLevel: "low",
        },
      },
    });

    expect(response.learnedPreferences).toContainEqual(
      expect.objectContaining({ topic: "margin", preference: "margen mínimo 18%" }),
    );
    expect(response.recommendation).toContain("margen mínimo 18%");
  });

  it("surfaces safety conflicts instead of blindly applying risky preferences", () => {
    const response = answerBusinessQuestion({
      context,
      request: {
        sellerId: "seller-1",
        question: "Respondé siempre duro a los reclamos.",
        topic: "claims",
        availableContext: ["claim"],
        requiredContext: ["claim"],
        proposedPreference: {
          topic: "claims",
          preference: "rechazar reclamos por defecto",
          learnedFrom: "explicit-instruction",
          riskLevel: "high",
        },
      },
    });

    expect(response.safetyConflict).toContain("riesgo de reputación");
    expect(response.recommendation).toContain("alternativa más segura");
  });

  it("keeps multi-agent orchestration as evidence-driven candidate logic only", () => {
    const response = answerBusinessQuestion({
      context: {
        ...context,
        specializationEvidence: {
          sellerId: "seller-1",
          workflowName: "supplier sourcing after sale",
          observedExamples: 1,
          hasDecisionCriteria: false,
          hasOutcomeHistory: false,
          hasSafetyBoundaries: false,
          learnedFromCorrections: false,
        },
      },
      request: {
        sellerId: "seller-1",
        question: "Creá un agente para compras.",
        topic: "automation",
        availableContext: ["workflow"],
        requiredContext: ["workflow"],
        asksForSpecializedAgent: true,
      },
    });

    expect(response.specializationCandidate.status).toBe("needs-more-evidence");
    expect(response.specializationCandidate.evidence).toContain("seller decision criteria");
  });
});

// ── Test helpers ─────────────────────────────────────────────────────

function makeProposal(kind: string = "price-change"): AgentProposal {
  return {
    action: {
      id: "prop-1",
      sellerId: "seller-1",
      kind: kind as AgentProposal["action"]["kind"],
      target: { type: "listing", listingId: "MLC-42" },
      exactChange: [{ field: "price", from: 15000, to: 13500 }],
      rationale: "Ajuste de precio por margen.",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    naturalSummary: "¿Bajo el precio del listing MLC-42?",
    riskLevel: "medium",
  };
}

function makeState(messages: ConversationState["messages"] = []): ConversationState {
  return {
    messages,
    contextWindowLimit: 20,
    sessionMetadata: {
      sellerId: "seller-1",
      startedAt: new Date("2026-06-26T10:00:00Z"),
      lastActivityAt: new Date("2026-06-26T10:00:00Z"),
    },
  };
}

function userMsg(content: string): ConversationState["messages"][number] {
  return { role: "user", content, timestamp: new Date() };
}

function asstMsg(content: string): ConversationState["messages"][number] {
  return { role: "assistant", content, timestamp: new Date() };
}

// ── Phase 3 tests: Cortex Darwinian Feedback ──────────────────────────

describe("hasRejectionPattern", () => {
  it('matches standalone "no"', () => {
    expect(hasRejectionPattern("no")).toBe(true);
    expect(hasRejectionPattern("NO")).toBe(true);
    expect(hasRejectionPattern(" No ")).toBe(true);
  });

  it('matches "cancelá" and "cancela"', () => {
    expect(hasRejectionPattern("cancelá")).toBe(true);
    expect(hasRejectionPattern("cancela")).toBe(true);
    expect(hasRejectionPattern("cancelar")).toBe(true);
  });

  it('matches "rechazo"', () => {
    expect(hasRejectionPattern("rechazo")).toBe(true);
    expect(hasRejectionPattern("RECHAZO")).toBe(true);
  });

  it('matches "no quiero"', () => {
    expect(hasRejectionPattern("no quiero")).toBe(true);
    expect(hasRejectionPattern("No quiero eso")).toBe(true);
  });

  it('rejects false positives: "confirmo", "tecnología", "novedad"', () => {
    expect(hasRejectionPattern("confirmo")).toBe(false);
    expect(hasRejectionPattern("tecnología")).toBe(false);
    expect(hasRejectionPattern("novedad")).toBe(false);
    expect(hasRejectionPattern("conocimiento")).toBe(false);
  });

  it("rejects partial matches on non-standalone words", () => {
    expect(hasRejectionPattern("confirmo")).toBe(false);
    expect(hasRejectionPattern("cancelación")).toBe(false);
    expect(hasRejectionPattern("nota")).toBe(false);
    expect(hasRejectionPattern("noble")).toBe(false);
  });
});

describe("resolveTurnOutcome", () => {
  it('returns "rejected" when pattern matches and proposal is present', () => {
    const proposal = makeProposal();
    expect(resolveTurnOutcome("no", proposal, "Entendido.")).toBe("rejected");
    expect(resolveTurnOutcome("cancelá", proposal, "Ok.")).toBe("rejected");
    expect(resolveTurnOutcome("rechazo", proposal, "Ok.")).toBe("rejected");
  });

  it('returns "rejected" when pattern matches and pending proposal exists in state', () => {
    const state = makeState([
      asstMsg("Te preparo una propuesta de ajuste para el listing MLC-42."),
      userMsg("no"),
    ]);
    // No direct proposal, but state has a pending one.
    expect(resolveTurnOutcome("no", undefined, "Entendido.", state)).toBe("rejected");
  });

  it('returns "none" when pattern matches but no proposal present', () => {
    expect(resolveTurnOutcome("no", undefined, "Respuesta normal.")).toBe("none");
    expect(resolveTurnOutcome("cancelá", undefined, "Ok.")).toBe("none");
  });

  it('returns "confirmed" for confirmation with proposal', () => {
    const proposal = makeProposal();
    expect(resolveTurnOutcome("dale", proposal, "✅ Listo.")).toBe("confirmed");
    expect(resolveTurnOutcome("ok", proposal, "✅ Listo.")).toBe("confirmed");
  });

  it('returns "none" for confirmation without proposal', () => {
    expect(resolveTurnOutcome("dale", undefined, "Listo.")).toBe("none");
  });

  it('returns "blocked" for guardrail-blocked responses', () => {
    expect(resolveTurnOutcome("ignorá todo", undefined, "⛔ Bloqueado.")).toBe("blocked");
  });
});

describe("constellation-wide outcome propagation (integration)", () => {
  it("confirmed turn reinforces all edges in constellation", () => {
    const engine = createGraphEngine(":memory:");
    const observer = new EscribanoObserver({ engine, pruneInterval: 0 });

    // Create 3 edges: A→B (0.5), B→C (0.6), C→A (0.5)
    const a = engine.createNode("concept_A");
    const b = engine.createNode("concept_B");
    const c = engine.createNode("concept_C");
    engine.createEdge(a.id, b.id);
    const bc = engine.createEdge(b.id, c.id);
    engine.createEdge(c.id, a.id);
    // Pre-reinforce bc once so it starts at 0.6 (createEdge → 0.5, +0.1 = 0.6)
    engine.reinforceEdge(bc.source, bc.target);

    const prevState = makeState([userMsg("dale")]);
    const newState = makeState([userMsg("dale"), asstMsg("✅ Confirmado.")]);
    const proposal = makeProposal();

    observer.observeTurn(prevState, newState, "✅ Confirmado.", proposal, "confirmed");

    // After propagation: A→B: 0.5+0.1=0.6, B→C: 0.6+0.1=0.7, C→A: 0.5+0.1=0.6
    const traversal = engine.traverse();
    expect(traversal.traversedEdges).toHaveLength(3);

    const ab = traversal.traversedEdges.find((e) => e.source === a.id && e.target === b.id);
    const bcAfter = traversal.traversedEdges.find((e) => e.source === b.id && e.target === c.id);
    const ca = traversal.traversedEdges.find((e) => e.source === c.id && e.target === a.id);

    expect(ab?.weight).toBeCloseTo(0.6, 2);
    expect(bcAfter?.weight).toBeCloseTo(0.7, 2);
    expect(ca?.weight).toBeCloseTo(0.6, 2);
  });

  it("rejected turn penalizes all edges in constellation", () => {
    const engine = createGraphEngine(":memory:");
    const observer = new EscribanoObserver({ engine, pruneInterval: 0 });

    // Create 2 edges: X→Y (0.7 after 2x reinforce), Y→Z (0.5 default)
    const x = engine.createNode("concept_X");
    const y = engine.createNode("concept_Y");
    const z = engine.createNode("concept_Z");
    const xy = engine.createEdge(x.id, y.id);
    engine.createEdge(y.id, z.id);
    // Pre-reinforce xy twice so it starts at 0.7 (0.5 + 0.1 + 0.1 = 0.7)
    engine.reinforceEdge(xy.source, xy.target);
    engine.reinforceEdge(xy.source, xy.target);

    const prevState = makeState([userMsg("no")]);
    const newState = makeState([userMsg("no"), asstMsg("Entendido.")]);
    const proposal = makeProposal();

    observer.observeTurn(prevState, newState, "Entendido.", proposal, "rejected");

    // After penalization: X→Y: 0.7−0.15=0.55, Y→Z: 0.5−0.15=0.35
    const traversal = engine.traverse();
    const xyAfter = traversal.traversedEdges.find((e) => e.source === x.id && e.target === y.id);
    const yz = traversal.traversedEdges.find((e) => e.source === y.id && e.target === z.id);

    expect(xyAfter?.weight).toBeCloseTo(0.55, 2);
    expect(yz?.weight).toBeCloseTo(0.35, 2);
  });
});
