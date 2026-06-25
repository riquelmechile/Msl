import { describe, expect, it } from "vitest";

import { evaluateCreativeOpportunities, prepareCreativeDraft } from "./index.js";

describe("creative opportunity radar", () => {
  it("presents fitting MLC opportunities and down-ranks or suppresses weak fits", () => {
    const ranked = evaluateCreativeOpportunities([
      {
        id: "mlc-fit",
        title: "Short product demo",
        sellerValue: "Mejora confianza visual para compradores MLC.",
        effort: "low",
        risk: "low",
        suggestedExperiment: "Test A/B con una publicación de alto margen.",
        fitsSellerModel: true,
        marketplace: "MLC",
      },
      {
        id: "other-market",
        title: "Trend outside Chile",
        sellerValue: "Could help another marketplace.",
        effort: "low",
        risk: "low",
        suggestedExperiment: "No MLC experiment.",
        fitsSellerModel: true,
        marketplace: "other",
      },
      {
        id: "bad-fit",
        title: "High-risk content",
        sellerValue: "Potentially viral.",
        effort: "medium",
        risk: "high",
        suggestedExperiment: "Risky public content.",
        fitsSellerModel: false,
        marketplace: "MLC",
      },
    ]);

    expect(ranked.map((opportunity) => [opportunity.id, opportunity.disposition])).toEqual([
      ["mlc-fit", "present"],
      ["bad-fit", "downrank"],
      ["other-market", "suppress"],
    ]);
  });
});

describe("creative draft preparation", () => {
  it("creates preview metadata without generating or publishing assets", () => {
    const draft = prepareCreativeDraft({
      id: "creative-1",
      sellerId: "seller-1",
      listingId: "MLC123",
      type: "short-video",
      usageIntent: "mejorar conversión de publicación",
      expectedListingBenefit: "más confianza antes de comprar",
      concept: "Video corto mostrando uso real del producto",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    expect(draft.preview.metadata).toEqual({
      usageIntent: "mejorar conversión de publicación",
      expectedListingBenefit: "más confianza antes de comprar",
      generatedAsset: false,
      publicationStatus: "draft-only",
    });
    expect(draft.publicationAction).toMatchObject({
      kind: "creative-publication",
      approvalStatus: "pending",
      riskLevel: "high",
    });
  });
});
