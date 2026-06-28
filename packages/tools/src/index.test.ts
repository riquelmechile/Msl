import { describe, expect, it, vi } from "vitest";

import type { MlcApiClient, MlcReadSnapshot } from "@msl/mercadolibre";

import { createMlcReadTools, PREPARED_WRITE_KINDS } from "./index.js";

const now = new Date("2026-06-25T12:00:00.000Z");

describe("project-owned MercadoLibre safe read tools", () => {
  it("wraps MLC-confirmed category attributes with seller scope, freshness, and confidence", async () => {
    const getCategoryAttributes = vi.fn<MlcApiClient["getCategoryAttributes"]>().mockResolvedValue(
      snapshot("seller-1", "category-attributes", [
        {
          id: "BRAND",
          name: "Brand",
          required: true,
          catalogRequired: true,
          variationAttribute: false,
          readOnly: false,
          values: [{ id: "GENERIC", name: "Generic" }],
          units: [],
        },
      ]),
    );
    const tools = createMlcReadTools({ client: clientWith({ getCategoryAttributes }) });

    const response = await tools.categoryAttributes.execute({
      sellerId: "seller-1",
      categoryId: "MLC1743",
    });

    expect(getCategoryAttributes).toHaveBeenCalledWith("seller-1", "MLC1743");
    expect(response).toMatchObject({
      data: {
        sellerId: "seller-1",
        kind: "category-attributes",
        source: "mercadolibre-api",
        completeness: "complete",
        confidence: "high",
        freshness: {
          source: "mercadolibre-api",
          signalKind: "category-attributes",
          risk: "medium",
          status: "fresh",
        },
      },
      metadata: {
        source: "mercadolibre-api",
        confidence: "high",
        requiresApproval: false,
        siteSupport: "MLC-confirmed",
        sellerScope: { sellerId: "seller-1", site: "MLC" },
      },
    });
    expect("status" in response.data).toBe(false);
    if (!("status" in response.data)) {
      expect(response.metadata.freshness).toEqual(response.data.freshness);
    }
  });

  it("wraps MLC-confirmed category technical specs with seller scope metadata", async () => {
    const getCategoryTechnicalSpecs = vi
      .fn<MlcApiClient["getCategoryTechnicalSpecs"]>()
      .mockResolvedValue(
        snapshot("seller-1", "category-technical-specs", [
          {
            id: "MODEL",
            name: "Model",
            required: true,
            catalogRequired: true,
            valueType: "string",
            group: "TECHNICAL_SPECIFICATIONS",
          },
        ]),
      );
    const tools = createMlcReadTools({ client: clientWith({ getCategoryTechnicalSpecs }) });

    const response = await tools.categoryTechnicalSpecs.execute({
      sellerId: "seller-1",
      domainId: "MLC-CARS",
    });

    expect(getCategoryTechnicalSpecs).toHaveBeenCalledWith("seller-1", "MLC-CARS");
    expect(response.data).toMatchObject({
      sellerId: "seller-1",
      kind: "category-technical-specs",
      confidence: "high",
      freshness: { signalKind: "category-technical-specs", risk: "medium" },
    });
    expect(response.metadata).toMatchObject({
      source: "mercadolibre-api",
      confidence: "high",
      requiresApproval: false,
      siteSupport: "MLC-confirmed",
      sellerScope: { sellerId: "seller-1", site: "MLC" },
    });
  });

  it("blocks malformed category identifiers before calling the MercadoLibre client", async () => {
    const getCategoryAttributes = vi.fn<MlcApiClient["getCategoryAttributes"]>();
    const getCategoryTechnicalSpecs = vi.fn<MlcApiClient["getCategoryTechnicalSpecs"]>();
    const tools = createMlcReadTools({
      client: clientWith({ getCategoryAttributes, getCategoryTechnicalSpecs }),
    });

    await expect(
      tools.categoryAttributes.execute({ sellerId: "seller-1", categoryId: "MLA1743/../users/me" }),
    ).resolves.toMatchObject({
      data: { status: "blocked", reason: "unsupported-category-id", siteSupport: "unknown" },
      metadata: {
        confidence: "low",
        requiresApproval: false,
        siteSupport: "unknown",
        degradedReason: "unsupported-category-id",
      },
    });
    await expect(
      tools.categoryTechnicalSpecs.execute({ sellerId: "seller-1", domainId: "MLA-CARS" }),
    ).resolves.toMatchObject({
      data: { status: "blocked", reason: "unsupported-domain-id", siteSupport: "unknown" },
      metadata: {
        confidence: "low",
        requiresApproval: false,
        siteSupport: "unknown",
        degradedReason: "unsupported-domain-id",
      },
    });
    expect(getCategoryAttributes).not.toHaveBeenCalled();
    expect(getCategoryTechnicalSpecs).not.toHaveBeenCalled();
  });

  it("converts blocked safe reads into controlled low-confidence responses", async () => {
    const getCategoryAttributes = vi.fn<MlcApiClient["getCategoryAttributes"]>().mockRejectedValue(
      Object.assign(new Error("Requested seller is not configured."), {
        reason: "seller-not-configured",
      }),
    );
    const tools = createMlcReadTools({ client: clientWith({ getCategoryAttributes }) });

    await expect(
      tools.categoryAttributes.execute({ sellerId: "unknown-seller", categoryId: "MLC1743" }),
    ).resolves.toMatchObject({
      data: {
        status: "blocked",
        reason: "seller-not-configured",
        message: "Requested seller is not configured.",
      },
      metadata: {
        source: "mercadolibre-api",
        freshness: null,
        confidence: "low",
        requiresApproval: false,
        degradedReason: "seller-not-configured",
      },
    });
  });

  it("converts category API runtime failures into degraded low-confidence responses", async () => {
    const getCategoryTechnicalSpecs = vi
      .fn<MlcApiClient["getCategoryTechnicalSpecs"]>()
      .mockRejectedValue(new Error("ML API GET /domains/MLC-CARS/technical_specs failed: 500"));
    const tools = createMlcReadTools({ client: clientWith({ getCategoryTechnicalSpecs }) });

    await expect(
      tools.categoryTechnicalSpecs.execute({ sellerId: "seller-1", domainId: "MLC-CARS" }),
    ).resolves.toMatchObject({
      data: {
        status: "degraded",
        reason: "ml-api-read-failed",
        siteSupport: "unknown",
      },
      metadata: {
        source: "mercadolibre-api",
        freshness: null,
        confidence: "low",
        requiresApproval: false,
        siteSupport: "unknown",
        degradedReason: "ml-api-read-failed",
      },
    });
  });

  it("keeps the existing messages read surface as a non-mutating snapshot tool", async () => {
    const getMessages = vi.fn<MlcApiClient["getMessages"]>().mockResolvedValue(
      snapshot("seller-1", "message", [
        {
          id: "msg-1",
          subject: "Question about stock",
          status: "unread",
          createdAt: "2026-06-25T10:00:00.000Z",
          fromUserId: "buyer-1",
        },
      ]),
    );
    const tools = createMlcReadTools({ client: clientWith({ getMessages }) });

    const response = await tools.messages.execute({ sellerId: "seller-1" });

    expect(getMessages).toHaveBeenCalledOnce();
    expect(getMessages).toHaveBeenCalledWith("seller-1");
    expect(response).toMatchObject({
      data: {
        sellerId: "seller-1",
        kind: "message",
        source: "mercadolibre-api",
        data: [
          {
            id: "msg-1",
            subject: "Question about stock",
            status: "unread",
            createdAt: "2026-06-25T10:00:00.000Z",
            fromUserId: "buyer-1",
          },
        ],
        freshness: { signalKind: "message", risk: "critical", status: "fresh" },
        confidence: "high",
      },
      metadata: {
        source: "mercadolibre-api",
        confidence: "high",
        requiresApproval: false,
      },
    });
    expect(response.metadata.freshness).toEqual(
      "status" in response.data ? null : response.data.freshness,
    );
    expect("answerQuestion" in tools).toBe(false);
    expect("replyMessage" in tools).toBe(false);
    expect("markMessageRead" in tools).toBe(false);
    expect("executeCustomerMessage" in tools).toBe(false);
    expect(PREPARED_WRITE_KINDS).toContain("customer-message");
  });

  it("keeps prepare-only and unknown-support entries unavailable as read tools", () => {
    const tools = createMlcReadTools({ client: clientWith({}) });

    expect("listingQuality" in tools).toBe(false);
    expect("pictures" in tools).toBe(false);
    expect("shipping" in tools).toBe(false);
    expect("visits" in tools).toBe(false);
    expect("questions" in tools).toBe(false);
    expect("answerQuestion" in tools).toBe(false);
    expect("markQuestionRead" in tools).toBe(false);
    expect("executeListingEdit" in tools).toBe(false);
    expect(PREPARED_WRITE_KINDS).toContain("listing-edit");
  });
});

function snapshot<TData>(
  sellerId: string,
  kind: MlcReadSnapshot<TData>["kind"],
  data: TData[],
): MlcReadSnapshot<TData> {
  return {
    sellerId,
    kind,
    source: "mercadolibre-api",
    data,
    completeness: "complete",
    freshness: {
      source: "mercadolibre-api",
      signalKind: kind,
      risk:
        kind === "category-attributes" || kind === "category-technical-specs"
          ? "medium"
          : "critical",
      capturedAt: now,
      maxAgeMs: 60 * 60 * 1000,
      status: "fresh",
    },
    confidence: "high",
    sellerScope: { sellerId, site: "MLC" },
    ...(kind === "category-attributes" || kind === "category-technical-specs"
      ? { siteSupport: "MLC-confirmed" as const }
      : {}),
  };
}

function clientWith(overrides: Partial<MlcApiClient>): MlcApiClient {
  return {
    getListings: vi.fn(),
    getOrders: vi.fn(),
    getMessages: vi.fn(),
    getReputation: vi.fn(),
    getCategoryAttributes: vi.fn(),
    getCategoryTechnicalSpecs: vi.fn(),
    ...overrides,
  };
}
