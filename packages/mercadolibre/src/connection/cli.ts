#!/usr/bin/env node
/**
 * MercadoLibre Connection CLI — production health operations.
 *
 * Usage:
 *   npx tsx packages/mercadolibre/src/connection/cli.ts status [--seller <id>] [--json]
 *   npx tsx packages/mercadolibre/src/connection/cli.ts refresh --seller <id> [--json]
 *   npx tsx packages/mercadolibre/src/connection/cli.ts smoke --seller <id> [--json]
 *   npx tsx packages/mercadolibre/src/connection/cli.ts connect-url --seller <id>
 */

import { loadRepositoryEnvironment } from "../env.js";
import { resolveOAuthConfigs } from "../oauth/oauthConfig.js";
import { createMultiAppOAuthManager } from "../oauth/multiAppOAuthManager.js";
import { createTokenStore } from "../oauth/tokenStore.js";
import { createMercadoLibreAccountRegistry } from "./registry.js";
import {
  createMercadoLibreConnectionHealthService,
} from "./healthService.js";
import { createMercadoLibreReadOnlySmokeService } from "./smokeService.js";
import type { MercadoLibreAccountConnectionHealth } from "./state.js";

// ── Arg parsing ────────────────────────────────────────────────────

function parseArgs(): {
  command: string;
  seller: string | undefined;
  json: boolean;
} {
  const args = process.argv.slice(2);
  const command = args[0] ?? "";
  const sellerIdx = args.indexOf("--seller");
  const seller = sellerIdx !== -1 ? args[sellerIdx + 1] : undefined;
  const json = args.includes("--json");

  return { command, seller, json };
}

function exit(code: number, message?: string): never {
  if (message) {
    if (code === 0) {
      process.stdout.write(`${message}\n`);
    } else {
      process.stderr.write(`${message}\n`);
    }
  }
  process.exit(code);
}

// ── Helpers ────────────────────────────────────────────────────────

function resolveSeller(
  seller: string,
  registry: ReturnType<typeof createMercadoLibreAccountRegistry>,
): string {
  const roleMap: Record<string, string> = {
    source: process.env.MERCADOLIBRE_SOURCE_SELLER_ID ?? "",
    target: process.env.MERCADOLIBRE_TARGET_SELLER_ID ?? "",
  };
  const resolved = roleMap[seller.toLowerCase()] ?? seller;
  const entry = registry.find((e) => e.sellerId === resolved);
  if (!entry) {
    exit(1, `Unknown seller: ${seller} (resolved: ${resolved})`);
  }
  return resolved;
}

function sanitizeHealth(health: MercadoLibreAccountConnectionHealth): Record<string, unknown> {
  return {
    sellerId: health.sellerId,
    accountRole: health.accountRole,
    accountName: health.accountName,
    status: health.status,
    tokenStatus: health.tokenStatus,
    tokenExpiresAt: health.tokenExpiresAt ?? null,
    checkedAt: health.checkedAt,
    reason: health.reason ?? null,
    reasonCodes: health.reasonCodes,
    readReady: health.readReady,
    writeReady: health.writeReady,
    noExternalMutationExecuted: health.noExternalMutationExecuted,
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// ── Bootstrap ──────────────────────────────────────────────────────

function bootstrap() {
  loadRepositoryEnvironment();

  const oauthDbPath = nonEmpty(process.env.MSL_MERCADOLIBRE_OAUTH_DB_PATH);
  if (!oauthDbPath) {
    exit(2, "MSL_MERCADOLIBRE_OAUTH_DB_PATH is not set");
  }

  const configs = resolveOAuthConfigs(process.env);
  if (configs.size === 0) {
    exit(2, "No OAuth configurations resolved from environment");
  }

  const oauthManager = createMultiAppOAuthManager(configs);
  const store = createTokenStore(oauthDbPath);
  const registry = createMercadoLibreAccountRegistry({
    env: process.env as Record<string, string | undefined>,
    oauthConfigs: configs,
    tokenStore: store,
  });
  const smokeService = createMercadoLibreReadOnlySmokeService({
    oauthManager,
    store,
  });
  const healthService = createMercadoLibreConnectionHealthService({
    registry,
    oauthManager,
    store,
    smokeService,
    clock: { now: () => Date.now() },
  });

  return { healthService, oauthManager, store, registry };
}

// ── Commands ───────────────────────────────────────────────────────

async function meliConnectionStatus(
  seller?: string,
  options?: { json?: boolean },
): Promise<void> {
  const { healthService, registry } = bootstrap();

  if (seller) {
    const resolved = resolveSeller(seller, registry);
    const health = await healthService.inspect(resolved);
    if (options?.json) {
      process.stdout.write(`${JSON.stringify(sanitizeHealth(health), null, 2)}\n`);
    } else {
      process.stdout.write(formatHealthText([health]));
    }
  } else {
    if (registry.length === 0) {
      exit(1, "No sellers configured");
    }
    const healths = await healthService.inspectAll();
    if (options?.json) {
      process.stdout.write(
        `${JSON.stringify(healths.map(sanitizeHealth), null, 2)}\n`,
      );
    } else {
      process.stdout.write(formatHealthText(healths));
    }
  }
}

async function meliRefresh(
  seller: string,
  options?: { json?: boolean },
): Promise<void> {
  const { healthService, registry } = bootstrap();

  const resolved = resolveSeller(seller, registry);
  const health = await healthService.refreshIfNeeded(resolved);
  if (options?.json) {
    process.stdout.write(`${JSON.stringify(sanitizeHealth(health), null, 2)}\n`);
  } else {
    process.stdout.write(formatHealthText([health]));
  }
}

async function meliSmoke(
  seller: string,
  options?: { json?: boolean },
): Promise<void> {
  const { healthService, registry } = bootstrap();

  const resolved = resolveSeller(seller, registry);
  const health = await healthService.smokeRead(resolved);
  if (options?.json) {
    process.stdout.write(`${JSON.stringify(sanitizeHealth(health), null, 2)}\n`);
  } else {
    process.stdout.write(formatHealthText([health]));
  }
}

async function meliConnectUrl(seller: string): Promise<void> {
  const { oauthManager, registry } = bootstrap();

  // Generate a fresh HMAC state token
  const state = `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const resolved = resolveSeller(seller, registry);
    const url = oauthManager.getAuthorizationUrl(resolved, state);
    process.stdout.write(`${url}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    exit(1, `Failed to generate authorization URL: ${message}`);
  }
}

// ── Text formatting ────────────────────────────────────────────────

function formatHealthText(healths: MercadoLibreAccountConnectionHealth[]): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("🔗 MercadoLibre Connection Health");
  lines.push("");

  for (const h of healths) {
    const icon = statusIcon(h.status);
    lines.push(`  ${icon} ${h.accountName} (${h.accountRole})`);
    lines.push(`     Status:      ${h.status}`);
    lines.push(`     Token:       ${h.tokenStatus}`);
    if (h.tokenExpiresAt) {
      lines.push(`     Expires:     ${h.tokenExpiresAt}`);
    }
    if (h.reason) {
      lines.push(`     Reason:      ${h.reason}`);
    }
    if (h.reasonCodes.length > 0) {
      lines.push(`     Codes:       ${h.reasonCodes.join(", ")}`);
    }
    lines.push(`     Read Ready:  ${h.readReady ? "✅" : "❌"}`);
    lines.push(`     Write Ready: ${h.writeReady ? "✅" : "❌ (blocked)"}`);
    lines.push("");
  }

  return lines.join("\n");
}

function statusIcon(status: string): string {
  switch (status) {
    case "ready":
      return "✅";
    case "degraded":
      return "⚠️";
    case "blocked":
    case "disconnected":
      return "❌";
    case "reauthorization-required":
      return "🔑";
    default:
      return "❓";
  }
}

// ── CLI Entry Point (when run directly) ────────────────────────────

const COMMANDS: Record<string, () => Promise<void>> = {
  status: async () => {
    const { seller, json } = parseArgs();
    await meliConnectionStatus(seller ?? undefined, { json });
  },
  refresh: async () => {
    const { seller, json } = parseArgs();
    if (!seller) exit(1, "--seller is required for refresh");
    await meliRefresh(seller, { json });
  },
  smoke: async () => {
    const { seller, json } = parseArgs();
    if (!seller) exit(1, "--seller is required for smoke");
    await meliSmoke(seller, { json });
  },
  "connect-url": async () => {
    const { seller } = parseArgs();
    if (!seller) exit(1, "--seller is required for connect-url");
    await meliConnectUrl(seller);
  },
};

// Only auto-run when executed directly (not imported)
const isMain = process.argv[1]?.includes("cli.js") || process.argv[1]?.includes("cli.ts");

if (isMain) {
  const { command } = parseArgs();
  const handler = COMMANDS[command];
  if (!handler) {
    exit(1, `Unknown command: ${command}. Available: ${Object.keys(COMMANDS).join(", ")}`);
  }
  void handler().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    exit(1, `Unexpected error: ${message}`);
  });
}
