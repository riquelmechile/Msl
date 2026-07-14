import type { OAuthManager } from "../oauth/oauthManager.js";
import type { TokenStore } from "../oauth/tokenStore.js";
import type { SmokeEndpointResult } from "./state.js";

// ── Supporting types ───────────────────────────────────────────────

export type SmokeServiceOptions = {
  oauthManager: OAuthManager;
  store: TokenStore;
  clock?: { now(): number };
  noNetwork?: boolean;
};

export type MercadoLibreReadOnlySmokeService = {
  runIdentitySmoke(sellerId: string): Promise<SmokeEndpointResult>;
  runOrdersSmoke(sellerId: string, limit?: number): Promise<SmokeEndpointResult>;
  runItemsSmoke(sellerId: string, limit?: number): Promise<SmokeEndpointResult>;
  runFullSmoke(sellerId: string): Promise<SmokeEndpointResult[]>;
};

// ── Constants ──────────────────────────────────────────────────────

const ML_API_BASE = "https://api.mercadolibre.com";
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

// ── Helpers ────────────────────────────────────────────────────────

function createResult(
  endpoint: string,
  seller: string,
  overrides: {
    success?: boolean | undefined;
    statusCode?: number | undefined;
    count?: number | undefined;
    reasonCode?: string | undefined;
    rateLimitRemaining?: number | undefined;
    duration?: number | undefined;
  } = {},
): SmokeEndpointResult {
  const result: SmokeEndpointResult = {
    endpoint,
    success: overrides.success ?? false,
    seller,
  };
  if (overrides.statusCode !== undefined) result.statusCode = overrides.statusCode;
  if (overrides.count !== undefined) result.count = overrides.count;
  if (overrides.reasonCode !== undefined) result.reasonCode = overrides.reasonCode;
  if (overrides.rateLimitRemaining !== undefined)
    result.rateLimitRemaining = overrides.rateLimitRemaining;
  if (overrides.duration !== undefined) result.duration = overrides.duration;
  return result;
}

/**
 * Perform a GET request to the ML API with the specified seller's access token.
 * Handles errors gracefully — never throws.
 */
async function safeFetch(
  url: string,
  accessToken: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; data?: unknown; rateLimitRemaining?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    const status = response.status;

    if (status === 429) {
      return {
        ok: false,
        status,
        rateLimitRemaining: rateLimitRemaining ? Number.parseInt(rateLimitRemaining, 10) : 0,
      };
    }

    if (!response.ok) {
      // Try to get error body, but don't fail if we can't parse it
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        // body is not JSON — ignore
      }
      return { ok: false, status, data };
    }

    const data = await response.json();
    return {
      ok: true,
      status,
      data,
      ...(rateLimitRemaining != null
        ? { rateLimitRemaining: Number.parseInt(rateLimitRemaining, 10) }
        : {}),
    };
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    return {
      ok: false,
      status: isTimeout ? 408 : 0,
      data: { error: isTimeout ? "timeout" : "network_error" },
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Sanitization ────────────────────────────────────────────────────

/**
 * Strips all PII from a response object, returning only safe fields.
 * PII fields: user_id, nickname, email, phone, address, first_name, last_name,
 * buyer, seller contact info, identification numbers, etc.
 */
function sanitizeIdentityResponse(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const record = data as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  // Only allow `id` for identity verification
  if ("id" in record) safe.id = record.id;
  return safe;
}

// ── Factory ────────────────────────────────────────────────────────

export function createMercadoLibreReadOnlySmokeService(
  options: SmokeServiceOptions,
): MercadoLibreReadOnlySmokeService {
  const { oauthManager, store: _store, clock, noNetwork } = options;
  const now = () => clock?.now() ?? Date.now();

  async function getAccessToken(sellerId: string): Promise<string> {
    return oauthManager.ensureValidToken(sellerId);
  }

  async function runIdentitySmoke(sellerId: string): Promise<SmokeEndpointResult> {
    const startTime = now();

    if (noNetwork) {
      return createResult("GET /users/{sellerId}", sellerId, {
        success: false,
        statusCode: undefined,
        reasonCode: "skipped",
        duration: 0,
      });
    }

    try {
      const accessToken = await getAccessToken(sellerId);
      const url = `${ML_API_BASE}/users/${sellerId}`;
      const result = await safeFetch(url, accessToken, DEFAULT_FETCH_TIMEOUT_MS);
      const duration = now() - startTime;

      if (!result.ok) {
        if (result.status === 401) {
          return createResult("GET /users/{sellerId}", sellerId, {
            success: false,
            statusCode: 401,
            reasonCode: "auth_error",
            duration,
          });
        }
        if (result.status === 429) {
          return createResult("GET /users/{sellerId}", sellerId, {
            success: false,
            statusCode: 429,
            reasonCode: "rate_limited",
            rateLimitRemaining: result.rateLimitRemaining,
            duration,
          });
        }
        if (result.status === 408 || result.status === 0) {
          return createResult("GET /users/{sellerId}", sellerId, {
            success: false,
            statusCode: result.status || undefined,
            reasonCode: "network_error",
            duration,
          });
        }
        return createResult("GET /users/{sellerId}", sellerId, {
          success: false,
          statusCode: result.status,
          reasonCode: "server_error",
          duration,
        });
      }

      // Verify identity — the returned `id` must match the expected sellerId
      const safe = sanitizeIdentityResponse(result.data);
      const returnedId = safe.id as string | number | undefined;
      const returnedIdStr = returnedId !== undefined ? String(returnedId) : "";
      const expectedId = sellerId;

      if (!returnedId || returnedIdStr !== expectedId) {
        return createResult("GET /users/{sellerId}", sellerId, {
          success: false,
          statusCode: 200,
          reasonCode: "seller_mismatch",
          duration,
        });
      }

      return createResult("GET /users/{sellerId}", sellerId, {
        success: true,
        statusCode: 200,
        rateLimitRemaining: result.rateLimitRemaining,
        duration,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes("timeout") || message.includes("abort");
      return createResult("GET /users/{sellerId}", sellerId, {
        success: false,
        reasonCode: isTimeout ? "network_error" : "unexpected_error",
        duration: now() - startTime,
      });
    }
  }

  async function runOrdersSmoke(sellerId: string, limit = 3): Promise<SmokeEndpointResult> {
    const startTime = now();

    if (noNetwork) {
      return createResult("GET /orders/search", sellerId, {
        success: false,
        statusCode: undefined,
        reasonCode: "skipped",
        duration: 0,
      });
    }

    try {
      const accessToken = await getAccessToken(sellerId);
      const safeLimit = Math.min(Math.max(limit, 1), 5);
      const url = `${ML_API_BASE}/orders/search?seller=${encodeURIComponent(sellerId)}&limit=${safeLimit}&site=MLC`;
      const result = await safeFetch(url, accessToken, DEFAULT_FETCH_TIMEOUT_MS);
      const duration = now() - startTime;

      if (!result.ok) {
        if (result.status === 401) {
          return createResult("GET /orders/search", sellerId, {
            success: false,
            statusCode: 401,
            reasonCode: "auth_error",
            duration,
          });
        }
        if (result.status === 429) {
          return createResult("GET /orders/search", sellerId, {
            success: false,
            statusCode: 429,
            reasonCode: "rate_limited",
            rateLimitRemaining: result.rateLimitRemaining,
            duration,
          });
        }
        if (result.status === 408 || result.status === 0) {
          return createResult("GET /orders/search", sellerId, {
            success: false,
            statusCode: result.status || undefined,
            reasonCode: "network_error",
            duration,
          });
        }
        return createResult("GET /orders/search", sellerId, {
          success: false,
          statusCode: result.status,
          reasonCode: "server_error",
          duration,
        });
      }

      // Count results — no payload, no order data
      const data = result.data as Record<string, unknown> | undefined;
      const results = Array.isArray(data?.results) ? data.results : [];
      const count = results.length;

      return createResult("GET /orders/search", sellerId, {
        success: true,
        statusCode: 200,
        count,
        rateLimitRemaining: result.rateLimitRemaining,
        duration,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes("timeout") || message.includes("abort");
      return createResult("GET /orders/search", sellerId, {
        success: false,
        reasonCode: isTimeout ? "network_error" : "unexpected_error",
        duration: now() - startTime,
      });
    }
  }

  async function runItemsSmoke(sellerId: string, limit = 5): Promise<SmokeEndpointResult> {
    const startTime = now();

    if (noNetwork) {
      return createResult("GET /users/{sellerId}/items/search", sellerId, {
        success: false,
        statusCode: undefined,
        reasonCode: "skipped",
        duration: 0,
      });
    }

    try {
      const accessToken = await getAccessToken(sellerId);
      const safeLimit = Math.min(Math.max(limit, 1), 5);
      const url = `${ML_API_BASE}/users/${encodeURIComponent(sellerId)}/items/search?limit=${safeLimit}&site=MLC`;
      const result = await safeFetch(url, accessToken, DEFAULT_FETCH_TIMEOUT_MS);
      const duration = now() - startTime;

      if (!result.ok) {
        if (result.status === 401) {
          return createResult("GET /users/{sellerId}/items/search", sellerId, {
            success: false,
            statusCode: 401,
            reasonCode: "auth_error",
            duration,
          });
        }
        if (result.status === 429) {
          return createResult("GET /users/{sellerId}/items/search", sellerId, {
            success: false,
            statusCode: 429,
            reasonCode: "rate_limited",
            rateLimitRemaining: result.rateLimitRemaining,
            duration,
          });
        }
        if (result.status === 408 || result.status === 0) {
          return createResult("GET /users/{sellerId}/items/search", sellerId, {
            success: false,
            statusCode: result.status || undefined,
            reasonCode: "network_error",
            duration,
          });
        }
        return createResult("GET /users/{sellerId}/items/search", sellerId, {
          success: false,
          statusCode: result.status,
          reasonCode: "server_error",
          duration,
        });
      }

      // Count results — no item details, no payload
      const data = result.data as Record<string, unknown> | undefined;
      const results = Array.isArray(data?.results) ? data.results : [];
      const count = results.length;

      return createResult("GET /users/{sellerId}/items/search", sellerId, {
        success: true,
        statusCode: 200,
        count,
        rateLimitRemaining: result.rateLimitRemaining,
        duration,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes("timeout") || message.includes("abort");
      return createResult("GET /users/{sellerId}/items/search", sellerId, {
        success: false,
        reasonCode: isTimeout ? "network_error" : "unexpected_error",
        duration: now() - startTime,
      });
    }
  }

  async function runFullSmoke(sellerId: string): Promise<SmokeEndpointResult[]> {
    const [identity, orders, items] = await Promise.all([
      runIdentitySmoke(sellerId),
      runOrdersSmoke(sellerId),
      runItemsSmoke(sellerId),
    ]);
    return [identity, orders, items];
  }

  return {
    runIdentitySmoke,
    runOrdersSmoke,
    runItemsSmoke,
    runFullSmoke,
  };
}
