import { describe, expect, it } from "vitest";

import {
  createMlcApiClient,
  evaluateOAuthAccess,
  type MercadoLibreApiTransport,
  type OAuthTokenState,
} from "./index.js";

const now = new Date("2026-06-25T12:00:00.000Z");

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

  it("normalizes listing, order, message, and reputation snapshots with metadata", async () => {
    const payloads: Record<string, unknown> = {
      "/users/seller-1/items/search": {
        results: [
          { id: "MLC-1", title: "Listing one", status: "active", price: 12000, currency_id: "CLP" },
        ],
      },
      "/orders/search": {
        results: [
          { id: 1001, status: "paid", total_amount: 12000, buyer: { id: 501 } },
        ],
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
        },
      },
    };
    const transport: MercadoLibreApiTransport = {
      request: (request) => Promise.resolve(payloads[request.path]),
    };
    const client = createMlcApiClient({ tokenState: tokenState(), transport, now });

    await expect(client.getListings("seller-1")).resolves.toMatchObject({
      sellerId: "seller-1",
      kind: "listing",
      source: "mercadolibre-api",
      data: [{ id: "MLC-1", title: "Listing one", status: "active" }],
      completeness: "complete",
      freshness: { source: "mercadolibre-api", signalKind: "listing", risk: "medium", status: "fresh" },
      confidence: "high",
    });
    await expect(client.getOrders("seller-1")).resolves.toMatchObject({
      kind: "order",
      data: [{ id: "1001", status: "paid", totalAmount: 12000, buyerId: "501" }],
      completeness: "complete",
      confidence: "high",
    });
    await expect(client.getMessages("seller-1")).resolves.toMatchObject({
      kind: "message",
      data: [{ id: "message-1", subject: "Question", fromUserId: "501" }],
      completeness: "complete",
      confidence: "high",
    });
    await expect(client.getReputation("seller-1")).resolves.toMatchObject({
      kind: "reputation",
      data: { level: "5_green", completedTransactions: 95, positiveRating: 0.98 },
      completeness: "complete",
      confidence: "high",
    });
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
});
