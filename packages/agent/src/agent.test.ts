import { describe, expect, it } from "vitest";

import { answerBusinessQuestion, type BusinessContext } from "./index.js";

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
