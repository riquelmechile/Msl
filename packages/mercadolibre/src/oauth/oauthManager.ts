import type { OAuthTokens, StoredToken } from "../types.js";
import { assertOAuthAccountMatchesRole } from "../accountRoles.js";
import { createTokenStore, type TokenStore } from "./tokenStore.js";
import type { RefreshErrorCode } from "../connection/state.js";

export type OAuthManagerConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  dbPath?: string;
  /** Called after every token refresh so consumers can record observability metrics. */
  onTokenRefresh?: (sellerId: string) => void;
  /**
   * Clock for deterministic expiry calculations in tests.
   * Defaults to `Date.now`.
   */
  clock?: { now(): number };
};

// ── MercadoLibre Refresh Error ─────────────────────────────────────

export class MercadoLibreRefreshError extends Error {
  readonly code: RefreshErrorCode;
  readonly retryable: boolean;
  readonly sellerId: string;

  constructor(
    code: RefreshErrorCode,
    message: string,
    sellerId: string,
    retryable?: boolean,
  ) {
    super(message);
    this.name = "MercadoLibreRefreshError";
    this.code = code;
    this.retryable = retryable ?? false;
    this.sellerId = sellerId;
  }
}

export type OAuthManager = {
  getAuthorizationUrl(sellerId: string, state: string): string;
  exchangeCodeForToken(sellerId: string, code: string): Promise<OAuthTokens>;
  refreshAccessToken(sellerId: string): Promise<OAuthTokens>;
  isTokenExpired(sellerId: string): boolean;
  ensureValidToken(sellerId: string): Promise<string>;
  getStoredToken(sellerId: string): StoredToken | undefined;
  deleteToken(sellerId: string): void;
  isStubMode(): boolean;
  close(): void;
};

const ML_OAUTH_AUTH_URL = "https://auth.mercadolibre.cl/authorization";
const ML_OAUTH_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

function isStubCredentials(config: OAuthManagerConfig): boolean {
  return (
    !config.clientId ||
    !config.clientSecret ||
    config.clientId === "stub" ||
    config.clientId.startsWith("TEST-")
  );
}

let _mockTokenCounter = 0;

function mockTokens(sellerId: string): OAuthTokens {
  const ts = Date.now();
  const seq = _mockTokenCounter++;
  return {
    access_token: `mock-access-${sellerId}-${ts}-${seq}-a`,
    refresh_token: `mock-refresh-${sellerId}-${ts}-${seq}-r`,
    expires_in: 21600,
    user_id: `mock-user-${sellerId}`,
    nickname: `seller_${sellerId}`,
    account_level: "classic",
  };
}

export function createOAuthManager(config: OAuthManagerConfig): OAuthManager {
  const store: TokenStore = createTokenStore(config.dbPath ?? ":memory:");
  const stub = isStubCredentials(config);
  const now = config.clock?.now ?? (() => Date.now());

  function getAuthorizationUrl(sellerId: string, state: string): string {
    if (stub) {
      return `https://auth.mercadolibre.cl/authorization?response_type=code&client_id=${config.clientId}&redirect_uri=${encodeURIComponent(config.redirectUri)}&state=${encodeURIComponent(state)}&mock_seller=${encodeURIComponent(sellerId)}`;
    }

    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      state,
    });

    return `${ML_OAUTH_AUTH_URL}?${params.toString()}`;
  }

  async function exchangeCodeForToken(sellerId: string, code: string): Promise<OAuthTokens> {
    if (stub) {
      const tokens = mockTokens(sellerId);
      store.saveToken(sellerId, tokens);
      return tokens;
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    });

    const response = await fetch(ML_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`OAuth code exchange failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    assertOAuthAccountMatchesRole(sellerId, data.user_id as string | number | undefined);

    const tokens: OAuthTokens = {
      access_token: data.access_token as string,
      refresh_token: data.refresh_token as string,
      expires_in: (data.expires_in as number) ?? 21600,
      user_id: (data.user_id as string) ?? "",
      nickname: (data.nickname as string) ?? sellerId,
      account_level: (data.account_level as OAuthTokens["account_level"]) ?? "classic",
      ...(typeof data.scope === "string" ? { scope: data.scope } : {}),
    };

    store.saveToken(sellerId, tokens);
    return tokens;
  }

  async function refreshAccessToken(sellerId: string): Promise<OAuthTokens> {
    const stored = store.getToken(sellerId);
    if (!stored) {
      throw new Error(`No stored token for seller ${sellerId}`);
    }

    if (stub) {
      const tokens = mockTokens(sellerId);
      store.saveToken(sellerId, tokens);
      config.onTokenRefresh?.(sellerId);
      return tokens;
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: stored.refresh_token,
    });

    let response: Response;
    try {
      response = await fetch(ML_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        // Avoid hanging forever on network issues
        signal: AbortSignal.timeout?.(30_000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes("timeout") || message.includes("abort");
      throw new MercadoLibreRefreshError(
        isTimeout ? "network_error" : "network_error",
        `OAuth token refresh network error for seller ${sellerId}: ${message}`,
        sellerId,
        true,
      );
    }

    if (!response.ok) {
      const responseBody = await response.json().catch(() => ({})) as Record<string, unknown>;
      const errorCode = (responseBody.error as string) ?? "";
      const errorDesc = (responseBody.error_description as string) ?? "";

      // Per MercadoLibre OAuth docs: classify known error codes
      if (errorCode === "invalid_grant") {
        throw new MercadoLibreRefreshError(
          "invalid_grant",
          `OAuth token refresh failed (invalid_grant) for seller ${sellerId}. ${errorDesc} The refresh_token may have expired, already been consumed, or the seller may have revoked authorization. Re-authorization through the OAuth flow is required.`,
          sellerId,
          false,
        );
      }

      if (errorCode === "invalid_client") {
        throw new MercadoLibreRefreshError(
          "invalid_client",
          `OAuth token refresh failed (invalid_client) for seller ${sellerId}: ${errorDesc}`,
          sellerId,
          false,
        );
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        throw new MercadoLibreRefreshError(
          "rate_limited",
          `OAuth token refresh rate-limited for seller ${sellerId}${retryAfter ? ` (retry-after: ${retryAfter}s)` : ""}`,
          sellerId,
          true,
        );
      }

      // Malformed response or unexpected error
      throw new MercadoLibreRefreshError(
        "malformed_response",
        `OAuth token refresh failed for seller ${sellerId}: ${response.status} ${errorCode || "unknown"} - ${errorDesc}`,
        sellerId,
        true,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    // Per official docs: refresh_token is SINGLE-USE.
    // The API MUST return a new refresh_token on every refresh.
    const newRefreshToken = data.refresh_token as string | undefined;
    if (!newRefreshToken) {
      throw new MercadoLibreRefreshError(
        "malformed_response",
        `OAuth token refresh did not return a new refresh_token for seller ${sellerId}. ` +
          "The previous refresh_token may have already been consumed (single-use) or is invalid. " +
          "Re-authorization is required.",
        sellerId,
        false,
      );
    }

    const userIdFromRefresh = data.user_id as string | number | undefined;
    assertOAuthAccountMatchesRole(sellerId, userIdFromRefresh);

    const scope = data.scope as string | undefined;
    if (scope && !scope.includes("offline_access")) {
      throw new MercadoLibreRefreshError(
        "malformed_response",
        `OAuth token for seller ${sellerId} lacks offline_access scope. Received: "${scope}". ` +
          "Re-authorize the application with offline_access to receive refresh tokens.",
        sellerId,
        false,
      );
    }

    const tokens: OAuthTokens = {
      access_token: data.access_token as string,
      refresh_token: newRefreshToken,
      expires_in: (data.expires_in as number) ?? 21600,
      user_id: stored.user_id,
      nickname: stored.nickname,
      account_level: stored.account_level as OAuthTokens["account_level"],
      ...(scope ? { scope } : {}),
    };

    // Persist BEFORE firing callback — guarantee token is saved on success
    store.saveToken(sellerId, tokens);
    // Fire callback AFTER successful persistence
    config.onTokenRefresh?.(sellerId);
    return tokens;
  }

  function isTokenExpired(sellerId: string): boolean {
    const stored = store.getToken(sellerId);
    if (!stored) return true;

    const expiresAt = new Date(stored.expires_at);
    // Consider expired 60 seconds before actual expiration to allow buffer
    return expiresAt.getTime() - 60_000 <= now();
  }

  async function ensureValidToken(sellerId: string): Promise<string> {
    return store.withLock(sellerId, async () => {
      const stored = store.getToken(sellerId);
      if (!stored) {
        throw new Error(`No stored token for seller ${sellerId}`);
      }

      if (!isTokenExpired(sellerId)) {
        return stored.access_token;
      }

      const tokens = await refreshAccessToken(sellerId);
      return tokens.access_token;
    });
  }

  return {
    getAuthorizationUrl,
    exchangeCodeForToken,
    refreshAccessToken,
    isTokenExpired,
    ensureValidToken,
    getStoredToken: (sellerId: string) => store.getToken(sellerId),
    deleteToken: (sellerId: string) => store.deleteToken(sellerId),
    isStubMode: () => stub,
    close: () => store.close(),
  };
}
