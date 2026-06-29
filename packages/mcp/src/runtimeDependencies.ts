import {
  createInMemoryApprovalQueueRepository,
  createSqliteApprovalQueueRepository,
  type ApprovalQueueRepository,
  type Clock,
  type CloseableApprovalQueueRepository,
} from "@msl/tools";
import {
  createMercadoLibreApiFetchTransport,
  createOAuthManager,
  createOAuthMlcApiClient,
  getMlAccountRoleConfig,
  type MlAccountRoleConfig,
} from "@msl/mercadolibre";
import type { MlcApiClient, OAuthManager } from "@msl/mercadolibre";
import type { McpServerConfig } from "./index.js";

type RuntimeEnv = NodeJS.ProcessEnv;

type RuntimeDependencies = McpServerConfig & {
  close(): void;
};

type ApprovalStorage = NonNullable<McpServerConfig["approvalStorage"]>;

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

function isCloseableRepository(
  repository: ApprovalQueueRepository | CloseableApprovalQueueRepository,
): repository is CloseableApprovalQueueRepository {
  return "close" in repository && typeof repository.close === "function";
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

function createPrepareWriteDependencies(env: RuntimeEnv): {
  repository: ApprovalQueueRepository;
  clock: Clock;
  approvalStorage: ApprovalStorage;
  close(): void;
} {
  const dbPath = nonEmpty(env.MSL_APPROVAL_QUEUE_DB_PATH);
  let repository: CloseableApprovalQueueRepository | ApprovalQueueRepository;
  let approvalStorage: ApprovalStorage;

  if (dbPath) {
    try {
      repository = createSqliteApprovalQueueRepository(dbPath);
      approvalStorage = "sqlite";
    } catch {
      repository = createInMemoryApprovalQueueRepository();
      approvalStorage = "sqlite-unavailable";
    }
  } else {
    repository = createInMemoryApprovalQueueRepository();
    approvalStorage = "memory";
  }

  return {
    repository,
    clock: { now: () => new Date() },
    approvalStorage,
    close: () => {
      if (isCloseableRepository(repository)) {
        repository.close();
      }
    },
  };
}

function getOptionalRoleConfig(env: RuntimeEnv): MlAccountRoleConfig | undefined {
  const hasAnyRoleConfig =
    nonEmpty(env.MERCADOLIBRE_SOURCE_SELLER_ID) !== undefined ||
    nonEmpty(env.MERCADOLIBRE_TARGET_SELLER_ID) !== undefined;

  return hasAnyRoleConfig ? getMlAccountRoleConfig(env) : undefined;
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
  const accountRoles = getOptionalRoleConfig(env);
  const prepareWrite = createPrepareWriteDependencies(env);
  let closed = false;

  return {
    ...(readRuntime.client ? { mlcClient: readRuntime.client } : {}),
    ...(accountRoles ? { accountRoles } : {}),
    prepareWrite: {
      repository: prepareWrite.repository,
      clock: prepareWrite.clock,
    },
    approvalStorage: prepareWrite.approvalStorage,
    close: () => {
      if (closed) return;
      closed = true;
      try {
        readRuntime.close();
      } finally {
        prepareWrite.close();
      }
    },
  };
}
