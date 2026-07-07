import { createOAuthManager, type OAuthManager, type OAuthManagerConfig } from "./oauthManager.js";
import type { OAuthTokens, StoredToken } from "../types.js";

/**
 * Creates a multi-app OAuth manager that routes each seller to its own
 * OAuthManager backed by per-seller credentials.
 *
 * - All `OAuthManager` methods delegate to the inner manager for the given
 *   sellerId.
 * - If the config map has exactly one entry, any sellerId is routed to that
 *   single manager (backward compat pass-through).
 * - Unknown sellerId throws an `Unknown seller` error.
 * - `isStubMode()` (no-arg) returns `true` only when ALL inner managers are
 *   in stub mode.
 * - `close()` closes every inner manager.
 *
 * The per-seller `isStubMode(sellerId)` overload is intentionally omitted from
 * the `OAuthManager` interface — it is an internal implementation detail.
 */
export function createMultiAppOAuthManager(
  configs: ReadonlyMap<string, OAuthManagerConfig>,
): OAuthManager {
  const managers = new Map<string, OAuthManager>();

  for (const [sellerId, config] of configs) {
    managers.set(sellerId, createOAuthManager(config));
  }

  const passthrough = managers.size === 1 ? (managers.values().next().value as OAuthManager) : null;

  function resolve(sellerId: string): OAuthManager {
    if (passthrough) return passthrough;

    const manager = managers.get(sellerId);
    if (!manager) {
      throw new Error(`Unknown seller: ${sellerId}`);
    }
    return manager;
  }

  function getAuthorizationUrl(sellerId: string, state: string): string {
    return resolve(sellerId).getAuthorizationUrl(sellerId, state);
  }

  async function exchangeCodeForToken(sellerId: string, code: string): Promise<OAuthTokens> {
    return resolve(sellerId).exchangeCodeForToken(sellerId, code);
  }

  async function refreshAccessToken(sellerId: string): Promise<OAuthTokens> {
    return resolve(sellerId).refreshAccessToken(sellerId);
  }

  function isTokenExpired(sellerId: string): boolean {
    return resolve(sellerId).isTokenExpired(sellerId);
  }

  async function ensureValidToken(sellerId: string): Promise<string> {
    return resolve(sellerId).ensureValidToken(sellerId);
  }

  function getStoredToken(sellerId: string): StoredToken | undefined {
    return resolve(sellerId).getStoredToken(sellerId);
  }

  function deleteToken(sellerId: string): void {
    resolve(sellerId).deleteToken(sellerId);
  }

  // Overloaded: no-arg (interface) + per-seller (internal).
  function isStubMode(): boolean;
  function isStubMode(sellerId: string): boolean;
  function isStubMode(sellerId?: string): boolean {
    if (sellerId !== undefined) {
      return resolve(sellerId).isStubMode();
    }

    if (managers.size === 0) return true;

    for (const manager of managers.values()) {
      if (!manager.isStubMode()) return false;
    }
    return true;
  }

  function close(): void {
    for (const manager of managers.values()) {
      manager.close();
    }
  }

  return {
    getAuthorizationUrl,
    exchangeCodeForToken,
    refreshAccessToken,
    isTokenExpired,
    ensureValidToken,
    getStoredToken,
    deleteToken,
    isStubMode,
    close,
  };
}
