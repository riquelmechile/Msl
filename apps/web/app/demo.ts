import { answerBusinessQuestion } from "@msl/agent";
import { evaluateOAuthAccess, type OAuthTokenState } from "@msl/mercadolibre";
import { createPreparedActionTool, createInMemoryApprovalQueueRepository } from "@msl/tools";
import { generateDailySummary, prepareCreativeDraft } from "@msl/workers";

export type DemoViewModel = {
  advice: {
    answer: string;
    recommendation: string;
    rationale: ReadonlyArray<string>;
  };
  access: {
    connectedSite: "MLC";
    revokedMessage: string;
  };
  summary: {
    generatedAt: string;
    priorities: ReadonlyArray<{
      rank: number;
      title: string;
      reason: string;
      tradeoff: string;
      confidence: string;
      staleDataDisclosure: string | null;
    }>;
  };
  action: {
    id: string;
    exactChange: string;
    rationale: string;
    risk: string;
    blockedAudit: string;
  };
  creative: {
    title: string;
    usageIntent: string;
    expectedListingBenefit: string;
    storyboard: ReadonlyArray<string>;
    publicationStatus: string;
  };
};

const now = new Date("2026-06-25T12:00:00.000Z");
const sellerId = "seller-mlc-demo";

export async function buildDemoViewModel(): Promise<DemoViewModel> {
  const advice = answerBusinessQuestion({
    context: {
      sellerId,
      knownFacts: ["Opera en MLC", "Prioriza margen antes que volumen sin rentabilidad"],
      learnedPreferences: [
        {
          topic: "margin",
          preference: "proteger margen mínimo antes de competir por precio",
          learnedFrom: "correction",
          riskLevel: "low",
        },
      ],
    },
    request: {
      sellerId,
      question: "¿Conviene bajar el precio del producto con más visitas?",
      topic: "margin",
      availableContext: ["current price", "margin", "sales"],
      requiredContext: ["current price", "margin", "sales"],
    },
  });

  const connectedAccess = evaluateOAuthAccess(
    tokenState({ status: "connected", expiresAt: new Date("2026-06-25T13:00:00.000Z") }),
    now,
  );
  const revokedAccess = evaluateOAuthAccess(
    tokenState({ status: "revoked", expiresAt: new Date("2026-06-25T13:00:00.000Z") }),
    now,
  );

  const summary = generateDailySummary({
    now,
    candidates: [
      {
        id: "margin-watch",
        title: "Revisar margen antes de bajar precio",
        businessReason: "El producto tiene visitas, pero el costo del proveedor deja poco espacio.",
        expectedTradeoff:
          "Puede mejorar conversión, aunque reduce utilidad si no se valida el costo.",
        profitImpact: 9,
        urgency: 7,
        reputationRisk: 4,
        confidence: "high",
        signalKind: "pricing",
        capturedAt: new Date("2026-06-25T11:45:00.000Z"),
      },
      {
        id: "claim-watch",
        title: "Responder reclamo pendiente hoy",
        businessReason: "Un reclamo sin respuesta puede afectar reputación y visibilidad.",
        expectedTradeoff: "Priorizar soporte reduce riesgo antes de optimizar precio.",
        profitImpact: 4,
        urgency: 10,
        reputationRisk: 10,
        confidence: "medium",
        signalKind: "claim",
        capturedAt: new Date("2026-06-25T10:45:00.000Z"),
      },
    ],
  });

  const repository = createInMemoryApprovalQueueRepository();
  const actionTool = createPreparedActionTool({ repository, clock: { now: () => now } });
  const prepared = await actionTool.execute({
    id: "action-price-001",
    sellerId,
    kind: "price-change",
    target: { type: "listing", listingId: "MLC-001" },
    exactChange: [{ field: "price", from: 12990, to: 12490 }],
    rationale: "Probar una baja acotada sin romper el margen mínimo aprendido.",
    expiresAt: new Date("2026-06-26T12:00:00.000Z"),
  });

  const creativeDraft = prepareCreativeDraft({
    id: "creative-001",
    sellerId,
    listingId: "MLC-001",
    type: "photo-improvement",
    usageIntent: "mejorar la confianza visual de la publicación principal",
    expectedListingBenefit: "más claridad del producto y mayor intención de compra",
    concept: "Foto principal con fondo limpio y beneficio visible",
    expiresAt: new Date("2026-06-26T12:00:00.000Z"),
  });

  return {
    advice: {
      answer: advice.answer,
      recommendation: advice.recommendation ?? "Sin recomendación disponible.",
      rationale: advice.rationale,
    },
    access: {
      connectedSite: connectedAccess.allowed ? connectedAccess.site : "MLC",
      revokedMessage: revokedAccess.allowed
        ? "La cuenta está conectada."
        : "Conexión vencida o revocada. Vuelve a conectar MercadoLibre para ver datos protegidos.",
    },
    summary: {
      generatedAt: summary.generatedAt.toISOString(),
      priorities: summary.priorities.map((priority) => ({
        rank: priority.rank,
        title: priority.title,
        reason: priority.businessReason,
        tradeoff: priority.expectedTradeoff,
        confidence: priority.confidence,
        staleDataDisclosure: priority.staleDataDisclosure,
      })),
    },
    action: {
      id: prepared.data.action.id,
      exactChange: "Precio: $12.990 → $12.490",
      rationale: prepared.data.action.rationale,
      risk: prepared.data.highlightedRisk,
      blockedAudit: "Ejecución bloqueada: falta aprobación explícita del vendedor.",
    },
    creative: {
      title: creativeDraft.preview.title,
      usageIntent: creativeDraft.preview.metadata.usageIntent,
      expectedListingBenefit: creativeDraft.preview.metadata.expectedListingBenefit,
      storyboard: creativeDraft.preview.storyboard,
      publicationStatus: "Borrador solamente; publicación pendiente de aprobación humana.",
    },
  };
}

function tokenState(input: {
  status: OAuthTokenState["status"];
  expiresAt: Date;
}): OAuthTokenState {
  return {
    sellerId,
    site: "MLC",
    accessToken: "demo-token-no-real-credential",
    scopes: ["read", "offline_access"],
    status: input.status,
    connectedAt: new Date("2026-06-25T09:00:00.000Z"),
    expiresAt: input.expiresAt,
  };
}
