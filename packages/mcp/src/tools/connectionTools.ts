import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  MercadoLibreConnectionHealthService,
  MercadoLibreAccountConnectionHealth,
} from "@msl/mercadolibre";

import type { McpServerConfig } from "../index.js";
import { jsonResult, blockedResult } from "./utils.js";

// ── Health service access ───────────────────────────────────────────

function getHealthService(
  config: McpServerConfig,
): MercadoLibreConnectionHealthService | undefined {
  return config.connectionHealthService;
}

// ── Sanitization ────────────────────────────────────────────────────

/**
 * Removes any fields that could contain tokens, secrets, or PII.
 * The health service already sanitizes output — this is a defense-in-depth layer.
 */
function sanitizeHealth(health: MercadoLibreAccountConnectionHealth): Record<string, unknown> {
  return {
    sellerId: health.sellerId,
    accountRole: health.accountRole,
    accountName: health.accountName,
    status: health.status,
    tokenStatus: health.tokenStatus,
    checkedAt: health.checkedAt,
    readReady: health.readReady,
    writeReady: health.writeReady,
    reasonCodes: health.reasonCodes,
    reason: health.reason,
    ...(health.tokenExpiresAt !== undefined ? { tokenExpiresAt: health.tokenExpiresAt } : {}),
    noExternalMutationExecuted: health.noExternalMutationExecuted,
  };
}

function sanitizeHealthArray(
  healthArray: MercadoLibreAccountConnectionHealth[],
): Record<string, unknown>[] {
  return healthArray.map((h) => sanitizeHealth(h));
}

// ── Smoke result sanitization ───────────────────────────────────────

function sanitizeSmokeResult(health: MercadoLibreAccountConnectionHealth): {
  seller: { sellerId: string; accountRole: string; accountName: string };
  status: string;
  tokenStatus: string;
  readReady: boolean;
  checkedAt: string;
} {
  return {
    seller: {
      sellerId: health.sellerId,
      accountRole: health.accountRole,
      accountName: health.accountName,
    },
    status: health.status,
    tokenStatus: health.tokenStatus,
    readReady: health.readReady,
    checkedAt: health.checkedAt,
  };
}

// ── Registration ────────────────────────────────────────────────────

export function registerConnectionTools(
  server: McpServer,
  deps: {
    validateApiKey: (key?: string) => boolean;
    config: McpServerConfig;
  },
): void {
  const { validateApiKey, config } = deps;

  // ── inspect_mercadolibre_connections ──────────────────────────────

  server.registerTool(
    "inspect_mercadolibre_connections",
    {
      description:
        "Inspect MercadoLibre connection status for all configured sellers " +
        "(Plasticov and Maustian). Read-only, zero mutations. " +
        "Returns sanitized health report per seller: status, token validity, " +
        "read readiness, and reason codes. No tokens or secrets are exposed.",
      inputSchema: {
        msl_api_key: z.string().optional(),
      },
    },
    async ({ msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return blockedResult(
          "unauthorized",
          "Unauthorized MCP request. Provide a valid MSL MCP API key.",
        );
      }

      const healthService = getHealthService(config);
      if (!healthService) {
        return blockedResult(
          "missing-account-roles",
          "MercadoLibre connection health service is not available. " +
            "Configure OAuth credentials (MERCADOLIBRE_SOURCE_CLIENT_ID, " +
            "MERCADOLIBRE_TARGET_CLIENT_ID) and MSL_ENCRYPTION_KEY to enable " +
            "connection inspection.",
        );
      }

      try {
        const allHealth = await healthService.inspectAll();
        return jsonResult({
          connections: sanitizeHealthArray(allHealth),
          count: allHealth.length,
          noExternalMutationExecuted: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult(
          {
            error: "Failed to inspect MercadoLibre connections",
            detail: message,
            noExternalMutationExecuted: true,
          },
          true,
        );
      }
    },
  );

  // ── inspect_mercadolibre_account_health ─────────────────────────

  server.registerTool(
    "inspect_mercadolibre_account_health",
    {
      description:
        "Detailed health inspection for one MercadoLibre seller account. " +
        "Read-only. Returns detailed health: config, token, encryption, " +
        "identity, and API status. Sanitized — no tokens or secrets. " +
        "Zero mutations.",
      inputSchema: {
        sellerId: z
          .string()
          .describe("Seller identifier: 'source' (Plasticov) or 'target' (Maustian)"),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return blockedResult(
          "unauthorized",
          "Unauthorized MCP request. Provide a valid MSL MCP API key.",
        );
      }

      const healthService = getHealthService(config);
      if (!healthService) {
        return blockedResult(
          "missing-account-roles",
          "MercadoLibre connection health service is not available. " +
            "Configure OAuth credentials and MSL_ENCRYPTION_KEY to enable " +
            "connection health inspection.",
        );
      }

      // Map shorthand to real seller IDs
      const resolvedSellerId =
        sellerId === "source"
          ? process.env.MERCADOLIBRE_SOURCE_SELLER_ID
          : sellerId === "target"
            ? process.env.MERCADOLIBRE_TARGET_SELLER_ID
            : sellerId;

      if (!resolvedSellerId) {
        return blockedResult(
          "missing-account-roles",
          `Seller "${sellerId}" is not configured. Set MERCADOLIBRE_${sellerId.toUpperCase()}_SELLER_ID env var.`,
        );
      }

      try {
        const health = await healthService.inspect(resolvedSellerId);
        return jsonResult({
          ...sanitizeHealth(health),
          noExternalMutationExecuted: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult(
          {
            sellerId: resolvedSellerId,
            error: "Failed to inspect account health",
            detail: message,
            noExternalMutationExecuted: true,
          },
          true,
        );
      }
    },
  );

  // ── run_mercadolibre_read_smoke ─────────────────────────────────

  server.registerTool(
    "run_mercadolibre_read_smoke",
    {
      description:
        "Run read-only smoke tests against MercadoLibre for one seller. " +
        "Validates identity, orders access, and items access. Zero mutations. " +
        "Rate-limited. Returns smoke results with endpoint names and statuses only. " +
        "DO NOT run automatically — only when explicitly requested by the CEO.",
      inputSchema: {
        sellerId: z
          .string()
          .describe("Seller identifier: 'source' (Plasticov) or 'target' (Maustian)"),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return blockedResult(
          "unauthorized",
          "Unauthorized MCP request. Provide a valid MSL MCP API key.",
        );
      }

      const healthService = getHealthService(config);
      if (!healthService) {
        return blockedResult(
          "missing-account-roles",
          "MercadoLibre connection health service is not available. " +
            "Configure OAuth credentials and MSL_ENCRYPTION_KEY to enable " +
            "smoke testing.",
        );
      }

      // Map shorthand to real seller IDs
      const resolvedSellerId =
        sellerId === "source"
          ? process.env.MERCADOLIBRE_SOURCE_SELLER_ID
          : sellerId === "target"
            ? process.env.MERCADOLIBRE_TARGET_SELLER_ID
            : sellerId;

      if (!resolvedSellerId) {
        return blockedResult(
          "missing-account-roles",
          `Seller "${sellerId}" is not configured. Set MERCADOLIBRE_${sellerId.toUpperCase()}_SELLER_ID env var.`,
        );
      }

      try {
        const health = await healthService.smokeRead(resolvedSellerId);
        return jsonResult({
          ...sanitizeSmokeResult(health),
          noExternalMutationExecuted: true,
          warning:
            "Smoke tests involve real MercadoLibre API calls. " +
            "DO NOT run automatically — only when explicitly requested by the CEO.",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult(
          {
            sellerId: resolvedSellerId,
            error: "Smoke test failed",
            detail: message,
            noExternalMutationExecuted: true,
          },
          true,
        );
      }
    },
  );
}
