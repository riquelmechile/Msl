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
