import {
  createInMemoryApprovalQueueRepository,
  type ApprovalQueueRepository,
  type Clock,
} from "@msl/tools";
import {
  createMercadoLibreApiFetchTransport,
  createOAuthManager,
  createOAuthMlcApiClient,
  getMlAccountRoleConfig,
} from "@msl/mercadolibre";
import type { MlcApiClient, OAuthManager } from "@msl/mercadolibre";
import type { McpServerConfig } from "./index.js";

type RuntimeEnv = NodeJS.ProcessEnv;

type RuntimeDependencies = McpServerConfig & {
  close(): void;
};

const OAUTH_ENV_KEYS = [
  "MERCADOLIBRE_CLIENT_ID",
  "MERCADOLIBRE_CLIENT_SECRET",
  "MERCADOLIBRE_REDIRECT_URI",
  "MSL_MERCADOLIBRE_OAUTH_DB_PATH",
] as const;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isProduction(env: RuntimeEnv): boolean {
  return env.NODE_ENV === "production";
}

function isExplicitInsecureDevMode(env: RuntimeEnv): boolean {
  return env.NODE_ENV === "test" || env.MSL_ALLOW_INSECURE_DEV_SECRETS === "true";
}

function missingKeys(env: RuntimeEnv, keys: ReadonlyArray<string>): string[] {
  return keys.filter((key) => !nonEmpty(env[key]));
}

function hasAnyOAuthConfig(env: RuntimeEnv): boolean {
  const missing = missingKeys(env, OAUTH_ENV_KEYS);

  return missing.length < OAUTH_ENV_KEYS.length;
}

function assertOAuthConfigPresentInProduction(env: RuntimeEnv): void {
  if (!hasAnyOAuthConfig(env) && isProduction(env)) {
    throw new Error(
      `MCP MercadoLibre OAuth runtime is not configured. Missing ${OAUTH_ENV_KEYS.join(", ")}.`,
    );
  }
}

function assertCompleteOAuthConfig(env: RuntimeEnv): void {
  const missing = missingKeys(env, OAUTH_ENV_KEYS);

  if (missing.length > 0) {
    throw new Error(
      `Incomplete MCP MercadoLibre OAuth runtime config. Missing ${missing.join(", ")}.`,
    );
  }
}

function assertProductionSecrets(env: RuntimeEnv): void {
  const missing = missingKeys(env, ["MSL_MCP_API_KEY", "MSL_ENCRYPTION_KEY"]);

  if (missing.length > 0) {
    throw new Error(`Incomplete production MCP runtime config. Missing ${missing.join(", ")}.`);
  }
}

function createPrepareWriteDependencies(): { repository: ApprovalQueueRepository; clock: Clock } {
  return {
    repository: createInMemoryApprovalQueueRepository(),
    clock: { now: () => new Date() },
  };
}

function createRuntimeReadClient(env: RuntimeEnv): { client?: MlcApiClient; close(): void } {
  assertOAuthConfigPresentInProduction(env);

  if (!hasAnyOAuthConfig(env)) {
    return { close: () => undefined };
  }

  assertCompleteOAuthConfig(env);

  const roleConfig = getMlAccountRoleConfig(env);

  if (!nonEmpty(env.MSL_ENCRYPTION_KEY) && !isExplicitInsecureDevMode(env)) {
    throw new Error("MSL_ENCRYPTION_KEY is required for MCP MercadoLibre OAuth token storage.");
  }

  const oauthManager: OAuthManager = createOAuthManager({
    clientId: nonEmpty(env.MERCADOLIBRE_CLIENT_ID)!,
    clientSecret: nonEmpty(env.MERCADOLIBRE_CLIENT_SECRET)!,
    redirectUri: nonEmpty(env.MERCADOLIBRE_REDIRECT_URI)!,
    dbPath: nonEmpty(env.MSL_MERCADOLIBRE_OAUTH_DB_PATH)!,
  });

  return {
    client: createOAuthMlcApiClient({
      oauthManager,
      transport: createMercadoLibreApiFetchTransport(),
      now: () => new Date(),
      allowedSellerIds: [roleConfig.sourceSellerId, roleConfig.targetSellerId],
    }),
    close: () => oauthManager.close(),
  };
}

export function createMcpRuntimeDependencies(env: RuntimeEnv = process.env): RuntimeDependencies {
  if (isProduction(env)) {
    assertProductionSecrets(env);
  }

  const readRuntime = createRuntimeReadClient(env);

  return {
    ...(readRuntime.client ? { mlcClient: readRuntime.client } : {}),
    prepareWrite: createPrepareWriteDependencies(),
    close: readRuntime.close,
  };
}
