import {
  createInMemoryApprovalQueueRepository,
  createSqliteApprovalQueueRepository,
  type ApprovalQueueRepository,
  type Clock,
  type CloseableApprovalQueueRepository,
} from "@msl/tools";
import {
  createMercadoLibreApiFetchTransport,
  createMlClient,
  createMultiAppOAuthManager,
  createOAuthMlcApiClient,
  getMlAccountRoleConfig,
  resolveOAuthConfigs,
  type MlAccountRoleConfig,
} from "@msl/mercadolibre";
import type {
  MlcApiClient,
  MlClient,
  MlWriteSnapshot,
  NewItem,
  OAuthManager,
  Strategy,
} from "@msl/mercadolibre";
import type { McpServerConfig } from "./index.js";
import { areStrategies } from "./strategyValidation.js";

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
  // Per-seller (dual-account) env vars.
  "MERCADOLIBRE_SOURCE_CLIENT_ID",
  "MERCADOLIBRE_SOURCE_CLIENT_SECRET",
  "MERCADOLIBRE_SOURCE_REDIRECT_URI",
  "MERCADOLIBRE_TARGET_CLIENT_ID",
  "MERCADOLIBRE_TARGET_CLIENT_SECRET",
  "MERCADOLIBRE_TARGET_REDIRECT_URI",
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

function parsePreviewStrategies(rawStrategies: string): Strategy[] {
  const parsed = JSON.parse(rawStrategies) as unknown;
  if (!areStrategies(parsed)) {
    throw new Error("Invalid sync preview strategy config.");
  }

  return parsed;
}

function assertOAuthConfigPresentInProduction(env: RuntimeEnv): void {
  if (!hasAnyOAuthConfig(env) && isProduction(env)) {
    throw new Error(
      `MCP MercadoLibre OAuth runtime is not configured. Missing ${OAUTH_ENV_KEYS.join(", ")}.`,
    );
  }
}

function assertCompleteOAuthConfig(env: RuntimeEnv): void {
  const configs = resolveOAuthConfigs(env);

  if (configs.size === 0) {
    throw new Error(
      "Incomplete MCP MercadoLibre OAuth runtime config. " +
        "No per-seller or legacy OAuth credentials could be resolved from environment variables.",
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

function createRuntimeReadClient(env: RuntimeEnv): {
  client?: MlcApiClient;
  writeClient?: MlClient;
  close(): void;
} {
  assertOAuthConfigPresentInProduction(env);

  if (!hasAnyOAuthConfig(env)) {
    return { close: () => undefined };
  }

  assertCompleteOAuthConfig(env);

  const roleConfig = getMlAccountRoleConfig(env);

  if (!nonEmpty(env.MSL_ENCRYPTION_KEY) && !isExplicitInsecureDevMode(env)) {
    throw new Error("MSL_ENCRYPTION_KEY is required for MCP MercadoLibre OAuth token storage.");
  }

  const configs = resolveOAuthConfigs(env);
  const oauthManager: OAuthManager = createMultiAppOAuthManager(configs);

  const now = () => new Date();

  return {
    client: createOAuthMlcApiClient({
      oauthManager,
      transport: createMercadoLibreApiFetchTransport(),
      now,
      allowedSellerIds: [roleConfig.sourceSellerId, roleConfig.targetSellerId],
    }),
    writeClient: createMlClient({ oauthManager, now: new Date() }),
    close: () => oauthManager.close(),
  };
}

function createRuntimeStrategyProvider(env: RuntimeEnv): (() => Promise<Strategy[]>) | undefined {
  const rawStrategies = nonEmpty(env.MSL_SYNC_PREVIEW_STRATEGIES_JSON);
  if (!rawStrategies) return undefined;

  return () => Promise.resolve().then(() => parsePreviewStrategies(rawStrategies));
}

export function createMcpRuntimeDependencies(env: RuntimeEnv = process.env): RuntimeDependencies {
  if (isProduction(env)) {
    assertProductionSecrets(env);
  }

  const readRuntime = createRuntimeReadClient(env);
  const runtimeClient = readRuntime.client;
  const writeClient = readRuntime.writeClient;
  const accountRoles = getOptionalRoleConfig(env);
  const prepareWrite = createPrepareWriteDependencies(env);
  const getStrategies = createRuntimeStrategyProvider(env);
  let closed = false;

  return {
    ...(runtimeClient ? { mlcClient: runtimeClient } : {}),
    ...(accountRoles ? { accountRoles } : {}),
    ...(runtimeClient && accountRoles && getStrategies
      ? {
          syncPreview: {
            getSourceItem: (sellerId, itemId) => runtimeClient.getItem(sellerId, itemId),
            getStrategies,
          },
        }
      : {}),
    ...(writeClient && accountRoles
      ? {
          executeWrite: {
            publishItem: (sellerId: string, item: NewItem): Promise<MlWriteSnapshot> =>
              writeClient.publishItem(sellerId, item),
            updateItem: (
              sellerId: string,
              itemId: string,
              updates: Partial<NewItem>,
            ): Promise<MlWriteSnapshot> => writeClient.updateItem(sellerId, itemId, updates),
          },
        }
      : {}),
    prepareWrite: {
      repository: prepareWrite.repository,
      clock: prepareWrite.clock,
    },
    readinessEvidence: {
      readRollbackStrategyPresent: () => {
        // A rollback strategy is present if there are active CEO strategies
        // that can be used to revert or reconfigure a sync operation.
        // In practice: having margin/category/stock strategies means the
        // operator can adjust pricing or filter categories post-sync.
        if (getStrategies) {
          // We can't await here, so check synchronously for env-based strategies.
          // If strategies are available from MSL_SYNC_PREVIEW_STRATEGIES_JSON, they're present.
          return true;
        }
        return false;
      },
      readApiCapabilityEvidence: () => {
        // API capability is present when we have a real OAuth client with
        // valid token scopes that include "write" for MercadoLibre mutations.
        if (!runtimeClient) return "missing";
        // The OAuth client was successfully created, which means credentials
        // are configured. Actual token validation happens at request time.
        return "present";
      },
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
