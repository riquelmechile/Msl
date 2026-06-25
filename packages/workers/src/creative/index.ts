import { createPreparedAction, type PreparedAction, type SellerId } from "@msl/domain";

export type CreativeOpportunity = {
  id: string;
  title: string;
  sellerValue: string;
  effort: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  suggestedExperiment: string;
  fitsSellerModel: boolean;
  marketplace: "MLC" | "other";
};

export type RankedCreativeOpportunity = CreativeOpportunity & {
  rank: number;
  disposition: "present" | "downrank" | "suppress";
  rationale: string;
};

export type CreativeDraftRequest = {
  id: string;
  sellerId: SellerId;
  listingId: string;
  type: "photo-improvement" | "short-video" | "reels-style-concept";
  usageIntent: string;
  expectedListingBenefit: string;
  concept: string;
  expiresAt: Date;
};

export type CreativeDraft = {
  id: string;
  sellerId: SellerId;
  listingId: string;
  type: CreativeDraftRequest["type"];
  preview: {
    title: string;
    storyboard: ReadonlyArray<string>;
    metadata: {
      usageIntent: string;
      expectedListingBenefit: string;
      generatedAsset: false;
      publicationStatus: "draft-only";
    };
  };
  publicationAction: PreparedAction;
};

const effortWeight: Record<CreativeOpportunity["effort"], number> = {
  low: 3,
  medium: 2,
  high: 1,
};

const riskWeight: Record<CreativeOpportunity["risk"], number> = {
  low: 3,
  medium: 2,
  high: 1,
};

export function evaluateCreativeOpportunities(
  opportunities: ReadonlyArray<CreativeOpportunity>,
): ReadonlyArray<RankedCreativeOpportunity> {
  return opportunities
    .map((opportunity) => {
      const disposition = creativeDisposition(opportunity);
      return {
        ...opportunity,
        rank: 0,
        disposition,
        rationale: creativeRationale(opportunity, disposition),
      };
    })
    .sort((left, right) => opportunityScore(right) - opportunityScore(left))
    .map((opportunity, index) => ({ ...opportunity, rank: index + 1 }));
}

export function prepareCreativeDraft(request: CreativeDraftRequest): CreativeDraft {
  const publicationAction = createPreparedAction({
    id: `${request.id}:publication`,
    sellerId: request.sellerId,
    kind: "creative-publication",
    target: { type: "creative-asset", assetId: request.id },
    exactChange: [
      { field: "listingId", from: null, to: request.listingId },
      { field: "creativeConcept", from: null, to: request.concept },
    ],
    rationale: `Publicar borrador creativo para ${request.usageIntent}.`,
    expiresAt: request.expiresAt,
  });

  return {
    id: request.id,
    sellerId: request.sellerId,
    listingId: request.listingId,
    type: request.type,
    preview: {
      title: request.concept,
      storyboard: buildStoryboard(request),
      metadata: {
        usageIntent: request.usageIntent,
        expectedListingBenefit: request.expectedListingBenefit,
        generatedAsset: false,
        publicationStatus: "draft-only",
      },
    },
    publicationAction,
  };
}

function creativeDisposition(
  opportunity: CreativeOpportunity,
): RankedCreativeOpportunity["disposition"] {
  if (opportunity.marketplace !== "MLC") {
    return "suppress";
  }

  if (!opportunity.fitsSellerModel || opportunity.risk === "high") {
    return "downrank";
  }

  return "present";
}

function creativeRationale(
  opportunity: CreativeOpportunity,
  disposition: RankedCreativeOpportunity["disposition"],
): string {
  if (disposition === "suppress") {
    return "No se presenta porque no corresponde a MercadoLibre Chile.";
  }

  if (disposition === "downrank") {
    return "Se baja prioridad porque el ajuste al modelo del vendedor o el riesgo no son ideales.";
  }

  return `${opportunity.sellerValue} Experimento sugerido: ${opportunity.suggestedExperiment}.`;
}

function opportunityScore(opportunity: RankedCreativeOpportunity): number {
  const dispositionWeight =
    opportunity.disposition === "present" ? 10 : opportunity.disposition === "downrank" ? 3 : -10;

  return dispositionWeight + effortWeight[opportunity.effort] + riskWeight[opportunity.risk];
}

function buildStoryboard(request: CreativeDraftRequest): ReadonlyArray<string> {
  if (request.type === "photo-improvement") {
    return [
      "Mostrar producto limpio y centrado.",
      "Resaltar beneficio principal.",
      "Cerrar con confianza de compra.",
    ];
  }

  return [
    "Abrir con problema del comprador.",
    request.concept,
    "Cerrar con beneficio y llamado a revisar la publicación.",
  ];
}
