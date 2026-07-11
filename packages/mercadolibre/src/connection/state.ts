// Pure types for MercadoLibre connection health, account registry, and
// operational state.  No runtime code — types only.

import type { OAuthManagerConfig } from "../oauth/oauthManager.js";
import type { TokenStore } from "../oauth/tokenStore.js";

// ── Connection Status ──────────────────────────────────────────────

export type MercadoLibreConnectionStatus =
  | "ready"
  | "degraded"
  | "blocked"
  | "disconnected"
  | "reauthorization-required";

// ── OAuth Token Status ─────────────────────────────────────────────

export type OAuthTokenStatus =
  | "valid"
  | "expiring"
  | "expired-refreshable"
  | "refreshing"
  | "refreshed"
  | "refresh-rejected"
  | "decryption-failed"
  | "missing";

// ── Connection Health ──────────────────────────────────────────────

export type MercadoLibreAccountConnectionHealth = {
  /** Seller identifier (e.g. MERCADOLIBRE_SOURCE_SELLER_ID value). */
  sellerId: string;
  /** Account role (source = Plasticov, target = Maustian). */
  accountRole: "source" | "target";
  /** Human-readable account name. */
  accountName: string;
  /** Aggregated connection status. */
  status: MercadoLibreConnectionStatus;
  /** Fine-grained token status. */
  tokenStatus: OAuthTokenStatus;
  /**
   * ISO-8601 timestamp of when the current access token expires, or
   * `undefined` when no token is stored.
   */
  tokenExpiresAt?: string;
  /**
   * ISO-8601 timestamp of when this health snapshot was taken.
   */
  checkedAt: string;
  /**
   * Human-readable reason for the current status when not `ready`.
   */
  reason?: string;
  /**
   * Machine-readable reason codes for diagnostic tooling.
   * E.g. ["seller_mismatch", "network_error"].
   */
  reasonCodes: string[];
  /**
   * Whether this seller's read capability is operational.
   */
  readReady: boolean;
  /**
   * Whether this seller's write capability is operational.
   * Always `false` in this PR — write is blocked at the gate.
   */
  writeReady: boolean;
  /**
   * Always `true` — this service never performs external mutations.
   */
  noExternalMutationExecuted: true;
};

// ── Refresh Error Codes ────────────────────────────────────────────

export type RefreshErrorCode =
  | "invalid_grant"
  | "invalid_client"
  | "decryption_failed"
  | "seller_mismatch"
  | "provider_unavailable"
  | "rate_limited"
  | "network_error"
  | "malformed_response";

// ── MercadoLibre Refresh Error ─────────────────────────────────────
//
// NOTE: The actual `MercadoLibreRefreshError` class lives in
// `packages/mercadolibre/src/oauth/oauthManager.js`.  Import it from there.
// This module only exports the `RefreshErrorCode` type used by the class.

// ── Account Entry (Registry) ───────────────────────────────────────

export type MlAccountEntry = {
  /** "source" (Plasticov) or "target" (Maustian). */
  accountRole: "source" | "target";
  /** Human-readable name for logging and CEO tools. */
  accountName: string;
  /** MercadoLibre user/seller identifier. */
  sellerId: string;
  /** Key into the `oauthConfigs` map resolved by `resolveOAuthConfigs`. */
  oauthAppBinding: string;
  /** Key into the TokenStore (same as `sellerId` in practice). */
  tokenStoreBinding: string;
  /** MercadoLibre Chile site scope. */
  operationalScope: "mlc";
  /** Capability tag for Cortex / operational reads. */
  cortexScope: "mlc" | "mlc-plasticov" | "mlc-maustian";
  /** Read capability identifier. */
  readCapability: "mercadolibre-read-plasticov" | "mercadolibre-read-maustian";
  /** Write capability identifier (always blocked in this PR). */
  writeCapability: "mercadolibre-write-plasticov" | "mercadolibre-write-maustian";
  /** Expected MercadoLibre user_id for identity verification. */
  expectedIdentity: string;
  /** Whether this account is enabled for health checks. */
  enabled: boolean;
  /** Connection policy — "read-only" in this PR. */
  connectionPolicy: "read-only" | "full-access";
};

// ── Smoke Endpoint Result ──────────────────────────────────────────

export type SmokeEndpointResult = {
  /** Endpoint path (e.g. "GET /users/me"). */
  endpoint: string;
  /** Whether the check succeeded. */
  success: boolean;
  /** Item/order count when applicable. */
  count?: number;
  /** Response duration in milliseconds. */
  duration?: number;
  /** HTTP status code. */
  statusCode?: number;
  /** Remaining rate-limit quota if reported by the API. */
  rateLimitRemaining?: number;
  /** Seller this smoke test ran against. */
  seller: string;
  /** Machine-readable reason code on failure. */
  reasonCode?: string;
};

// ── Registry Factory Input ─────────────────────────────────────────

export type CreateMercadoLibreAccountRegistryInput = {
  /** Raw environment record (process.env or equivalent). */
  env: Record<string, string | undefined>;
  /** Resolved per-seller OAuth configs from `resolveOAuthConfigs`. */
  oauthConfigs: ReadonlyMap<string, OAuthManagerConfig>;
  /** Token store for token existence checks. */
  tokenStore: TokenStore;
};
