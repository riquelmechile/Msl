import {
  loadRepositoryEnvironment,
  getMlAccountRoleConfig,
  resolveOAuthConfigs,
  createMultiAppOAuthManager,
  createOAuthMlcApiClient,
  createMercadoLibreApiFetchTransport,
} from "@msl/mercadolibre";
import type { MlcApiClient, OAuthManager } from "@msl/mercadolibre";
import type {
  EconomicEvidenceReader,
  EconomicMemoryRuntime,
  EconomicOutcomeReader,
  EconomicRunReader,
  MaintenanceWriteAdmission,
} from "@msl/memory";
import { createEconomicMemoryRuntime, createExecutionBudget } from "@msl/memory";
import { CryptoRunIdFactory } from "@msl/domain";
import type { RunIdFactory } from "@msl/domain";
import { createProductionDataFetcher, type EconomicReadClient } from "./dataFetcher.js";
import { runEconomicIngestion } from "./EconomicIngestionPipeline.js";
import type { DataFetcher, PipelineConfig, PipelineResult } from "./EconomicIngestionPipeline.js";
import { DEFAULT_ECONOMIC_DEADLINE_CONFIG } from "./runtimeDeadline.js";
import { reconcileEconomics } from "./EconomicReconciliationService.js";
import { createMetrics, createLogger } from "../conversation/observability.js";
import type { MetricsCollector, Logger } from "../conversation/observability.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type SellerSlug = "source" | "target";
const ECONOMIC_WRITE_SESSION_RENEWAL_INTERVAL_MS = 20_000;

export type RuntimeOverrides = {
  memoryRuntime?: EconomicMemoryRuntime;
  runIdFactory?: RunIdFactory;
  dataFetcher?: DataFetcher;
  pipeline?: (config: PipelineConfig) => Promise<PipelineResult>;
  mlClient?: MlcApiClient;
  databasePath?: string;
};

export type EconomicIngestionRuntime = {
  store: EconomicOutcomeReader;
  runStore: EconomicRunReader;
  evidenceStore: EconomicEvidenceReader;
  pipeline: (config: PipelineConfig) => Promise<PipelineResult>;
  reconciliation: typeof reconcileEconomics;
  dataFetcher: DataFetcher;
  logger: Logger;
  metrics: MetricsCollector;
  health: EconomicIngestionHealth;
  close: () => void;
};

export type EconomicIngestionHealth = {
  sellerId: string;
  numericSellerId: string;
  sellerSlug: SellerSlug;
  storeReady: boolean;
  runStoreReady: boolean;
  evidenceStoreReady: boolean;
  dataFetcherReady: boolean;
  featureGateEnabled: boolean;
  maintenanceAdmissionReady: boolean;
};

function adaptMlcEconomicReadClient(client: MlcApiClient): EconomicReadClient {
  return {
    getOrders: (sellerId, options) =>
      client.getOrders(sellerId, {
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.offset !== undefined ? { offset: options.offset } : {}),
        ...(options?.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
        ...(options?.dateCreatedFrom !== undefined
          ? { dateCreatedFrom: options.dateCreatedFrom }
          : {}),
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      }),
    ...(client.getProductAdsInsights
      ? {
          getProductAdsInsights: (sellerId, options) =>
            client.getProductAdsInsights!(sellerId, {
              ...(options?.signal !== undefined ? { signal: options.signal } : {}),
            }),
        }
      : {}),
  };
}

function assertRuntimeSeller(actualSellerId: string, expectedSellerId: string): void {
  if (actualSellerId !== expectedSellerId) {
    throw new Error("Economic ingestion runtime seller mismatch");
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create the full economic ingestion runtime for a given seller.
 *
 * Loads repository environment, resolves the MercadoLibre account, creates
 * OAuth and API clients, initializes SQLite stores, and wires the ingestion
 * pipeline with its dependencies.
 *
 * Accepts optional overrides for testing (store, runStore, dataFetcher, etc.).
 *
 * @param seller - "source" (Plasticov) or "target" (Maustian)
 * @param overrides - Optional dependency overrides for testing
 */
export function createEconomicIngestionRuntime(
  seller: SellerSlug,
  overrides?: Partial<RuntimeOverrides>,
): EconomicIngestionRuntime {
  // ── 1. Load environment ─────────────────────────────────────────────────
  loadRepositoryEnvironment();
  const env = process.env;

  // ── 2. Resolve seller account ───────────────────────────────────────────
  const roleConfig = getMlAccountRoleConfig(env);
  const numericSellerId =
    seller === "source" ? roleConfig.sourceSellerId : roleConfig.targetSellerId;
  // Pipeline uses friendly slugs: source→plasticov, target→maustian
  const pipelineSellerId = seller === "source" ? "plasticov" : "maustian";

  // ── 3. Feature gate check ───────────────────────────────────────────────
  const featureGateEnabled = env.MSL_ECONOMIC_INGESTION_ENABLED?.trim() === "true";

  // ── 4. OAuth and ML client ──────────────────────────────────────────────
  let mlClient: MlcApiClient | undefined = overrides?.mlClient;
  let oauthManager: OAuthManager | undefined;

  if (!overrides?.mlClient && !overrides?.dataFetcher) {
    const oauthConfigs = resolveOAuthConfigs(env);
    if (oauthConfigs.size > 0) {
      oauthManager = createMultiAppOAuthManager(oauthConfigs);
      const transport = createMercadoLibreApiFetchTransport();
      mlClient = createOAuthMlcApiClient({
        oauthManager,
        transport,
        now: () => new Date(),
        allowedSellerIds: [numericSellerId],
      });
    }
  }

  // ── 5. SQLite stores ────────────────────────────────────────────────────
  const cortexPath = env.MSL_CORTEX_SQLITE_PATH?.trim();
  const databasePath = overrides?.databasePath ?? cortexPath;
  const memoryRuntime =
    overrides?.memoryRuntime ??
    createEconomicMemoryRuntime({
      ...(databasePath === undefined ? {} : { databasePath }),
      applyMigrations: true,
      writeSessionRenewalIntervalMs: ECONOMIC_WRITE_SESSION_RENEWAL_INTERVAL_MS,
    });
  const { outcomes: store, runs: runStore, evidence: evidenceStore } = memoryRuntime.readers;
  const { writeSessionFactory } = memoryRuntime;
  const maintenanceAdmission: MaintenanceWriteAdmission = memoryRuntime.maintenanceAdmission;

  // ── 5b. RunIdFactory ────────────────────────────────────────────────────
  const runIdFactory = overrides?.runIdFactory ?? new CryptoRunIdFactory();

  // ── 6. DataFetcher ──────────────────────────────────────────────────────
  const sellerIdMap: Record<string, string> = { [pipelineSellerId]: numericSellerId };

  const configuredDataFetcher =
    overrides?.dataFetcher ??
    (mlClient
      ? createProductionDataFetcher({
          mlClient: adaptMlcEconomicReadClient(mlClient),
          sellerIdMap,
          requestTimeoutMs: DEFAULT_ECONOMIC_DEADLINE_CONFIG.requestTimeoutMs,
          retryBudgetMs: DEFAULT_ECONOMIC_DEADLINE_CONFIG.retryBudgetMs,
          fanoutTimeoutMs: DEFAULT_ECONOMIC_DEADLINE_CONFIG.fanoutTimeoutMs,
        })
      : createProductionDataFetcher({
          mlClient: adaptMlcEconomicReadClient(mlClient!),
          sellerIdMap,
          requestTimeoutMs: DEFAULT_ECONOMIC_DEADLINE_CONFIG.requestTimeoutMs,
          retryBudgetMs: DEFAULT_ECONOMIC_DEADLINE_CONFIG.retryBudgetMs,
          fanoutTimeoutMs: DEFAULT_ECONOMIC_DEADLINE_CONFIG.fanoutTimeoutMs,
        }));
  const dataFetcher: DataFetcher = (sellerId, options) => {
    assertRuntimeSeller(sellerId, pipelineSellerId);
    return configuredDataFetcher(sellerId, options);
  };

  // ── 7. Observability ────────────────────────────────────────────────────
  const logger = createLogger("economic-ingestion");
  const metrics = createMetrics();

  // ── 8. Pipeline ─────────────────────────────────────────────────────────
  const configuredPipeline =
    overrides?.pipeline ??
    (async (config: PipelineConfig) => {
      return runEconomicIngestion(
        config,
        memoryRuntime.readers,
        writeSessionFactory,
        dataFetcher,
        createExecutionBudget(
          config.maxTime ??
            config.deadlineConfig?.maxTimeMs ??
            DEFAULT_ECONOMIC_DEADLINE_CONFIG.maxTimeMs,
          () => config.runtimeClock?.now() ?? Date.now(),
        ),
        runIdFactory,
      );
    });
  const pipeline = (config: PipelineConfig): Promise<PipelineResult> => {
    assertRuntimeSeller(config.sellerId, pipelineSellerId);
    return configuredPipeline(config);
  };

  // ── 9. Health ───────────────────────────────────────────────────────────
  const health: EconomicIngestionHealth = {
    sellerId: pipelineSellerId,
    numericSellerId,
    sellerSlug: seller,
    storeReady: true,
    runStoreReady: true,
    evidenceStoreReady: true,
    dataFetcherReady: mlClient !== undefined || overrides?.dataFetcher !== undefined,
    featureGateEnabled,
    maintenanceAdmissionReady:
      maintenanceAdmission.purpose === "migration" || maintenanceAdmission.purpose === "bootstrap",
  };

  // ── 10. Cleanup ─────────────────────────────────────────────────────────
  const close = () => {
    oauthManager?.close?.();
    memoryRuntime.close();
  };

  return {
    store,
    runStore,
    evidenceStore,
    pipeline,
    reconciliation: reconcileEconomics,
    dataFetcher,
    logger,
    metrics,
    health,
    close,
  };
}
