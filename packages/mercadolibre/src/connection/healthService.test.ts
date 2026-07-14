import { describe, expect, it, vi } from "vitest";
import type { OAuthManager } from "../oauth/oauthManager.js";
import { MercadoLibreRefreshError } from "../oauth/oauthManager.js";
import type { TokenStore } from "../oauth/tokenStore.js";
import type { MlAccountEntry, SmokeEndpointResult } from "./state.js";
import {
  createMercadoLibreConnectionHealthService,
  type MercadoLibreConnectionHealthService,
  type MercadoLibreReadOnlySmokeService,
} from "./healthService.js";

// ── Stubs ──────────────────────────────────────────────────────────

function stubTokenStore(overrides: Partial<TokenStore> = {}): TokenStore {
  return {
    saveToken: () => {},
    getToken: () => undefined,
    deleteToken: () => {},
    withLock: async (_sellerId, fn) => fn(),
    close: () => {},
    ...overrides,
  };
}

function stubOAuthManager(overrides: Partial<OAuthManager> = {}): OAuthManager {
  return {
    getAuthorizationUrl: () => "https://auth.example.com",
    exchangeCodeForToken: () => Promise.reject(new Error("not implemented")),
    refreshAccessToken: () => Promise.reject(new Error("not implemented")),
    isTokenExpired: () => false,
    ensureValidToken: () => Promise.resolve("mock-access-token"),
    getStoredToken: () => undefined,
    deleteToken: () => {},
    isStubMode: () => true,
    close: () => {},
    ...overrides,
  };
}

function stubSmokeService(identitySuccess = true): MercadoLibreReadOnlySmokeService {
  return {
    runIdentitySmoke: (sellerId) =>
      Promise.resolve({
        endpoint: "GET /users/{sellerId}",
        success: identitySuccess,
        seller: sellerId,
        statusCode: identitySuccess ? 200 : 401,
        ...(identitySuccess ? {} : { reasonCode: "seller_mismatch" }),
      } satisfies SmokeEndpointResult),
    runOrdersSmoke: (sellerId) =>
      Promise.resolve({
        endpoint: "GET /orders/search",
        success: true,
        seller: sellerId,
        statusCode: 200,
        count: 3,
      }),
    runItemsSmoke: (sellerId) =>
      Promise.resolve({
        endpoint: "GET /users/{sellerId}/items/search",
        success: true,
        seller: sellerId,
        statusCode: 200,
        count: 5,
      }),
    runFullSmoke: async (sellerId) => {
      const svc = stubSmokeService(identitySuccess);
      const [identity, orders, items] = await Promise.all([
        svc.runIdentitySmoke(sellerId),
        svc.runOrdersSmoke(sellerId),
        svc.runItemsSmoke(sellerId),
      ]);
      return [identity, orders, items];
    },
  };
}

// ── Fixtures ───────────────────────────────────────────────────────

function plasticovEntry(overrides: Partial<MlAccountEntry> = {}): MlAccountEntry {
  return {
    accountRole: "source",
    accountName: "Plasticov",
    sellerId: "111111",
    oauthAppBinding: "111111",
    tokenStoreBinding: "111111",
    operationalScope: "mlc",
    cortexScope: "mlc-plasticov",
    readCapability: "mercadolibre-read-plasticov",
    writeCapability: "mercadolibre-write-plasticov",
    expectedIdentity: "111111",
    enabled: true,
    connectionPolicy: "read-only",
    ...overrides,
  };
}

function maustianEntry(overrides: Partial<MlAccountEntry> = {}): MlAccountEntry {
  return {
    accountRole: "target",
    accountName: "Maustian",
    sellerId: "222222",
    oauthAppBinding: "222222",
    tokenStoreBinding: "222222",
    operationalScope: "mlc",
    cortexScope: "mlc-maustian",
    readCapability: "mercadolibre-read-maustian",
    writeCapability: "mercadolibre-write-maustian",
    expectedIdentity: "222222",
    enabled: true,
    connectionPolicy: "read-only",
    ...overrides,
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function makeService(
  overrides: {
    registry?: MlAccountEntry[];
    oauthManager?: OAuthManager;
    store?: TokenStore;
    smokeService?: MercadoLibreReadOnlySmokeService;
    clock?: { now(): number };
  } = {},
): MercadoLibreConnectionHealthService {
  const options: import("./healthService.js").HealthServiceOptions = {
    registry: overrides.registry ?? [plasticovEntry()],
    oauthManager: overrides.oauthManager ?? stubOAuthManager(),
    clock: overrides.clock ?? { now: () => FIXED_NOW },
  };
  if (overrides.store !== undefined) options.store = overrides.store;
  if (overrides.smokeService !== undefined) options.smokeService = overrides.smokeService;
  return createMercadoLibreConnectionHealthService(options);
}

const FIXED_NOW = 1_700_000_000_000; // ~Nov 2023
const FIXED_EXPIRES_AT = new Date(FIXED_NOW + 30 * 60 * 1000).toISOString(); // +30 minutes

// ── Tests ──────────────────────────────────────────────────────────

describe("MercadoLibreConnectionHealthService", () => {
  describe("inspect (inspect-only)", () => {
    it("returns status ready when token is valid", async () => {
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: FIXED_EXPIRES_AT,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ store });
      const result = await svc.inspect("111111");
      expect(result.status).toBe("ready");
      expect(result.tokenStatus).toBe("valid");
      expect(result.tokenExpiresAt).toBe(FIXED_EXPIRES_AT);
      expect(result.readReady).toBe(true);
      expect(result.writeReady).toBe(false);
      expect(result.noExternalMutationExecuted).toBe(true);
    });

    it("returns status disconnected when token is missing", async () => {
      const store = stubTokenStore({
        getToken: () => undefined,
      });
      const svc = makeService({ store });
      const result = await svc.inspect("111111");
      expect(result.status).toBe("disconnected");
      expect(result.tokenStatus).toBe("missing");
      expect(result.reasonCodes).toContain("token_missing");
      expect(result.readReady).toBe(false);
    });

    it("returns status blocked when token store is unavailable", async () => {
      // Create service without store to simulate unavailable
      const svc = createMercadoLibreConnectionHealthService({
        registry: [plasticovEntry()],
        oauthManager: stubOAuthManager(),
        clock: { now: () => FIXED_NOW },
      });
      const result = await svc.inspect("111111");
      expect(result.status).toBe("blocked");
      expect(result.tokenStatus).toBe("missing");
      expect(result.reasonCodes).toContain("store_unavailable");
    });

    it("returns status blocked when decryption fails", async () => {
      const store = stubTokenStore({
        getToken: () => {
          throw new Error("Decryption failed");
        },
      });
      const svc = makeService({ store });
      const result = await svc.inspect("111111");
      expect(result.status).toBe("blocked");
      expect(result.tokenStatus).toBe("decryption-failed");
      expect(result.reasonCodes).toContain("decryption_failed");
    });

    it("returns status degraded when token is expiring", async () => {
      // Token expires in 3 minutes — within 5-min expiry window
      const almostExpired = new Date(FIXED_NOW + 3 * 60 * 1000).toISOString();
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: almostExpired,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ store });
      const result = await svc.inspect("111111");
      expect(result.status).toBe("degraded");
      expect(result.tokenStatus).toBe("expiring");
      expect(result.reasonCodes).toContain("token_expiring");
    });

    it("does not make any API calls", async () => {
      const ensureValidToken = vi.fn();
      const oauth = stubOAuthManager({ ensureValidToken });
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: FIXED_EXPIRES_AT,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ oauthManager: oauth, store });
      await svc.inspect("111111");
      expect(ensureValidToken).not.toHaveBeenCalled();
    });

    it("throws for unknown seller", async () => {
      const svc = makeService();
      await expect(svc.inspect("unknown")).rejects.toThrow("Unknown seller");
    });
  });

  describe("inspectAll", () => {
    it("returns health for all registered sellers", async () => {
      const store = stubTokenStore({
        getToken: (sellerId: string) =>
          sellerId === "111111"
            ? {
                seller_id: "111111",
                access_token: "access-token",
                refresh_token: "refresh-token",
                expires_at: FIXED_EXPIRES_AT,
                user_id: "111111",
                nickname: "PLASTICOV",
                account_level: "classic",
              }
            : undefined,
      });
      const svc = makeService({
        registry: [plasticovEntry(), maustianEntry()],
        store,
      });
      const results = await svc.inspectAll();
      expect(results).toHaveLength(2);
      expect(results[0]!.sellerId).toBe("111111");
      expect(results[0]!.status).toBe("ready");
      expect(results[1]!.sellerId).toBe("222222");
      expect(results[1]!.status).toBe("disconnected");
    });
  });

  describe("refreshIfNeeded", () => {
    it("does not refresh when token is valid", async () => {
      const ensureValidToken = vi.fn();
      const oauth = stubOAuthManager({ ensureValidToken });
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: FIXED_EXPIRES_AT,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ oauthManager: oauth, store });
      const result = await svc.refreshIfNeeded("111111");
      expect(result.status).toBe("ready");
      expect(ensureValidToken).not.toHaveBeenCalled();
    });

    it("refreshes when token is expired", async () => {
      const expiredAt = new Date(FIXED_NOW - 10 * 60 * 1000).toISOString(); // 10 min ago
      const newExpiry = new Date(FIXED_NOW + 60 * 60 * 1000).toISOString(); // +1 hour
      const ensureValidToken = vi.fn().mockResolvedValue("new-access-token");
      const oauth = stubOAuthManager({
        ensureValidToken,
        getStoredToken: () => ({
          seller_id: "111111",
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_at: newExpiry,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "old-token",
          refresh_token: "old-refresh",
          expires_at: expiredAt,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ oauthManager: oauth, store });
      const result = await svc.refreshIfNeeded("111111");
      expect(result.status).toBe("ready");
      expect(result.tokenStatus).toBe("refreshed");
      expect(result.tokenExpiresAt).toBe(newExpiry);
      expect(ensureValidToken).toHaveBeenCalledWith("111111");
    });

    it("returns reauthorization-required on invalid_grant", async () => {
      const expiredAt = new Date(FIXED_NOW - 10 * 60 * 1000).toISOString();
      const oauth = stubOAuthManager({
        ensureValidToken: () =>
          Promise.reject(
            new MercadoLibreRefreshError("invalid_grant", "Refresh token revoked", "111111", false),
          ),
      });
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "old-token",
          refresh_token: "old-refresh",
          expires_at: expiredAt,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ oauthManager: oauth, store });
      const result = await svc.refreshIfNeeded("111111");
      expect(result.status).toBe("reauthorization-required");
      expect(result.tokenStatus).toBe("refresh-rejected");
      expect(result.reasonCodes).toContain("invalid_grant");
    });

    it("returns degraded on network error during refresh", async () => {
      const expiredAt = new Date(FIXED_NOW - 10 * 60 * 1000).toISOString();
      const oauth = stubOAuthManager({
        ensureValidToken: () =>
          Promise.reject(
            new MercadoLibreRefreshError("network_error", "Connection refused", "111111", true),
          ),
      });
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "old-token",
          refresh_token: "old-refresh",
          expires_at: expiredAt,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ oauthManager: oauth, store });
      const result = await svc.refreshIfNeeded("111111");
      expect(result.status).toBe("degraded");
      expect(result.reasonCodes).toContain("network_error");
    });

    it("does not refresh when token is missing (no stored token)", async () => {
      const ensureValidToken = vi.fn();
      const oauth = stubOAuthManager({ ensureValidToken });
      const store = stubTokenStore({ getToken: () => undefined });
      const svc = makeService({ oauthManager: oauth, store });
      const result = await svc.refreshIfNeeded("111111");
      expect(result.status).toBe("disconnected");
      expect(result.tokenStatus).toBe("missing");
      expect(ensureValidToken).not.toHaveBeenCalled();
    });

    it("does not refresh when decryption fails", async () => {
      const ensureValidToken = vi.fn();
      const oauth = stubOAuthManager({ ensureValidToken });
      const store = stubTokenStore({
        getToken: () => {
          throw new Error("Decryption failed");
        },
      });
      const svc = makeService({ oauthManager: oauth, store });
      const result = await svc.refreshIfNeeded("111111");
      expect(result.status).toBe("blocked");
      expect(result.tokenStatus).toBe("decryption-failed");
      expect(ensureValidToken).not.toHaveBeenCalled();
    });

    it("maintains seller isolation — Plasticov refresh does not change Maustian", async () => {
      const plasticovEnsureValid = vi.fn().mockResolvedValue("new-p-token");
      const maustianEnsureValid = vi.fn();

      const clock = { now: () => FIXED_NOW };

      // Single shared store with both sellers' tokens
      const tokenMap = new Map<
        string,
        {
          seller_id: string;
          access_token: string;
          refresh_token: string;
          expires_at: string;
          user_id: string;
          nickname: string;
          account_level: string;
        }
      >();
      // Plasticov: expired token
      tokenMap.set("111111", {
        seller_id: "111111",
        access_token: "expired-p",
        refresh_token: "expired-r",
        expires_at: new Date(FIXED_NOW - 10 * 60 * 1000).toISOString(),
        user_id: "111111",
        nickname: "PLASTICOV",
        account_level: "classic",
      });
      // Maustian: valid token
      tokenMap.set("222222", {
        seller_id: "222222",
        access_token: "m-token",
        refresh_token: "m-refresh",
        expires_at: FIXED_EXPIRES_AT,
        user_id: "222222",
        nickname: "MAUSTIAN",
        account_level: "classic",
      });

      const store = stubTokenStore({
        getToken: (sellerId: string) => tokenMap.get(sellerId),
      });

      // Separate oauth managers for each seller
      const pOauth = stubOAuthManager({
        ensureValidToken: plasticovEnsureValid,
        getStoredToken: (sellerId: string) => tokenMap.get(sellerId),
      });
      const mOauth = stubOAuthManager({
        ensureValidToken: maustianEnsureValid,
        getStoredToken: (sellerId: string) => tokenMap.get(sellerId),
      });

      // Create two independent services
      const pSvc = createMercadoLibreConnectionHealthService({
        registry: [plasticovEntry()],
        oauthManager: pOauth,
        store,
        clock,
      });

      const mSvc = createMercadoLibreConnectionHealthService({
        registry: [maustianEntry()],
        oauthManager: mOauth,
        store,
        clock,
      });

      // Refresh Plasticov (expired token → should call ensureValidToken)
      const pResult = await pSvc.refreshIfNeeded("111111");
      expect(plasticovEnsureValid).toHaveBeenCalledTimes(1);
      expect(pResult.tokenStatus).toBe("refreshed");

      // Now check Maustian — valid token → should NOT call ensureValidToken
      const mResult = await mSvc.refreshIfNeeded("222222");
      expect(maustianEnsureValid).not.toHaveBeenCalled();
      expect(mResult.status).toBe("ready");
      expect(mResult.tokenStatus).toBe("valid");
    });
  });

  describe("smokeRead", () => {
    it("runs smoke service on success path", async () => {
      const smoke = stubSmokeService(true);
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: FIXED_EXPIRES_AT,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ store, smokeService: smoke });
      const result = await svc.smokeRead("111111");
      expect(result.status).toBe("ready");
    });

    it("returns blocked on identity mismatch in smoke", async () => {
      const smoke = stubSmokeService(false); // identity fails
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: FIXED_EXPIRES_AT,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ store, smokeService: smoke });
      const result = await svc.smokeRead("111111");
      expect(result.status).toBe("blocked");
      expect(result.reasonCodes).toContain("seller_mismatch");
    });

    it("returns degraded when smoke service is not configured", async () => {
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: FIXED_EXPIRES_AT,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ store }); // no smoke service
      const result = await svc.smokeRead("111111");
      expect(result.reasonCodes).toContain("smoke_unavailable");
    });
  });

  describe("no-network mode", () => {
    it("performs config-only validation without API calls", async () => {
      const ensureValidToken = vi.fn();
      const oauth = stubOAuthManager({ ensureValidToken });
      const svc = makeService({ oauthManager: oauth });
      const result = await svc.healthByMode("111111", "no-network");
      expect(result.status).toBe("degraded");
      expect(result.reasonCodes).toContain("no_network");
      expect(ensureValidToken).not.toHaveBeenCalled();
      expect(result.noExternalMutationExecuted).toBe(true);
    });

    it("returns blocked for disabled entry in no-network mode", async () => {
      const svc = makeService({
        registry: [plasticovEntry({ enabled: false })],
      });
      const result = await svc.healthByMode("111111", "no-network");
      expect(result.status).toBe("blocked");
      expect(result.reasonCodes).toContain("disabled");
    });
  });

  describe("healthByMode dispatch", () => {
    it("dispatches to inspect-only", async () => {
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: FIXED_EXPIRES_AT,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ store });
      const result = await svc.healthByMode("111111", "inspect-only");
      expect(result.status).toBe("ready");
      expect(result.tokenStatus).toBe("valid");
    });

    it("dispatches to refresh-if-needed", async () => {
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: FIXED_EXPIRES_AT,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ store });
      const result = await svc.healthByMode("111111", "refresh-if-needed");
      expect(result.status).toBe("ready");
    });
  });

  describe("security constraints", () => {
    it("never includes tokens in health output", async () => {
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "super-secret-token-abc123",
          refresh_token: "super-secret-refresh-xyz789",
          expires_at: FIXED_EXPIRES_AT,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ store });
      const result = await svc.inspect("111111");
      const json = JSON.stringify(result);
      expect(json).not.toContain("super-secret-token-abc123");
      expect(json).not.toContain("super-secret-refresh-xyz789");
      expect(json).not.toContain("access_token");
      expect(json).not.toContain("refresh_token");
    });

    it("noExternalMutationExecuted is always true", async () => {
      const svc = makeService();
      const results = await Promise.all([
        svc.inspect("111111"),
        svc.healthByMode("111111", "no-network"),
      ]);
      for (const r of results) {
        expect(r.noExternalMutationExecuted).toBe(true);
      }
    });

    it("writeReady is always false across all modes", async () => {
      const store = stubTokenStore({
        getToken: () => ({
          seller_id: "111111",
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: FIXED_EXPIRES_AT,
          user_id: "111111",
          nickname: "PLASTICOV",
          account_level: "classic",
        }),
      });
      const svc = makeService({ store });
      const modes = ["inspect-only", "refresh-if-needed", "no-network"] as const;
      for (const mode of modes) {
        const result = await svc.healthByMode("111111", mode);
        expect(result.writeReady).toBe(false);
      }
    });
  });
});
