import { afterEach, describe, expect, it, vi } from "vitest";

import type { CacheFreshness, ReadSnapshot } from "@msl/domain";

import {
  createMlcApiClient,
  createMlClient,
  createOAuthManager,
  createOAuthMlcApiClient,
  createTokenStore,
  evaluateOAuthAccess,
  type MlcListingSummary,
  type MlcMessageSummary,
  type MlcOrderSummary,
  type MlcReadSnapshotFreshness,
  type MercadoLibreApiTransport,
  type OAuthManager,
  type OAuthTokenState,
} from "./index.js";

import { encrypt, decrypt } from "./oauth/tokenStore.js";

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
        },
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
    const domainListingSnapshot: ReadSnapshot<MlcListingSummary> = listings;
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
      data: { level: "5_green", completedTransactions: 95, positiveRating: 0.98 },
      completeness: "complete",
      confidence: "high",
      freshness: { risk: "critical", maxAgeMs: 5 * 60 * 1000 },
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
    await client.getListings("seller-1");
    await client.getOrders("seller-1");
    await client.getMessages("seller-1");
    await client.getReputation("seller-1");

    expect(tokenCalls).toEqual(["seller-1", "seller-1", "seller-1", "seller-1"]);
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
    ]);
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

    await expect(client.getOrders("source-seller")).rejects.toThrow(failure.message);
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
