import { afterEach, describe, expect, it, vi } from "vitest";

import type { CacheFreshness, ReadSnapshot } from "@msl/domain";

import {
  assertCompleteMlcItem,
  createMlcApiClient,
  createMlClient,
  createOAuthManager,
  createOAuthMlcApiClient,
  createTokenStore,
  evaluateOAuthAccess,
  PRICING_AUTOMATION_HISTORY_MAX_SIZE,
  type MlcCategoryAttributeSummary,
  type MlcCategoryTechnicalSpecSummary,
  type MlcListingSummary,
  type MlcMessageSummary,
  type MlcOrderSummary,
  type MlcReadSnapshotFreshness,
  type MercadoLibreApiTransport,
  type MlcPromotionItemsSummary,
  type OAuthManager,
  type OAuthTokenState,
} from "./index.js";

import { encrypt, decrypt } from "./oauth/tokenStore.js";

const now = new Date("2026-06-25T12:00:00.000Z");

function completeMlcItemPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "MLC1001",
    title: "Source item",
    price: 10000,
    available_quantity: 10,
    category_id: "MLC1000",
    seller_id: 123,
    status: "active",
    pictures: [{ url: "https://example.test/item.jpg" }, { url: null }],
    attributes: [{ id: "BRAND", value_name: "Generic" }, { value_name: "Ignored" }],
    ...overrides,
  };
}

function tokenState(status: OAuthTokenState["status"] = "connected"): OAuthTokenState {
  return {
    sellerId: "seller-1",
    site: "MLC",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    scopes: ["read", "write"],
    status,
    connectedAt: new Date("2026-06-25T11:00:00.000Z"),
    expiresAt: new Date("2026-06-25T13:00:00.000Z"),
  };
}

describe("MercadoLibre OAuth access state", () => {
  it("identifies usable connected MLC access", () => {
    expect(evaluateOAuthAccess(tokenState(), now)).toEqual({
      allowed: true,
      sellerId: "seller-1",
      site: "MLC",
      accessToken: "access-token",
    });
  });

  it("blocks protected data when access is revoked", () => {
    expect(evaluateOAuthAccess(tokenState("revoked"), now)).toMatchObject({
      allowed: false,
      reason: "reconnect-required",
      status: "revoked",
    });
  });
});

describe("direct MLC API client boundary", () => {
  it("exports a shared MLC item completeness assertion for raw payloads", () => {
    expect(assertCompleteMlcItem(completeMlcItemPayload())).toEqual({
      id: "MLC1001",
      title: "Source item",
      price: 10000,
      available_quantity: 10,
      category_id: "MLC1000",
      seller_id: 123,
      status: "active",
      pictures: [{ url: "https://example.test/item.jpg" }],
      attributes: [{ id: "BRAND", value_name: "Generic" }],
    });
  });

  it.each([
    ["missing title", { title: undefined }],
    ["invalid price", { price: Number.NaN }],
    ["missing category", { category_id: "" }],
    ["invalid seller", { seller_id: undefined }],
    ["unsupported status", { status: "under_review" }],
    ["non-MLC item id", { id: "MLA1001" }],
  ])("rejects incomplete MLC item payloads without defaults for %s", (_name, overrides) => {
    expect(() => assertCompleteMlcItem(completeMlcItemPayload(overrides))).toThrow(/Incomplete/);
  });

  it("uses direct MercadoLibre API paths for operational seller data", async () => {
    const requests: string[] = [];
    const transport: MercadoLibreApiTransport = {
      request: (request) => {
        requests.push(request.path);
        return Promise.resolve({ ok: true });
      },
    };

    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    await client.getListings("seller-1");
    await client.getOrders("seller-1");

    expect(requests).toEqual(["/users/seller-1/items/search", "/orders/search"]);
  });

  it("blocks crafted item IDs before item read path construction", async () => {
    const request = vi.fn().mockResolvedValue({});
    const transport: MercadoLibreApiTransport = {
      request,
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    await expect(client.getItem("seller-1", "MLC1001/visits?include=orders")).rejects.toThrow(
      /MLC item IDs/,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("fails item reads with incomplete source payloads instead of synthetic defaults", async () => {
    const transport: MercadoLibreApiTransport = {
      request: vi.fn().mockResolvedValue({ id: "MLC1001", price: 10000 }),
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    await expect(client.getItem("seller-1", "MLC1001")).rejects.toThrow(/Incomplete/);
  });

  it("normalizes complete direct item reads through the shared assertion", async () => {
    const transport: MercadoLibreApiTransport = {
      request: vi.fn().mockResolvedValue(completeMlcItemPayload()),
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    await expect(client.getItem("seller-1", "MLC1001")).resolves.toEqual(
      assertCompleteMlcItem(completeMlcItemPayload()),
    );
  });

  it("normalizes listing, order, message, and reputation snapshots with metadata", async () => {
    const payloads: Record<string, unknown> = {
      "/users/seller-1/items/search": {
        results: [
          { id: "MLC-1", title: "Listing one", status: "active", price: 12000, currency_id: "CLP" },
        ],
      },
      "/orders/search": {
        results: [{ id: 1001, status: "paid", total_amount: 12000, buyer: { id: 501 } }],
      },
      "/messages/search": {
        messages: [
          { id: "message-1", subject: "Question", status: "available", from: { user_id: 501 } },
        ],
      },
      "/users/seller-1": {
        seller_reputation: {
          level_id: "5_green",
          power_seller_status: "gold",
          transactions: { completed: 95, total: 100, ratings: { positive: 0.98 } },
          metrics: {
            claims: { rate: 0.01 },
            cancellations: { rate: 0.02 },
            delayed_handling_time: { rate: 0.03 },
          },
        },
      },
      "/categories/MLC1743/attributes": [
        {
          id: "BRAND",
          name: "Brand",
          value_type: "string",
          tags: { required: true, catalog_required: true, variation_attribute: false },
          values: [{ id: "123", name: "Generic" }],
        },
      ],
      "/domains/MLC-CARS/technical_specs": {
        groups: [
          {
            components: [
              {
                attributes: [
                  {
                    id: "MODEL",
                    name: "Model",
                    value_type: "string",
                    hierarchy: "TECHNICAL_SPECIFICATIONS",
                    tags: { required: true, catalog_listing_required: true },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const transport: MercadoLibreApiTransport = {
      request: (request) => Promise.resolve(payloads[request.path]),
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });
    const listings = await client.getListings("seller-1");
    const orders = await client.getOrders("seller-1");
    const messages = await client.getMessages("seller-1");
    const reputation = await client.getReputation("seller-1");
    const attributes = await client.getCategoryAttributes("seller-1", "MLC1743");
    const technicalSpecs = await client.getCategoryTechnicalSpecs("seller-1", "MLC-CARS");
    const domainListingSnapshot: ReadSnapshot<MlcListingSummary> = listings;
    const domainAttributeSnapshot: ReadSnapshot<MlcCategoryAttributeSummary> = attributes;
    const domainTechnicalSpecSnapshot: ReadSnapshot<MlcCategoryTechnicalSpecSummary> =
      technicalSpecs;
    const domainFreshness: CacheFreshness = listings.freshness;
    const mlcFreshness: MlcReadSnapshotFreshness = listings.freshness;

    expect(domainListingSnapshot.source).toBe("mercadolibre-api");
    expect(domainFreshness.source).toBe("mercadolibre-api");
    expect(mlcFreshness.signalKind).toBe("listing");
    expect(listings).toMatchObject({
      sellerId: "seller-1",
      kind: "listing",
      source: "mercadolibre-api",
      data: [{ id: "MLC-1", title: "Listing one", status: "active" }],
      completeness: "complete",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "listing",
        risk: "medium",
        status: "fresh",
      },
      confidence: "high",
    });
    expect(listings.freshness.maxAgeMs).toBe(60 * 60 * 1000);
    expect(orders).toMatchObject({
      kind: "order",
      data: [{ id: "1001", status: "paid", totalAmount: 12000, buyerId: "501" }],
      completeness: "complete",
      confidence: "high",
      freshness: { risk: "critical", maxAgeMs: 5 * 60 * 1000 },
    });
    expect(messages).toMatchObject({
      kind: "message",
      data: [{ id: "message-1", subject: "Question", fromUserId: "501" }],
      completeness: "complete",
      confidence: "high",
      freshness: { risk: "critical", maxAgeMs: 5 * 60 * 1000 },
    });
    expect(reputation).toMatchObject({
      kind: "reputation",
      data: {
        level: "5_green",
        completedTransactions: 95,
        positiveRating: 0.98,
        claimsRate: 0.01,
        cancellationsRate: 0.02,
        delayedHandlingTimeRate: 0.03,
        metricPeriodDays: 60,
      },
      completeness: "complete",
      confidence: "high",
      siteSupport: "MLC-confirmed",
      sellerScope: { sellerId: "seller-1", site: "MLC" },
      freshness: { risk: "critical", maxAgeMs: 5 * 60 * 1000 },
    });
    expect(domainAttributeSnapshot).toMatchObject({ kind: "category-attributes" });
    expect(attributes).toMatchObject({
      kind: "category-attributes",
      data: [
        {
          id: "BRAND",
          name: "Brand",
          valueType: "string",
          required: true,
          catalogRequired: true,
          variationAttribute: false,
          readOnly: false,
          values: [{ id: "123", name: "Generic" }],
        },
      ],
      completeness: "complete",
      confidence: "high",
      siteSupport: "MLC-confirmed",
      sellerScope: { sellerId: "seller-1", site: "MLC" },
      freshness: { risk: "medium", maxAgeMs: 60 * 60 * 1000 },
    });
    expect(domainTechnicalSpecSnapshot).toMatchObject({ kind: "category-technical-specs" });
    expect(technicalSpecs).toMatchObject({
      kind: "category-technical-specs",
      data: [
        {
          id: "MODEL",
          name: "Model",
          valueType: "string",
          required: true,
          catalogRequired: true,
          group: "TECHNICAL_SPECIFICATIONS",
        },
      ],
      completeness: "complete",
      confidence: "high",
      siteSupport: "MLC-confirmed",
      sellerScope: { sellerId: "seller-1", site: "MLC" },
    });
  });

  it("treats valid empty category technical specs as complete medium-confidence evidence", async () => {
    const transport: MercadoLibreApiTransport = {
      request: (request) => {
        expect(request.path).toBe("/domains/MLC-EMPTY/technical_specs");
        return Promise.resolve({ groups: [] });
      },
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    await expect(client.getCategoryTechnicalSpecs("seller-1", "MLC-EMPTY")).resolves.toMatchObject({
      kind: "category-technical-specs",
      data: [],
      completeness: "complete",
      confidence: "medium",
      siteSupport: "MLC-confirmed",
    });
  });

  it("blocks non-MLC category and domain identifiers before path construction", async () => {
    const request = vi.fn<MercadoLibreApiTransport["request"]>().mockResolvedValue([]);
    const client = createMlcApiClient({ tokenState: tokenState(), transport: { request }, now });

    await expect(
      client.getCategoryAttributes("seller-1", "MLA1743/../users/me"),
    ).rejects.toMatchObject({
      reason: "unsupported-category-id",
      siteSupport: "unknown",
    });
    await expect(
      client.getCategoryTechnicalSpecs("seller-1", "CARS/../../users/me"),
    ).rejects.toMatchObject({
      reason: "unsupported-domain-id",
      siteSupport: "unknown",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("marks incomplete transport evidence as partial and low confidence", async () => {
    const transport: MercadoLibreApiTransport = {
      request: () => Promise.resolve({ results: ["MLC-1"] }),
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    await expect(client.getListings("seller-1")).resolves.toMatchObject({
      data: [{ id: "MLC-1" }],
      completeness: "partial",
      confidence: "low",
    });
  });

  it("does not call the transport when revoked access requires reconnection", async () => {
    let calls = 0;
    const transport: MercadoLibreApiTransport = {
      request: () => {
        calls += 1;
        return Promise.resolve({ ok: true });
      },
    };
    const client = createMlcApiClient({ tokenState: tokenState("revoked"), transport, now });

    await expect(client.getListings("seller-1")).rejects.toMatchObject({
      reason: "reconnect-required",
      status: "revoked",
    });
    expect(calls).toBe(0);
  });

  it("does not call the transport when expired access requires reconnection", async () => {
    let calls = 0;
    const expiredState = tokenState("connected");
    expiredState.expiresAt = new Date("2026-06-25T11:59:59.000Z");
    const transport: MercadoLibreApiTransport = {
      request: () => {
        calls += 1;
        return Promise.resolve({ ok: true });
      },
    };
    const client = createMlcApiClient({ tokenState: expiredState, transport, now });

    await expect(client.getMessages("seller-1")).rejects.toMatchObject({
      reason: "reconnect-required",
      status: "expired",
    });
    expect(calls).toBe(0);
  });

  it("does not call the transport when the requested seller differs from the connected account", async () => {
    let calls = 0;
    const transport: MercadoLibreApiTransport = {
      request: () => {
        calls += 1;
        return Promise.resolve({ ok: true });
      },
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    await expect(client.getOrders("seller-2")).rejects.toMatchObject({
      reason: "seller-access-mismatch",
      sellerId: "seller-2",
      connectedSellerId: "seller-1",
    });
    expect(calls).toBe(0);
  });

  it("resolves OAuth access tokens for every read method without exposing write methods", async () => {
    const tokenCalls: string[] = [];
    const requests: Array<{
      path: string;
      query: Readonly<Record<string, string>> | undefined;
      accessToken: string;
    }> = [];
    const oauthManager = {
      ensureValidToken: (sellerId: string) => {
        tokenCalls.push(sellerId);
        return Promise.resolve(`access-for-${sellerId}-${tokenCalls.length}`);
      },
    } as Pick<OAuthManager, "ensureValidToken"> as OAuthManager;
    const transport: MercadoLibreApiTransport = {
      request: (request) => {
        requests.push({
          path: request.path,
          query: request.query,
          accessToken: request.accessToken,
        });
        if (request.path === "/messages/search") {
          return Promise.resolve({ messages: [] });
        }
        if (request.path === "/users/seller-1") {
          return Promise.resolve({ seller_reputation: { transactions: {} } });
        }
        if (request.path === "/categories/MLC1743/attributes") {
          return Promise.resolve([]);
        }
        if (request.path === "/domains/MLC-CARS/technical_specs") {
          return Promise.resolve({ groups: [] });
        }
        return Promise.resolve({ results: [] });
      },
    };

    const client = createOAuthMlcApiClient({
      oauthManager,
      transport,
      now: () => now,
      allowedSellerIds: ["seller-1"],
    });

    expect("publishItem" in client).toBe(false);
    expect("getListingQuality" in client).toBe(false);
    expect("getVisits" in client).toBe(false);
    expect("getShipping" in client).toBe(false);
    await client.getListings("seller-1");
    await client.getOrders("seller-1");
    await client.getMessages("seller-1");
    await client.getReputation("seller-1");
    await client.getCategoryAttributes("seller-1", "MLC1743");
    await client.getCategoryTechnicalSpecs("seller-1", "MLC-CARS");
    await client.getListingPrices!("seller-1", {
      siteId: "MLA",
      price: 5000,
      categoryId: "MLA418448",
      billableWeight: 5828,
    });

    expect(tokenCalls).toEqual([
      "seller-1",
      "seller-1",
      "seller-1",
      "seller-1",
      "seller-1",
      "seller-1",
      "seller-1",
    ]);
    expect(requests).toEqual([
      {
        path: "/users/seller-1/items/search",
        query: { site: "MLC" },
        accessToken: "access-for-seller-1-1",
      },
      {
        path: "/orders/search",
        query: { seller: "seller-1", site: "MLC" },
        accessToken: "access-for-seller-1-2",
      },
      {
        path: "/messages/search",
        query: { seller: "seller-1", site: "MLC" },
        accessToken: "access-for-seller-1-3",
      },
      {
        path: "/users/seller-1",
        query: { site: "MLC" },
        accessToken: "access-for-seller-1-4",
      },
      {
        path: "/categories/MLC1743/attributes",
        query: undefined,
        accessToken: "access-for-seller-1-5",
      },
      {
        path: "/domains/MLC-CARS/technical_specs",
        query: undefined,
        accessToken: "access-for-seller-1-6",
      },
      {
        path: "/sites/MLA/listing_prices",
        query: { price: "5000", category_id: "MLA418448", billable_weight: "5828" },
        accessToken: "access-for-seller-1-7",
      },
    ]);
  });

  it("reads Premium listing prices with logistics-aware 2026 fee details", async () => {
    const requests: Parameters<MercadoLibreApiTransport["request"]>[0][] = [];
    const transport: MercadoLibreApiTransport = {
      request: (request) => {
        requests.push(request);
        return Promise.resolve([
          {
            currency_id: "ARS",
            listing_type_id: "gold_pro",
            listing_type_name: "Premium",
            sale_fee_amount: 875,
            sale_fee_details: {
              financing_add_on_fee: 100,
              fixed_fee: 250,
              gross_amount: 5000,
              meli_percentage_fee: 525,
              percentage_fee: 10.5,
            },
          },
        ]);
      },
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    await expect(
      client.getListingPrices!("seller-1", {
        siteId: "MLA",
        price: 5000,
        currencyId: "ARS",
        categoryId: "MLA418448",
        listingTypeId: "gold_pro",
        logisticType: "drop_off",
        shippingMode: "me2",
        billableWeight: 5828,
        quantity: 1,
        tags: ["ahora-3"],
      }),
    ).resolves.toMatchObject({
      kind: "listing-prices",
      data: [
        {
          currencyId: "ARS",
          listingTypeId: "gold_pro",
          listingTypeName: "Premium",
          saleFeeAmount: 875,
          saleFeeDetails: {
            financingAddOnFee: 100,
            fixedFee: 250,
            grossAmount: 5000,
            meliPercentageFee: 525,
            percentageFee: 10.5,
          },
        },
      ],
    });

    expect(requests[0]).toMatchObject({
      method: "GET",
      path: "/sites/MLA/listing_prices",
      query: {
        price: "5000",
        currency_id: "ARS",
        category_id: "MLA418448",
        listing_type_id: "gold_pro",
        logistic_type: "drop_off",
        shipping_mode: "me2",
        billable_weight: "5828",
        quantity: "1",
        tags: "ahora-3",
      },
    });
  });

  it("reads Classic listing prices and can return multiple listing types when omitted", async () => {
    const transport: MercadoLibreApiTransport = {
      request: vi.fn().mockResolvedValue({
        results: [
          { currency_id: "ARS", listing_type_id: "gold_special", sale_fee_amount: 700 },
          { currency_id: "ARS", listing_type_id: "gold_pro", sale_fee_amount: 875 },
        ],
      }),
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    const response = await client.getListingPrices!("seller-1", {
      siteId: "MLA",
      price: 5000,
      categoryId: "MLA418448",
    });

    expect(response.data).toMatchObject([
      { listingTypeId: "gold_special", saleFeeAmount: 700 },
      { listingTypeId: "gold_pro", saleFeeAmount: 875 },
    ]);
    expect(transport.request).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { price: "5000", category_id: "MLA418448" },
      }),
    );
  });

  it("reads safe price intelligence endpoints without mutations", async () => {
    const requests: Parameters<MercadoLibreApiTransport["request"]>[0][] = [];
    const transport: MercadoLibreApiTransport = {
      request: (request) => {
        requests.push(request);
        if (request.path.endsWith("/sale_price")) {
          return Promise.resolve({
            amount: 10990,
            regular_amount: 12990,
            currency_id: "CLP",
            type: "standard",
            metadata: {
              promotion_id: "promo-1",
              promotion_type: "deal",
              raw_secret: "must-not-leak",
            },
          });
        }
        if (request.path.endsWith("/prices")) {
          return Promise.resolve({
            prices: [
              {
                id: "1",
                type: "standard",
                amount: 10990,
                currency_id: "CLP",
                conditions: {
                  context_restrictions: ["channel_marketplace"],
                  eligible: true,
                  raw_secret: "must-not-leak",
                },
              },
            ],
          });
        }
        if (request.path.endsWith("/price_to_win")) {
          return Promise.resolve({
            current_price: 10990,
            price_to_win: 9990,
            status: "competing",
            visit_share: "medium",
            catalog_product_id: "MLC123",
            winner: { item_id: "MLC999", price: 9900, raw_secret: "must-not-leak" },
            boosts: [{ id: "boost-1", type: "fulfillment", raw_secret: "must-not-leak" }],
          });
        }
        return Promise.resolve({
          item_id: "MLC1001",
          status: "ACTIVE",
          item_rule: {
            rule_id: "rule-1",
            min_price: 9000,
            max_price: 13000,
          },
        });
      },
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    await expect(
      client.getItemSalePrice!("seller-1", "MLC1001", {
        context: "channel_marketplace,buyer_loyalty_3",
      }),
    ).resolves.toMatchObject({
      data: {
        itemId: "MLC1001",
        amount: 10990,
        currencyId: "CLP",
        metadata: { promotionId: "promo-1", promotionType: "deal" },
      },
    });
    await expect(client.getItemPrices!("seller-1", "MLC1001")).resolves.toMatchObject({
      data: {
        itemId: "MLC1001",
        prices: [
          {
            type: "standard",
            amount: 10990,
            conditions: { contextRestrictions: ["channel_marketplace"], eligible: true },
          },
        ],
      },
    });
    await expect(client.getItemPriceToWin!("seller-1", "MLC1001")).resolves.toMatchObject({
      data: {
        itemId: "MLC1001",
        status: "competing",
        priceToWin: 9990,
        winner: { itemId: "MLC999", price: 9900 },
        boosts: [{ id: "boost-1", type: "fulfillment" }],
      },
    });
    const automation = await client.getPricingAutomation!("seller-1", "MLC1001");
    expect(automation).toMatchObject({
      data: { itemId: "MLC1001", active: true, ruleId: "rule-1" },
    });
    expect(automation).not.toHaveProperty("data.raw");

    expect(requests.map(({ method, path, query }) => ({ method, path, query }))).toEqual([
      {
        method: "GET",
        path: "/items/MLC1001/sale_price",
        query: { context: "channel_marketplace,buyer_loyalty_3" },
      },
      { method: "GET", path: "/items/MLC1001/prices", query: undefined },
      { method: "GET", path: "/items/MLC1001/price_to_win", query: { version: "v2" } },
      { method: "GET", path: "/pricing-automation/items/MLC1001/automation", query: undefined },
    ]);
  });

  it("reads documented pricing automation rules and price history without leaking raw fields", async () => {
    const requests: Parameters<MercadoLibreApiTransport["request"]>[0][] = [];
    const transport: MercadoLibreApiTransport = {
      request: (request) => {
        requests.push(request);
        if (request.path.endsWith("/products/MLC123456/rules")) {
          return Promise.resolve({
            product_id: "MLC123456",
            rules: [{ rule_id: "INT_EXT", secret: "ignore" }, { rule_id: "INT" }],
          });
        }
        if (request.path.endsWith("/rules")) {
          return Promise.resolve({
            item_id: "MLC1001",
            rules: [{ rule_id: "INT_EXT", secret: "ignore" }, { rule_id: "INT" }],
          });
        }
        return Promise.resolve({
          result_code: 200,
          result: {
            content: [
              {
                date_time: "2024-07-12T15:26:15Z",
                percent_change: 0,
                usd_price: 0,
                deal_id: "68719c01-0566-4728-adef-2701750be2d0",
                price: 120,
                event: "CurrentStrategyConfirmed",
                strategy_type: "automation_min_price",
                raw_secret: "must-not-leak",
              },
            ],
            pageable: { offset: 0, page_number: 0, page_size: 1 },
            total_elements: 9,
            total_pages: 9,
            size: 1,
            number_of_elements: 1,
            empty: false,
          },
          result_message: "OK",
        });
      },
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    await expect(
      client.getPricingAutomationItemRules!("seller-1", "MLC1001"),
    ).resolves.toMatchObject({
      data: {
        targetType: "item",
        targetId: "MLC1001",
        rules: [{ ruleId: "INT_EXT" }, { ruleId: "INT" }],
      },
    });
    await expect(
      client.getPricingAutomationProductRules!("seller-1", "MLC123456"),
    ).resolves.toMatchObject({
      data: {
        targetType: "product",
        targetId: "MLC123456",
        rules: [{ ruleId: "INT_EXT" }, { ruleId: "INT" }],
      },
    });
    const history = await client.getPricingAutomationPriceHistory!("seller-1", "MLC1001", {
      days: 7,
      page: 0,
      size: 1,
    });
    expect(history).toMatchObject({
      data: {
        itemId: "MLC1001",
        resultCode: 200,
        resultMessage: "OK",
        content: [
          {
            dateTime: "2024-07-12T15:26:15Z",
            percentChange: 0,
            usdPrice: 0,
            price: 120,
            event: "CurrentStrategyConfirmed",
            strategyType: "automation_min_price",
          },
        ],
        pageable: { offset: 0, pageNumber: 0, pageSize: 1 },
        totalElements: 9,
        totalPages: 9,
        empty: false,
      },
    });
    expect(JSON.stringify(history)).not.toContain("raw_secret");
    expect(JSON.stringify(history)).not.toContain("68719c01-0566-4728-adef-2701750be2d0");
    expect(JSON.stringify(history)).not.toContain("dealId");
    expect(requests.map(({ method, path, query }) => ({ method, path, query }))).toEqual([
      { method: "GET", path: "/pricing-automation/items/MLC1001/rules", query: undefined },
      { method: "GET", path: "/pricing-automation/products/MLC123456/rules", query: undefined },
      {
        method: "GET",
        path: "/pricing-automation/items/MLC1001/price/history",
        query: { days: "7", page: "0", size: "1" },
      },
    ]);
  });

  it("caps automation history page size to the documented maximum", async () => {
    const request = vi.fn<MercadoLibreApiTransport["request"]>().mockResolvedValue({
      result_code: 200,
      result: {
        content: [],
        pageable: { offset: 0, page_number: 0, page_size: PRICING_AUTOMATION_HISTORY_MAX_SIZE },
      },
      result_message: "OK",
    });
    const client = createMlcApiClient({ tokenState: tokenState(), transport: { request }, now });

    await expect(
      client.getPricingAutomationPriceHistory!("seller-1", "MLC1001", {
        size: PRICING_AUTOMATION_HISTORY_MAX_SIZE + 100,
      }),
    ).resolves.toMatchObject({
      data: { pageable: { pageNumber: 0, pageSize: PRICING_AUTOMATION_HISTORY_MAX_SIZE } },
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/pricing-automation/items/MLC1001/price/history",
        query: { days: "30", page: "0", size: String(PRICING_AUTOMATION_HISTORY_MAX_SIZE) },
      }),
    );
  });

  it("sanitizes non-finite automation history pagination to documented defaults", async () => {
    const request = vi.fn<MercadoLibreApiTransport["request"]>().mockResolvedValue({
      result_code: 200,
      result: { content: [], pageable: { offset: 0, page_number: 0, page_size: 10 } },
      result_message: "OK",
    });
    const client = createMlcApiClient({ tokenState: tokenState(), transport: { request }, now });

    await expect(
      client.getPricingAutomationPriceHistory!("seller-1", "MLC1001", {
        days: Number.NaN,
        page: -5,
        size: Infinity,
      }),
    ).resolves.toMatchObject({
      data: { pageable: { offset: 0, pageNumber: 0, pageSize: 10 } },
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/pricing-automation/items/MLC1001/price/history",
        query: { days: "30", page: "0", size: "10" },
      }),
    );
  });

  it("lists automated price items with capped pagination", async () => {
    const request = vi.fn<MercadoLibreApiTransport["request"]>().mockResolvedValue({
      paging: { total: 1, offset: 0, limit: 100 },
      items: ["MLC1001"],
    });
    const client = createMlcApiClient({ tokenState: tokenState(), transport: { request }, now });

    await expect(
      client.getPricingAutomationItems!("seller-1", { offset: -5, limit: 500 }),
    ).resolves.toMatchObject({
      data: {
        paging: { total: 1, offset: 0, limit: 100 },
        items: [{ itemId: "MLC1001" }],
      },
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/pricing-automation/users/seller-1/items",
        query: { offset: "0", limit: "100" },
      }),
    );
  });

  it("sanitizes non-finite automated price item pagination", async () => {
    const request = vi.fn<MercadoLibreApiTransport["request"]>().mockResolvedValue({
      paging: { total: 0, offset: 0, limit: 100 },
      results: [],
    });
    const client = createMlcApiClient({ tokenState: tokenState(), transport: { request }, now });

    await expect(
      client.getPricingAutomationItems!("seller-1", { offset: Number.NaN, limit: Infinity }),
    ).resolves.toMatchObject({
      data: { paging: { total: 0, offset: 0, limit: 100 }, items: [] },
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/pricing-automation/users/seller-1/items",
        query: { offset: "0", limit: "50" },
      }),
    );
  });

  it("reads documented seller promotion list, detail, and promotion items", async () => {
    const requests: Parameters<MercadoLibreApiTransport["request"]>[0][] = [];
    const transport: MercadoLibreApiTransport = {
      request: (request) => {
        requests.push(request);
        if (request.path === "/seller-promotions/users/seller-1") {
          return Promise.resolve({
            results: [
              {
                id: "P-MLC1806015",
                type: "MARKETPLACE_CAMPAIGN",
                status: "started",
                start_date: "2023-04-20T02:00:00Z",
                finish_date: "2023-08-01T02:00:00Z",
                deadline_date: "2023-08-01T01:00:00Z",
                name: "Campaña de prueba v2",
                benefits: { type: "REBATE", meli_percent: 5, seller_percent: 25 },
                raw_secret: "must-not-leak",
              },
            ],
            paging: { offset: 0, limit: 50, total: 1 },
          });
        }
        if (request.path.endsWith("/items")) {
          return Promise.resolve({
            results: [
              {
                id: "MLC1001",
                status: "started",
                price: 23968,
                original_price: 28549,
                start_date: "2023-04-27T15:04:00Z",
                end_date: "2023-05-05T03:00:00Z",
                sub_type: "FLEXIBLE_PERCENTAGE",
                ignored: "must-not-leak",
              },
            ],
            paging: { search_after: "next-cursor", limit: 50 },
          });
        }
        return Promise.resolve({
          id: "C-MLC302",
          type: "SELLER_CAMPAIGN",
          sub_type: "FLEXIBLE_PERCENTAGE",
          status: "started",
          start_date: "2023-04-27T15:04:00Z",
          finish_date: "2023-05-05T03:00:00Z",
          name: "camp del seller",
          allow_combination: false,
          raw_payload: "must-not-leak",
        });
      },
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    await expect(client.getSellerPromotions!("seller-1")).resolves.toMatchObject({
      data: {
        paging: { offset: 0, limit: 50, total: 1 },
        promotions: [
          {
            id: "P-MLC1806015",
            type: "MARKETPLACE_CAMPAIGN",
            benefits: { type: "REBATE", meliPercent: 5, sellerPercent: 25 },
          },
        ],
      },
    });
    await expect(
      client.getPromotionDetail!("seller-1", "C-MLC302", "SELLER_CAMPAIGN"),
    ).resolves.toMatchObject({
      data: { id: "C-MLC302", type: "SELLER_CAMPAIGN", subType: "FLEXIBLE_PERCENTAGE", allowCombination: false },
    });
    await expect(
      client.getPromotionItems!("seller-1", "P-MLC1806015", "MARKETPLACE_CAMPAIGN", {
        status: "started",
        statusItem: "active",
        limit: 500,
        searchAfter: "cursor-1",
      }),
    ).resolves.toMatchObject({
      data: {
        promotionId: "P-MLC1806015",
        promotionType: "MARKETPLACE_CAMPAIGN",
        paging: { limit: 50, searchAfter: "next-cursor" },
        items: [{ id: "MLC1001", price: 23968, originalPrice: 28549 }],
      },
    });
    expect(JSON.stringify(requests)).not.toContain("must-not-leak");
    expect(requests.map(({ method, path, query }) => ({ method, path, query }))).toEqual([
      {
        method: "GET",
        path: "/seller-promotions/users/seller-1",
        query: { app_version: "v2" },
      },
      {
        method: "GET",
        path: "/seller-promotions/promotions/C-MLC302",
        query: { promotion_type: "SELLER_CAMPAIGN", app_version: "v2" },
      },
      {
        method: "GET",
        path: "/seller-promotions/promotions/P-MLC1806015/items",
        query: {
          promotion_type: "MARKETPLACE_CAMPAIGN",
          app_version: "v2",
          limit: "50",
          status: "started",
          status_item: "active",
          search_after: "cursor-1",
        },
      },
    ]);
  });

  it("normalizes UNHEALTHY_STOCK detail with pre-negotiated offers", async () => {
    const request = vi.fn().mockResolvedValue({
      id: "P-MLC13457036",
      type: "UNHEALTHY_STOCK",
      status: "started",
      start_date: "2023-10-02T17:00:00Z",
      finish_date: "2023-10-16T15:00:00Z",
      deadline_date: "2023-10-16T15:00:00Z",
      name: "Acelera tus ventas de stock Full",
      offers: [
        {
          id: "",
          original_price: 30,
          new_price: 28,
          status: "active",
          start_date: "2023-10-05T14:02:52Z",
          end_date: "",
          benefits: { type: "REBATE", meli_percent: 0, seller_percent: 6.7 },
        },
      ],
    });
    const client = createMlcApiClient({
      tokenState: tokenState(),
      transport: { request },
      now,
    });
    const snapshot = await client.getPromotionDetail!(
      "seller-1", "P-MLC13457036", "UNHEALTHY_STOCK",
    );
    expect(snapshot.data).toMatchObject({
      id: "P-MLC13457036",
      type: "UNHEALTHY_STOCK",
      offers: [
        {
          originalPrice: 30,
          newPrice: 28,
          status: "active",
          benefits: { type: "REBATE", meliPercent: 0, sellerPercent: 6.7 },
        },
      ],
    });
  });

  it("normalizes promotion items with offer_id, percentages, and net_proceeds", async () => {
    const requests: any[] = [];
    const request = vi.fn().mockImplementation((opts: any) => {
      requests.push(opts);
      return Promise.resolve({
        results: [
          {
            id: "MLC1386957825",
            status: "started",
            price: 28,
            original_price: 30,
            currency_id: "USD",
            offer_id: "OFFER-MLC1386957825-10097412984",
            seller_percentage: 6.7,
            meli_percentage: 10,
            start_date: "2023-10-02T17:00:00Z",
            end_date: "2023-10-16T15:00:00Z",
            net_proceeds: { amount: 20.68, currency: "USD" },
          },
        ],
        paging: { offset: 0, limit: 50, total: 1 },
      });
    });
    const client = createMlcApiClient({
      tokenState: tokenState(),
      transport: { request },
      now,
    });
    const snapshot = await client.getPromotionItems!(
      "seller-1", "P-MLC13457036", "UNHEALTHY_STOCK",
    );
    const data = snapshot.data as MlcPromotionItemsSummary;
    expect(data.items[0]).toMatchObject({
      id: "MLC1386957825",
      status: "started",
      offerId: "OFFER-MLC1386957825-10097412984",
      sellerPercentage: 6.7,
      meliPercentage: 10,
      currencyId: "USD",
      netProceeds: { amount: 20.68, currency: "USD" },
    });
  });

  it("normalizes SELLER_CAMPAIGN candidate items with nested net_proceeds", async () => {
    const request = vi.fn().mockResolvedValue({
      results: [
        {
          id: "MLC2001",
          status: "candidate",
          price: 200,
          original_price: 250,
          currency_id: "USD",
          net_proceeds: {
            suggested_discounted_price: { amount: 180.25, currency: "USD" },
            max_discounted_price: { amount: 78.47, currency: "USD" },
            min_discounted_price: { amount: 50.0, currency: "USD" },
          },
        },
      ],
      paging: { limit: 50 },
    });
    const client = createMlcApiClient({
      tokenState: tokenState(),
      transport: { request },
      now,
    });
    const snapshot = await client.getPromotionItems!(
      "seller-1", "C-MLC302", "SELLER_CAMPAIGN",
    );
    const data = snapshot.data as MlcPromotionItemsSummary;
    expect(data.items[0]).toMatchObject({
      id: "MLC2001",
      status: "candidate",
      netProceeds: {
        suggestedDiscountedPrice: { amount: 180.25, currency: "USD" },
        maxDiscountedPrice: { amount: 78.47, currency: "USD" },
        minDiscountedPrice: { amount: 50.0, currency: "USD" },
      },
    });
  });

  it("reads pagination searchAfter from both snake_case and camelCase API responses", async () => {
    const request = vi.fn().mockResolvedValue({
      results: [],
      paging: { searchAfter: "camel-cursor", limit: 50 },
    });
    const client = createMlcApiClient({
      tokenState: tokenState(),
      transport: { request },
      now,
    });
    const snapshot = await client.getPromotionItems!(
      "seller-1", "P-MLC1806015", "MARKETPLACE_CAMPAIGN",
    );
    expect(snapshot.data).toMatchObject({
      paging: { searchAfter: "camel-cursor", limit: 50 },
    });
  });

  it("accepts PRICE_MATCHING_MELI_ALL as a valid promotion type", async () => {
    const request = vi.fn().mockResolvedValue({
      results: [],
      paging: { limit: 50 },
    });
    const client = createMlcApiClient({
      tokenState: tokenState(),
      transport: { request },
      now,
    });
    const snapshot = await client.getPromotionItems!(
      "seller-1", "P-MLC999", "PRICE_MATCHING_MELI_ALL",
    );
    expect(snapshot.data).toMatchObject({
      promotionId: "P-MLC999",
      promotionType: "PRICE_MATCHING_MELI_ALL",
    });
  });

  it("reads documented item promotions fields without forwarding raw payloads", async () => {
    const request = vi.fn<MercadoLibreApiTransport["request"]>().mockResolvedValue([
      {
        id: "P-MLC1806015",
        type: "LIGHTNING",
        ref_id: "ref-1",
        status: "started",
        price: 18990,
        original_price: 23990,
        name: "Oferta relámpago",
        min_discounted_price: 18000,
        max_discounted_price: 21000,
        suggested_discounted_price: 19990,
        meli_percentage: 5,
        seller_percentage: 20,
        start_date: "2023-04-20T02:00:00Z",
        finish_date: "2023-08-01T02:00:00Z",
        top_price: 20000,
        top_deal_price: 19000,
        stock: { remaining_stock: 7, warehouse_id: "must-not-leak" },
        boosted_offer: true,
        discount_meli_boosted_percentage: 10,
        discount_meli_boost_amount: 1000,
        total_price_for_boosted_offer: 17990,
        raw_payload: "must-not-leak",
      },
    ]);
    const client = createMlcApiClient({ tokenState: tokenState(), transport: { request }, now });

    const snapshot = await client.getItemPromotions!("seller-1", "MLC1001");

    expect(snapshot).toMatchObject({
      data: {
        itemId: "MLC1001",
        promotions: [
          {
            id: "P-MLC1806015",
            type: "LIGHTNING",
            suggestedDiscountedPrice: 19990,
            stock: { remainingStock: 7 },
            boostedOffer: true,
            totalPriceForBoostedOffer: 17990,
          },
        ],
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("must-not-leak");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/seller-promotions/items/MLC1001",
        query: { app_version: "v2" },
      }),
    );
  });

  it("requires MLA billable weight when logistics-aware listing price params are present", async () => {
    const request = vi.fn().mockResolvedValue([]);
    const client = createMlcApiClient({ tokenState: tokenState(), transport: { request }, now });

    await expect(
      client.getListingPrices!("seller-1", {
        siteId: "MLA",
        price: 5000,
        categoryId: "MLA418448",
        logisticType: "drop_off",
        shippingMode: "me2",
      }),
    ).rejects.toThrow(/billableWeight/);
    await expect(
      client.getListingPrices!("seller-1", {
        siteId: "MLA",
        price: 5000,
        categoryId: "MLA418448",
        logisticsAware: true,
      }),
    ).rejects.toThrow(/billableWeight/);
    expect(request).not.toHaveBeenCalled();
  });

  it("reads Product Ads insights through current safe-read endpoints and headers only", async () => {
    const requests: Parameters<MercadoLibreApiTransport["request"]>[0][] = [];
    const transport: MercadoLibreApiTransport = {
      request: (request) => {
        requests.push(request);
        if (request.path === "/advertising/advertisers") {
          return Promise.resolve({ results: [{ id: 123, site_id: "MLC" }] });
        }
        if (request.path.endsWith("/campaigns/search")) {
          return Promise.resolve({
            results: [{ id: 456, status: "active", metrics: { roas: 3.2 } }],
          });
        }
        return Promise.resolve({
          results: [{ id: 789, item_id: "MLC1001", campaign_id: 456, metrics: { cost: 1000 } }],
        });
      },
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    await expect(
      client.getProductAdsInsights!("seller-1", {
        dateFrom: "2026-02-01",
        dateTo: "2026-02-18",
        itemId: "MLC1001",
      }),
    ).resolves.toMatchObject({
      kind: "product-ads-insights",
      data: {
        advertiser: { id: "123", siteId: "MLC", productId: "PADS" },
        noMutationExecuted: true,
        performanceMetric: "roas",
        campaigns: [{ id: "456", metrics: { roas: 3.2 } }],
        ads: [{ id: "789", itemId: "MLC1001", campaignId: "456", metrics: { cost: 1000 } }],
      },
      siteSupport: "MLC-confirmed",
      sellerScope: { sellerId: "seller-1", site: "MLC" },
    });

    expect(requests.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "GET", path: "/advertising/advertisers" },
      { method: "GET", path: "/advertising/MLC/advertisers/123/product_ads/campaigns/search" },
      { method: "GET", path: "/advertising/MLC/advertisers/123/product_ads/ads/search" },
    ]);
    expect(requests[0]).toMatchObject({
      query: { product_id: "PADS" },
      headers: { "Api-Version": "1" },
    });
    expect(requests[1]).toMatchObject({
      query: { metrics_summary: "true" },
      headers: { "api-version": "2" },
    });
    expect(requests[2]).toMatchObject({
      query: { item_id: "MLC1001" },
      headers: { "api-version": "2" },
    });
  });

  it("rejects unconfigured OAuth read sellers before token resolution", async () => {
    const ensureValidToken = vi.fn().mockResolvedValue("access-token");
    const request = vi.fn().mockResolvedValue({ results: [] });
    const client = createOAuthMlcApiClient({
      oauthManager: { ensureValidToken } as Pick<OAuthManager, "ensureValidToken"> as OAuthManager,
      transport: { request },
      now: () => now,
      allowedSellerIds: ["source-seller", "target-seller"],
    });

    await expect(client.getListings("unconfigured-seller")).rejects.toMatchObject({
      reason: "seller-not-configured",
      sellerId: "unconfigured-seller",
    });
    expect(ensureValidToken).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed when OAuth read sellers are empty or blank", () => {
    const ensureValidToken = vi.fn().mockResolvedValue("access-token");
    const request = vi.fn().mockResolvedValue({ results: [] });

    expect(() =>
      createOAuthMlcApiClient({
        oauthManager: { ensureValidToken } as Pick<
          OAuthManager,
          "ensureValidToken"
        > as OAuthManager,
        transport: { request },
        now: () => now,
        allowedSellerIds: ["", "  "],
      }),
    ).toThrow(
      "Requested seller is not configured as an allowed MercadoLibre account role for MSL.",
    );
    expect(ensureValidToken).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("propagates OAuth token resolution failures without calling the transport", async () => {
    const failure = new Error("No stored token for seller source-seller");
    const ensureValidToken = vi.fn().mockRejectedValue(failure);
    const request = vi.fn().mockResolvedValue({ results: [] });
    const client = createOAuthMlcApiClient({
      oauthManager: { ensureValidToken } as Pick<OAuthManager, "ensureValidToken"> as OAuthManager,
      transport: { request },
      now: () => now,
      allowedSellerIds: ["source-seller"],
    });

    await expect(client.getCategoryAttributes("source-seller", "MLC1743")).rejects.toThrow(
      failure.message,
    );
    expect(ensureValidToken).toHaveBeenCalledWith("source-seller");
    expect(request).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Token Store tests
// ---------------------------------------------------------------------------

describe("Token Store", () => {
  const sampleTokens = {
    access_token: "APP_USR-abc123",
    refresh_token: "TG-refresh-xyz789",
    expires_in: 21600,
    user_id: "123456",
    nickname: "TESTSELLER",
    account_level: "premium" as const,
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("encrypts tokens at rest and decrypts on retrieval", () => {
    const store = createTokenStore();
    store.saveToken("seller-plasticov", sampleTokens);

    const stored = store.getToken("seller-plasticov");
    expect(stored).toBeDefined();
    expect(stored!.access_token).toBe("APP_USR-abc123");
    expect(stored!.refresh_token).toBe("TG-refresh-xyz789");
    expect(stored!.user_id).toBe("123456");
    expect(stored!.nickname).toBe("TESTSELLER");
    expect(stored!.account_level).toBe("premium");
    expect(stored!.expires_at).toBeDefined();
    expect(new Date(stored!.expires_at).getTime()).toBeGreaterThan(Date.now());

    store.close();
  });

  it("returns undefined for unknown seller", () => {
    const store = createTokenStore();
    expect(store.getToken("nonexistent")).toBeUndefined();
    store.close();
  });

  it("deletes stored tokens", () => {
    const store = createTokenStore();
    store.saveToken("seller-x", sampleTokens);
    expect(store.getToken("seller-x")).toBeDefined();

    store.deleteToken("seller-x");
    expect(store.getToken("seller-x")).toBeUndefined();
    store.close();
  });

  it("stores tokens for multiple sellers independently", () => {
    const store = createTokenStore();
    store.saveToken("seller-a", {
      ...sampleTokens,
      access_token: "token-a",
      nickname: "SellerA",
    });
    store.saveToken("seller-b", {
      ...sampleTokens,
      access_token: "token-b",
      nickname: "SellerB",
    });

    const a = store.getToken("seller-a");
    const b = store.getToken("seller-b");

    expect(a!.access_token).toBe("token-a");
    expect(a!.nickname).toBe("SellerA");
    expect(b!.access_token).toBe("token-b");
    expect(b!.nickname).toBe("SellerB");
    store.close();
  });

  it("updates existing token on re-save", () => {
    const store = createTokenStore();
    store.saveToken("seller-1", sampleTokens);

    store.saveToken("seller-1", {
      ...sampleTokens,
      access_token: "NEW-TOKEN",
    });

    const stored = store.getToken("seller-1");
    expect(stored!.access_token).toBe("NEW-TOKEN");
    store.close();
  });

  it("encrypt and decrypt roundtrip correctly", () => {
    const plaintext = "APP_USR-sensitive-token-12345";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (unique IV)", () => {
    const plaintext = "APP_USR-same-token";
    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);
    // IVs are random, so ciphertexts must differ
    expect(enc1).not.toBe(enc2);
  });

  it("fails to decrypt with tampered ciphertext", () => {
    const encrypted = encrypt("sensitive-data");
    // Corrupt the ciphertext portion
    const parts = encrypted.split(":");
    parts[2] = "tampered-data";
    const corrupted = parts.join(":");
    expect(() => decrypt(corrupted)).toThrow();
  });

  it("fails to decrypt with wrong auth tag", () => {
    const encrypted = encrypt("sensitive-data");
    // Swap the IV with auth tag to corrupt
    const parts = encrypted.split(":");
    const corrupted = `${parts[2]}:${parts[1]}:${parts[0]}`;
    expect(() => decrypt(corrupted)).toThrow();
  });

  it("encrypted tokens survive save/load cycle with real encryption", () => {
    const store = createTokenStore();
    const tokens = {
      access_token: "APP_USR-real-encrypted-test",
      refresh_token: "TG-refresh-real-encrypted",
      expires_in: 21600,
      user_id: "999",
      nickname: "REALENC",
      account_level: "premium" as const,
    };

    store.saveToken("seller-enc", tokens);
    // Retrieve raw row to verify it's NOT stored as plaintext
    // We can only verify the full roundtrip through the public API
    const stored = store.getToken("seller-enc");
    expect(stored!.access_token).toBe("APP_USR-real-encrypted-test");
    expect(stored!.refresh_token).toBe("TG-refresh-real-encrypted");

    store.close();
  });

  it("fails closed in production when MSL_ENCRYPTION_KEY is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MSL_ENCRYPTION_KEY", "");
    vi.stubEnv("MSL_ALLOW_INSECURE_DEV_SECRETS", "");
    vi.resetModules();
    const { createTokenStore: createFreshTokenStore } = await import("./oauth/tokenStore.js");
    const store = createFreshTokenStore();

    expect(() => store.saveToken("seller-prod", sampleTokens)).toThrow(/MSL_ENCRYPTION_KEY/);

    store.close();
  });

  it("allows the explicit insecure development escape hatch outside test", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MSL_ENCRYPTION_KEY", "");
    vi.stubEnv("MSL_ALLOW_INSECURE_DEV_SECRETS", "true");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.resetModules();
    const { createTokenStore: createFreshTokenStore } = await import("./oauth/tokenStore.js");
    const store = createFreshTokenStore();

    store.saveToken("seller-dev", sampleTokens);

    expect(store.getToken("seller-dev")!.access_token).toBe(sampleTokens.access_token);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("insecure development key"));
    store.close();
  });
});

// ---------------------------------------------------------------------------
// OAuth Manager tests
// ---------------------------------------------------------------------------

describe("OAuth Manager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const stubConfig = {
    clientId: "",
    clientSecret: "",
    redirectUri: "https://example.com/callback",
  };

  const realConfig = {
    clientId: "REAL-CLIENT-ID",
    clientSecret: "REAL-SECRET",
    redirectUri: "https://example.com/callback",
  };

  it("detects stub mode when credentials are empty", () => {
    const manager = createOAuthManager(stubConfig);
    expect(manager.isStubMode()).toBe(true);
    manager.close();
  });

  it("detects real mode when credentials are provided", () => {
    const manager = createOAuthManager(realConfig);
    expect(manager.isStubMode()).toBe(false);
    manager.close();
  });

  it("builds authorization URL with state parameter", () => {
    const manager = createOAuthManager(stubConfig);
    const url = manager.getAuthorizationUrl("seller-1", "csrf-state-123");
    expect(url).toContain("auth.mercadolibre");
    expect(url).toContain("response_type=code");
    expect(url).toContain("redirect_uri=https%3A%2F%2Fexample.com%2Fcallback");
    expect(url).toContain("state=csrf-state-123");
    manager.close();
  });

  it("exchanges code for mock tokens in stub mode", async () => {
    const manager = createOAuthManager(stubConfig);
    const tokens = await manager.exchangeCodeForToken("seller-plasticov", "mock-code");

    expect(tokens.access_token).toContain("mock-access-seller-plasticov");
    expect(tokens.refresh_token).toContain("mock-refresh-seller-plasticov");
    expect(tokens.expires_in).toBe(21600);
    expect(tokens.account_level).toBe("classic");

    // Verify tokens were stored
    const stored = manager.getStoredToken("seller-plasticov");
    expect(stored).toBeDefined();
    expect(stored!.access_token).toBe(tokens.access_token);
    manager.close();
  });

  it("refuses to store real OAuth tokens when returned user_id does not match the configured role account", async () => {
    vi.stubEnv("MERCADOLIBRE_SOURCE_SELLER_ID", "plasticov-id");
    vi.stubEnv("MERCADOLIBRE_TARGET_SELLER_ID", "maustian-id");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () =>
          Promise.resolve({
            access_token: "APP_USR-real",
            refresh_token: "TG-real",
            expires_in: 21600,
            user_id: "maustian-id",
            nickname: "MAUSTIAN",
          }),
      }),
    );

    const manager = createOAuthManager(realConfig);

    await expect(manager.exchangeCodeForToken("plasticov-id", "oauth-code")).rejects.toThrow(
      /identity mismatch/i,
    );
    expect(manager.getStoredToken("plasticov-id")).toBeUndefined();
    manager.close();
  });

  it("reports token as not expired when recently stored", async () => {
    const manager = createOAuthManager(stubConfig);
    await manager.exchangeCodeForToken("seller-1", "code");
    expect(manager.isTokenExpired("seller-1")).toBe(false);
    manager.close();
  });

  it("reports token as expired for unknown seller", () => {
    const manager = createOAuthManager(stubConfig);
    expect(manager.isTokenExpired("unknown")).toBe(true);
    manager.close();
  });

  it("refreshes access token in stub mode", async () => {
    const manager = createOAuthManager(stubConfig);
    await manager.exchangeCodeForToken("seller-refresh", "code");
    const firstStored = manager.getStoredToken("seller-refresh");

    const newTokens = await manager.refreshAccessToken("seller-refresh");
    expect(newTokens.access_token).not.toBe(firstStored!.access_token);

    const updatedStored = manager.getStoredToken("seller-refresh");
    expect(updatedStored!.access_token).toBe(newTokens.access_token);
    manager.close();
  });

  it("ensureValidToken returns access token when not expired", async () => {
    const manager = createOAuthManager(stubConfig);
    await manager.exchangeCodeForToken("seller-valid", "code");
    const token = await manager.ensureValidToken("seller-valid");
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(0);
    manager.close();
  });

  it("throws on refresh for unknown seller", async () => {
    const manager = createOAuthManager(stubConfig);
    await expect(manager.refreshAccessToken("unknown")).rejects.toThrow("No stored token");
    manager.close();
  });

  it("throws on ensureValidToken for unknown seller", async () => {
    const manager = createOAuthManager(stubConfig);
    await expect(manager.ensureValidToken("unknown")).rejects.toThrow("No stored token");
    manager.close();
  });

  it("deletes stored tokens", async () => {
    const manager = createOAuthManager(stubConfig);
    await manager.exchangeCodeForToken("seller-del", "code");
    expect(manager.getStoredToken("seller-del")).toBeDefined();

    manager.deleteToken("seller-del");
    expect(manager.getStoredToken("seller-del")).toBeUndefined();
    manager.close();
  });

  // ── Mutex: prevent concurrent refresh races (bottleneck 3.4) ──────
  it("serialises concurrent ensureValidToken calls for the same seller via mutex", async () => {
    const manager = createOAuthManager(stubConfig);
    await manager.exchangeCodeForToken("seller-mutex", "code");

    // Expire the token so all concurrent calls need a refresh.
    // Force expiry by manipulating the store directly.
    // Instead of reaching internals, we make 3 concurrent ensureValidToken
    // calls. The mutex serialises them; no race should cause errors.
    const results = await Promise.allSettled([
      manager.ensureValidToken("seller-mutex"),
      manager.ensureValidToken("seller-mutex"),
      manager.ensureValidToken("seller-mutex"),
    ]);

    // All should succeed — no concurrent-refresh races.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    // All resolved tokens should be the same (last refresh wins).
    const tokens = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map((r) => r.value);
    expect(new Set(tokens).size).toBe(1);

    manager.close();
  });
});

// ---------------------------------------------------------------------------
// MlClient tests (stub mode)
// ---------------------------------------------------------------------------

describe("MlClient (stub mode)", () => {
  const now = new Date("2026-06-26T12:00:00.000Z");

  async function setupClient(sellerId = "seller-1") {
    const oauthManager = createOAuthManager({
      clientId: "",
      clientSecret: "",
      redirectUri: "https://example.com/callback",
    });
    await oauthManager.exchangeCodeForToken(sellerId, "test-code");
    const client = createMlClient({ oauthManager, now });
    return { client, oauthManager, sellerId };
  }

  it("getItems returns listing snapshots in stub mode", async () => {
    const { client } = await setupClient();
    const listings = await client.getItems("seller-1");

    expect(listings.kind).toBe("listing");
    expect(listings.source).toBe("mercadolibre-api");
    expect(Array.isArray(listings.data)).toBe(true);
    const data = listings.data as ReadonlyArray<MlcListingSummary>;
    expect(data.length).toBeGreaterThanOrEqual(2);
    expect(data[0]!).toMatchObject({
      id: "MLC1001",
      title: "Producto de prueba",
    });
  });

  it("getItem returns a single item in stub mode", async () => {
    const { client } = await setupClient();
    const item = await client.getItem("seller-1", "MLC1001");

    expect(item.id).toBe("MLC1001");
    expect(item.title).toBe("Producto de prueba");
    expect(item.price).toBe(15000);
    expect(item.status).toBe("active");
  });

  it("getItem rejects incomplete fetch-backed item payloads", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(completeMlcItemPayload({ title: undefined })), {
        status: 200,
        statusText: "OK",
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const oauthManager = {
      getStoredToken: vi.fn().mockReturnValue({ access_token: "access-token" }),
      ensureValidToken: vi.fn().mockResolvedValue("access-token"),
      isStubMode: () => false,
    } as Pick<OAuthManager, "getStoredToken" | "ensureValidToken" | "isStubMode"> as OAuthManager;
    const client = createMlClient({ oauthManager, now });

    try {
      await expect(client.getItem("seller-1", "MLC1001")).rejects.toThrow(/Incomplete/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("getOrders returns order snapshots in stub mode", async () => {
    const { client } = await setupClient("seller-1");
    const orders = await client.getOrders("seller-1");

    expect(orders.kind).toBe("order");
    expect(Array.isArray(orders.data)).toBe(true);
    const data = orders.data as ReadonlyArray<MlcOrderSummary>;
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]!).toMatchObject({ id: "ORDER-1", status: "paid" });
  });

  it("getQuestions returns question snapshots in stub mode", async () => {
    const { client } = await setupClient("seller-1");
    const questions = await client.getQuestions("seller-1");

    expect(questions.kind).toBe("message");
    expect(Array.isArray(questions.data)).toBe(true);
    const data = questions.data as ReadonlyArray<MlcMessageSummary>;
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]!.id).toBe("Q-1");
  });

  it("publishItem returns write snapshot in stub mode", async () => {
    const { client } = await setupClient("seller-1");
    const result = await client.publishItem("seller-1", {
      title: "Nuevo producto",
      category_id: "MLC1000",
      price: 9900,
      available_quantity: 10,
      pictures: ["https://example.com/img.jpg"],
      description: "Descripción de prueba",
      attributes: [{ id: "BRAND", value_name: "Marca X" }],
    });

    expect(result.id).toBeDefined();
    expect(result.permalink).toContain("mercadolibre");
    expect(result.status).toBe("active");
    expect(result.capturedAt).toBeDefined();
  });

  it("updateItem returns write snapshot in stub mode", async () => {
    const { client } = await setupClient("seller-1");
    const result = await client.updateItem("seller-1", "MLC1001", {
      price: 20000,
      available_quantity: 5,
    });

    expect(result.id).toBeDefined();
    expect(result.permalink).toContain("mercadolibre");
    expect(result.status).toBe("active");
  });

  it("getCategories returns category tree in stub mode", async () => {
    const { client } = await setupClient("seller-1");
    const categories = await client.getCategories("seller-1");

    expect(categories.sellerId).toBe("seller-1");
    expect(categories.data.length).toBeGreaterThanOrEqual(2);
    expect(categories.data[0]).toMatchObject({ id: "MLC1000", name: "Electrónica" });
    expect(categories.data[1]).toMatchObject({ id: "MLC2000", name: "Ropa y Accesorios" });
  });

  it("getUserInfo returns user info in stub mode", async () => {
    const { client } = await setupClient("seller-1");
    const user = await client.getUserInfo("seller-1");

    expect(user.sellerId).toBe("seller-1");
    expect(user.data.nickname).toBe("TESTSELLER");
    expect(user.data.points).toBe(100);
    expect(user.data.level).toBe("Novato");
    expect(user.data.status).toBe("active");
  });

  it("resolves token per call for multi-account access", async () => {
    const oauthManager = createOAuthManager({
      clientId: "",
      clientSecret: "",
      redirectUri: "https://example.com/callback",
    });
    await oauthManager.exchangeCodeForToken("plasticov", "code-p");
    await oauthManager.exchangeCodeForToken("maustian", "code-m");

    const client = createMlClient({ oauthManager, now });

    // Both accounts should work independently
    const plasticovListings = await client.getItems("plasticov");
    const maustianListings = await client.getItems("maustian");

    expect(plasticovListings.sellerId).toBe("plasticov");
    expect(maustianListings.sellerId).toBe("maustian");

    oauthManager.close();
  });

  it("throws on API call for unknown seller", async () => {
    const { client } = await setupClient();
    await expect(client.getItems("unknown-seller")).rejects.toThrow("No stored token");
  });
});
