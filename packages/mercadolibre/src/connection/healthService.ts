import type { OAuthManager } from "../oauth/oauthManager.js";
import { MercadoLibreRefreshError } from "../oauth/oauthManager.js";
import type { TokenStore } from "../oauth/tokenStore.js";
import type {
  MercadoLibreAccountConnectionHealth,
  MercadoLibreConnectionStatus,
  MlAccountEntry,
  OAuthTokenStatus,
  SmokeEndpointResult,
} from "./state.js";

// ── Supporting types ───────────────────────────────────────────────

export type HealthServiceMode = "inspect-only" | "refresh-if-needed" | "smoke-read" | "no-network";

export type StructuredLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

export type MetricsCollector = {
  increment: (name: string, tags?: Record<string, string>) => void;
  gauge: (name: string, value: number, tags?: Record<string, string>) => void;
};

export type MercadoLibreReadOnlySmokeService = {
  runIdentitySmoke(sellerId: string): Promise<SmokeEndpointResult>;
  runOrdersSmoke(sellerId: string, limit?: number): Promise<SmokeEndpointResult>;
  runItemsSmoke(sellerId: string, limit?: number): Promise<SmokeEndpointResult>;
  runFullSmoke(sellerId: string): Promise<SmokeEndpointResult[]>;
};

export type HealthServiceOptions = {
  registry: MlAccountEntry[];
  oauthManager: OAuthManager;
  store?: TokenStore;
  smokeService?: MercadoLibreReadOnlySmokeService;
  clock?: { now(): number };
  logger?: StructuredLogger;
  metrics?: MetricsCollector;
};

export type MercadoLibreConnectionHealthService = {
  inspect(sellerId: string): Promise<MercadoLibreAccountConnectionHealth>;
  inspectAll(): Promise<MercadoLibreAccountConnectionHealth[]>;
  refreshIfNeeded(sellerId: string): Promise<MercadoLibreAccountConnectionHealth>;
  smokeRead(sellerId: string): Promise<MercadoLibreAccountConnectionHealth>;
  healthByMode(
    sellerId: string,
    mode: HealthServiceMode,
  ): Promise<MercadoLibreAccountConnectionHealth>;
};

// ── Constants ──────────────────────────────────────────────────────

/** Tokens expiring within this many seconds are considered "expiring" for health purposes. */
const TOKEN_EXPIRY_WINDOW_SECONDS = 5 * 60; // 5 minutes

// ── Factory ────────────────────────────────────────────────────────

export function createMercadoLibreConnectionHealthService(
  options: HealthServiceOptions,
): MercadoLibreConnectionHealthService {
  const { registry, oauthManager, store, smokeService, clock, logger, metrics } = options;
  const now = () => clock?.now() ?? Date.now();

  // ── Helpers ────────────────────────────────────────────────────

  function findEntry(sellerId: string): MlAccountEntry | undefined {
    return registry.find((e) => e.sellerId === sellerId);
  }

  function isoNow(): string {
    return new Date(now()).toISOString();
  }

  function makeHealth(
    entry: MlAccountEntry,
    status: MercadoLibreConnectionStatus,
    tokenStatus: OAuthTokenStatus,
    overrides: {
      reasonCodes?: string[] | undefined;
      tokenExpiresAt?: string | undefined;
      reason?: string | undefined;
      readReady?: boolean | undefined;
    } = {},
  ): MercadoLibreAccountConnectionHealth {
    return {
      sellerId: entry.sellerId,
      accountRole: entry.accountRole,
      accountName: entry.accountName,
      status,
      tokenStatus,
      checkedAt: isoNow(),
      readReady: overrides.readReady ?? (status === "ready" || status === "degraded"),
      writeReady: false,
      reasonCodes: overrides.reasonCodes ?? [],
      noExternalMutationExecuted: true,
      ...(overrides.tokenExpiresAt !== undefined
        ? { tokenExpiresAt: overrides.tokenExpiresAt }
        : {}),
      ...(overrides.reason !== undefined ? { reason: overrides.reason } : {}),
    };
  }

  function log(level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) {
    logger?.[level]?.(message, meta);
  }

  function metIncrement(name: string, tags?: Record<string, string>) {
    metrics?.increment?.(name, tags);
  }

  // ── Config validation ──────────────────────────────────────────

  function validateConfig(entry: MlAccountEntry): string[] {
    const reasons: string[] = [];
    if (!entry.enabled) {
      reasons.push("disabled");
    }
    return reasons;
  }

  type TokenInspection =
    | { kind: "present"; decryptable: true; token: { expires_at: string } }
    | { kind: "present"; decryptable: false }
    | { kind: "missing" }
    | { kind: "store-unavailable" };

  function inspectToken(entry: MlAccountEntry): TokenInspection {
    if (!store) return { kind: "store-unavailable" };
    try {
      const stored = store.getToken(entry.tokenStoreBinding);
      if (!stored) return { kind: "missing" };
      // Token was successfully decrypted by the store — check expiry
      return { kind: "present", decryptable: true, token: { expires_at: stored.expires_at } };
    } catch {
      // Decryption or store access failed
      return { kind: "present", decryptable: false };
    }
  }

  function evaluateTokenHealth(inspection: TokenInspection): {
    tokenStatus: OAuthTokenStatus;
    status: MercadoLibreConnectionStatus;
    reasonCodes: string[];
    tokenExpiresAt?: string;
    reason?: string;
  } {
    if (inspection.kind === "store-unavailable") {
      return {
        tokenStatus: "missing",
        status: "blocked",
        reasonCodes: ["store_unavailable"],
        reason: "Token store is not available for inspection",
      };
    }
    if (inspection.kind === "missing") {
      return {
        tokenStatus: "missing",
        status: "disconnected",
        reasonCodes: ["token_missing"],
        reason: "No stored token found",
      };
    }
    if (inspection.kind === "present" && !inspection.decryptable) {
      return {
        tokenStatus: "decryption-failed",
        status: "blocked",
        reasonCodes: ["decryption_failed"],
        reason: "Stored token could not be decrypted",
      };
    }

    // Token is decryptable — evaluate expiry
    const expiresAt = new Date(inspection.token.expires_at);
    const expiresAtMs = expiresAt.getTime();
    const currentMs = now();
    const bufferMs = TOKEN_EXPIRY_WINDOW_SECONDS * 1000;

    if (expiresAtMs <= currentMs) {
      return {
        tokenStatus: "expired-refreshable",
        status: "degraded",
        reasonCodes: ["token_expired"],
        tokenExpiresAt: expiresAt.toISOString(),
        reason: "Access token has expired",
      };
    }

    if (expiresAtMs - currentMs <= bufferMs) {
      return {
        tokenStatus: "expiring",
        status: "degraded",
        reasonCodes: ["token_expiring"],
        tokenExpiresAt: expiresAt.toISOString(),
        reason: "Access token expires soon",
      };
    }

    return {
      tokenStatus: "valid",
      status: "ready",
      reasonCodes: [],
      tokenExpiresAt: expiresAt.toISOString(),
    };
  }

  // ── Core modes ─────────────────────────────────────────────────

  function inspect(sellerId: string): Promise<MercadoLibreAccountConnectionHealth> {
    const entry = findEntry(sellerId);
    if (!entry) {
      log("warn", "healthService.inspect: unknown seller", { sellerId });
      return Promise.reject(new Error(`Unknown seller: ${sellerId}`));
    }

    const configReasons = validateConfig(entry);
    if (configReasons.length > 0) {
      return Promise.resolve(
        makeHealth(entry, "blocked", "missing", {
          reasonCodes: configReasons,
          reason: `Disabled: ${configReasons.join(", ")}`,
        }),
      );
    }

    const inspection = inspectToken(entry);
    const evaluation = evaluateTokenHealth(inspection);

    return Promise.resolve(
      makeHealth(entry, evaluation.status, evaluation.tokenStatus, {
        reasonCodes: evaluation.reasonCodes,
        tokenExpiresAt: evaluation.tokenExpiresAt,
        reason: evaluation.reason,
      }),
    );
  }

  async function inspectAll(): Promise<MercadoLibreAccountConnectionHealth[]> {
    const results = await Promise.allSettled(
      registry.map(async (entry) => {
        try {
          return await inspect(entry.sellerId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log("error", "healthService.inspectAll: failed for seller", {
            sellerId: entry.sellerId,
            error: message,
          });
          return makeHealth(entry, "blocked", "missing", {
            reasonCodes: ["inspect_error"],
            reason: `Inspection failed: ${message}`,
          });
        }
      }),
    );

    return results.map((r) =>
      r.status === "fulfilled" ? r.value : (r.reason as MercadoLibreAccountConnectionHealth),
    );
  }

  async function refreshIfNeeded(sellerId: string): Promise<MercadoLibreAccountConnectionHealth> {
    const entry = findEntry(sellerId);
    if (!entry) {
      log("warn", "healthService.refreshIfNeeded: unknown seller", { sellerId });
      throw new Error(`Unknown seller: ${sellerId}`);
    }

    const configReasons = validateConfig(entry);
    if (configReasons.length > 0) {
      return makeHealth(entry, "blocked", "missing", {
        reasonCodes: configReasons,
        reason: `Disabled: ${configReasons.join(", ")}`,
      });
    }

    // First, inspect the token locally
    const inspection = inspectToken(entry);
    const evaluation = evaluateTokenHealth(inspection);

    // Only refresh if token is expired or expiring (not valid)
    const needsRefresh = evaluation.tokenStatus !== "valid";

    if (!needsRefresh) {
      metIncrement("meli.health.token.valid", { seller: sellerId, account: entry.accountName });
      return makeHealth(entry, evaluation.status, evaluation.tokenStatus, {
        reasonCodes: evaluation.reasonCodes,
        tokenExpiresAt: evaluation.tokenExpiresAt,
        reason: evaluation.reason,
      });
    }

    // If no token is stored at all, we can't refresh — return the inspection result
    if (inspection.kind === "missing" || inspection.kind === "store-unavailable") {
      return makeHealth(entry, evaluation.status, evaluation.tokenStatus, {
        reasonCodes: evaluation.reasonCodes,
        reason: evaluation.reason,
      });
    }

    // If decryption failed, we can't refresh either
    if (inspection.kind === "present" && !inspection.decryptable) {
      return makeHealth(entry, evaluation.status, evaluation.tokenStatus, {
        reasonCodes: evaluation.reasonCodes,
        reason: evaluation.reason,
      });
    }

    // Attempt refresh via oauthManager
    try {
      log("info", "healthService.refreshIfNeeded: refreshing token", {
        sellerId,
        account: entry.accountName,
      });
      metIncrement("meli.health.refresh.attempt", { seller: sellerId });
      await oauthManager.ensureValidToken(sellerId);
      // Get the updated stored token to read new expiry
      const updated = oauthManager.getStoredToken(sellerId);
      if (!updated) {
        return makeHealth(entry, "disconnected", "missing", {
          reasonCodes: ["token_missing_after_refresh"],
          reason: "Token disappeared after refresh attempt",
        });
      }
      const expiresAt = new Date(updated.expires_at);
      metIncrement("meli.health.refresh.success", { seller: sellerId });
      return makeHealth(entry, "ready", "refreshed", {
        tokenExpiresAt: expiresAt.toISOString(),
        readReady: true,
      });
    } catch (err) {
      metIncrement("meli.health.refresh.error", { seller: sellerId });
      log("error", "healthService.refreshIfNeeded: refresh failed", {
        sellerId,
        account: entry.accountName,
        error: err instanceof Error ? err.message : String(err),
      });

      // Classify refresh errors
      if (err instanceof MercadoLibreRefreshError) {
        if (err.code === "invalid_grant" || err.code === "invalid_client") {
          return makeHealth(entry, "reauthorization-required", "refresh-rejected", {
            reasonCodes: [err.code],
            reason: `Token refresh rejected: ${err.message}`,
          });
        }
        if (err.code === "rate_limited") {
          return makeHealth(entry, "degraded", "expired-refreshable", {
            reasonCodes: ["rate_limited"],
            reason: `Refresh rate-limited: ${err.message}`,
          });
        }
        if (err.code === "network_error") {
          return makeHealth(entry, "degraded", evaluation.tokenStatus, {
            reasonCodes: ["network_error", ...evaluation.reasonCodes],
            tokenExpiresAt: evaluation.tokenExpiresAt,
            reason: `Network error during refresh: ${err.message}`,
          });
        }
        return makeHealth(entry, "degraded", evaluation.tokenStatus, {
          reasonCodes: [err.code, ...evaluation.reasonCodes],
          tokenExpiresAt: evaluation.tokenExpiresAt,
          reason: `Refresh failed: ${err.message}`,
        });
      }

      // Unknown error — treat as degraded
      const message = err instanceof Error ? err.message : String(err);
      return makeHealth(entry, "degraded", evaluation.tokenStatus, {
        reasonCodes: ["refresh_error", ...evaluation.reasonCodes],
        tokenExpiresAt: evaluation.tokenExpiresAt,
        reason: `Refresh failed: ${message}`,
      });
    }
  }

  async function smokeRead(sellerId: string): Promise<MercadoLibreAccountConnectionHealth> {
    const entry = findEntry(sellerId);
    if (!entry) {
      log("warn", "healthService.smokeRead: unknown seller", { sellerId });
      throw new Error(`Unknown seller: ${sellerId}`);
    }

    // Start with refresh-if-needed
    const afterRefresh = await refreshIfNeeded(sellerId);

    // If we're blocked/disconnected, smoke won't help
    if (afterRefresh.status === "blocked" || afterRefresh.status === "disconnected") {
      return afterRefresh;
    }

    if (!smokeService) {
      return {
        ...afterRefresh,
        reasonCodes: [...afterRefresh.reasonCodes, "smoke_unavailable"],
        reason: (afterRefresh.reason ?? "") + " (smoke service not configured)",
      };
    }

    // Run smoke checks
    const smokeResults: SmokeEndpointResult[] = [];
    try {
      log("info", "healthService.smokeRead: running identity smoke", {
        sellerId,
        account: entry.accountName,
      });
      metIncrement("meli.health.smoke.attempt", { seller: sellerId });

      const identityResult = await smokeService.runIdentitySmoke(sellerId);
      smokeResults.push(identityResult);

      // Only run orders/items if identity is verified
      if (identityResult.success) {
        const [ordersResult, itemsResult] = await Promise.all([
          smokeService.runOrdersSmoke(sellerId),
          smokeService.runItemsSmoke(sellerId),
        ]);
        smokeResults.push(ordersResult, itemsResult);
      }
    } catch (err) {
      log("error", "healthService.smokeRead: smoke failed", {
        sellerId,
        error: err instanceof Error ? err.message : String(err),
      });
      const allPassed = smokeResults.every((r) => r.success);
      return {
        ...afterRefresh,
        status: allPassed ? afterRefresh.status : "degraded",
        reasonCodes: [...afterRefresh.reasonCodes, "smoke_error"],
        reason: (afterRefresh.reason ?? "") + " (smoke test encountered an error)",
      };
    }

    // Evaluate smoke results
    const allPassed = smokeResults.every((r) => r.success);
    const hasFailures = smokeResults.some((r) => !r.success);

    // Check for identity mismatch specifically
    const identityCheck = smokeResults.find((r) => r.endpoint.includes("users"));
    const identityMismatch =
      identityCheck && !identityCheck.success && identityCheck.reasonCode === "seller_mismatch";

    if (identityMismatch) {
      return makeHealth(entry, "blocked", afterRefresh.tokenStatus, {
        tokenExpiresAt: afterRefresh.tokenExpiresAt,
        reasonCodes: ["seller_mismatch"],
        reason: "Identity verification failed — seller ID mismatch",
      });
    }

    if (!allPassed && hasFailures) {
      return {
        ...afterRefresh,
        status: "degraded",
        reasonCodes: [...afterRefresh.reasonCodes, "smoke_failure"],
        reason: (afterRefresh.reason ?? "") + " (some smoke checks failed)",
      };
    }

    if (allPassed && afterRefresh.status === "ready") {
      return afterRefresh;
    }

    return {
      ...afterRefresh,
      status: allPassed ? "ready" : "degraded",
      reasonCodes: allPassed
        ? afterRefresh.reasonCodes
        : [...afterRefresh.reasonCodes, "smoke_partial"],
    };
  }

  function noNetwork(sellerId: string): Promise<MercadoLibreAccountConnectionHealth> {
    const entry = findEntry(sellerId);
    if (!entry) {
      log("warn", "healthService.noNetwork: unknown seller", { sellerId });
      return Promise.reject(new Error(`Unknown seller: ${sellerId}`));
    }

    const configReasons = validateConfig(entry);
    if (configReasons.length > 0) {
      return Promise.resolve(
        makeHealth(entry, "blocked", "missing", {
          reasonCodes: configReasons,
          reason: `Disabled: ${configReasons.join(", ")}`,
        }),
      );
    }

    // Config-only validation — no API calls, no token store access
    return Promise.resolve(
      makeHealth(entry, "degraded", "missing", {
        reasonCodes: ["no_network"],
        reason: "No-network mode: config validation only, connectivity not verified",
      }),
    );
  }

  async function healthByMode(
    sellerId: string,
    mode: HealthServiceMode,
  ): Promise<MercadoLibreAccountConnectionHealth> {
    switch (mode) {
      case "inspect-only":
        return inspect(sellerId);
      case "refresh-if-needed":
        return refreshIfNeeded(sellerId);
      case "smoke-read":
        return smokeRead(sellerId);
      case "no-network":
        return noNetwork(sellerId);
    }
  }

  return {
    inspect,
    inspectAll,
    refreshIfNeeded,
    smokeRead,
    healthByMode,
  };
}

// ── ML Connection Health Check (for RuntimeHealth daemon integration) ─

export type MlConnectionHealthEvent = {
  event: string;
  sellerId: string;
  role: "source" | "target";
  accountName: string;
  /** Duration of the check in milliseconds. */
  duration: number;
  /** Machine-readable reason code for diagnostic tooling. */
  reasonCode?: string | undefined;
  /** ISO-8601 timestamp. */
  checkedAt: string;
};

export type MlConnectionHealthReport = {
  events: MlConnectionHealthEvent[];
  summary: Record<string, MercadoLibreConnectionStatus>;
};

/**
 * Runs per-seller ML connection health checks and returns structured events
 * suitable for inclusion in the periodic RuntimeHealth cycle.
 *
 * Emits structured events:
 * - `meli-account-configured` — account is registered
 * - `meli-token-inspected` — token validity checked
 * - `meli-identity-verified` / `meli-identity-mismatch`
 * - `meli-reauthorization-required`
 *
 * NEVER emits tokens, secrets, headers, or PII in events.
 */
export async function runMlConnectionHealthCheck(
  healthService: MercadoLibreConnectionHealthService,
  registry: MlAccountEntry[],
  logger?: StructuredLogger,
): Promise<MlConnectionHealthReport> {
  const events: MlConnectionHealthEvent[] = [];
  const summary: Record<string, MercadoLibreConnectionStatus> = {};
  const now = () => Date.now();

  for (const entry of registry) {
    if (!entry.enabled) {
      logger?.warn("meli-account-disabled", {
        sellerId: entry.sellerId,
        role: entry.accountRole,
        accountName: entry.accountName,
      });
      continue;
    }

    // Account configured event
    const configuredEvent: MlConnectionHealthEvent = {
      event: "meli-account-configured",
      sellerId: entry.sellerId,
      role: entry.accountRole,
      accountName: entry.accountName,
      duration: 0,
      checkedAt: new Date().toISOString(),
    };
    events.push(configuredEvent);
    logger?.info("meli-account-configured", {
      sellerId: entry.sellerId,
      role: entry.accountRole,
    });

    // Inspect token
    const startTime = now();
    try {
      const health = await healthService.inspect(entry.sellerId);
      const duration = now() - startTime;
      summary[entry.sellerId] = health.status;

      // Token inspected event
      events.push({
        event: "meli-token-inspected",
        sellerId: entry.sellerId,
        role: entry.accountRole,
        accountName: entry.accountName,
        duration,
        reasonCode: health.reasonCodes[0],
        checkedAt: new Date().toISOString(),
      });

      logger?.info("meli-token-inspected", {
        sellerId: entry.sellerId,
        role: entry.accountRole,
        duration,
        tokenStatus: health.tokenStatus,
        status: health.status,
        reasonCodes: health.reasonCodes,
      });

      // Identity verification events
      if (health.reasonCodes.includes("seller_mismatch")) {
        events.push({
          event: "meli-identity-mismatch",
          sellerId: entry.sellerId,
          role: entry.accountRole,
          accountName: entry.accountName,
          duration: 0,
          reasonCode: "seller_mismatch",
          checkedAt: new Date().toISOString(),
        });
        logger?.warn("meli-identity-mismatch", {
          sellerId: entry.sellerId,
          role: entry.accountRole,
        });
      } else if (health.readReady) {
        events.push({
          event: "meli-identity-verified",
          sellerId: entry.sellerId,
          role: entry.accountRole,
          accountName: entry.accountName,
          duration: 0,
          checkedAt: new Date().toISOString(),
        });
        logger?.info("meli-identity-verified", {
          sellerId: entry.sellerId,
          role: entry.accountRole,
        });
      }

      // Reauthorization required
      if (health.status === "reauthorization-required") {
        events.push({
          event: "meli-reauthorization-required",
          sellerId: entry.sellerId,
          role: entry.accountRole,
          accountName: entry.accountName,
          duration: 0,
          reasonCode: health.reasonCodes[0],
          checkedAt: new Date().toISOString(),
        });
        logger?.error("meli-reauthorization-required", {
          sellerId: entry.sellerId,
          role: entry.accountRole,
          reason: health.reason,
        });
      }
    } catch (err) {
      const duration = now() - startTime;
      const message = err instanceof Error ? err.message : String(err);
      summary[entry.sellerId] = "blocked";

      events.push({
        event: "meli-token-inspected",
        sellerId: entry.sellerId,
        role: entry.accountRole,
        accountName: entry.accountName,
        duration,
        reasonCode: "inspect_error",
        checkedAt: new Date().toISOString(),
      });

      logger?.error("meli-token-inspected", {
        sellerId: entry.sellerId,
        role: entry.accountRole,
        error: message,
      });
    }
  }

  return { events, summary };
}
