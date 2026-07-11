import {
  loadRepositoryEnvironment,
  getMlAccountRoleConfig,
  resolveOAuthConfigs,
  createMultiAppOAuthManager,
  createOAuthMlcApiClient,
  createMercadoLibreApiFetchTransport,
} from "@msl/mercadolibre";
import type { MlcApiClient, OAuthManager } from "@msl/mercadolibre";
import {
  getSharedDb,
  createSqliteEconomicOutcomeStore,
  createSqliteEconomicIngestionRunStore,
  createSqliteEconomicEvidenceStore,
  migrateEconomicOutcomeStore,
  migrateEconomicIngestionRunStore,
  migrateEconomicDurabilityColumns,
} from "@msl/memory";
import type { EconomicOutcomeStore, EconomicIngestionRunStore, EconomicEvidenceStore } from "@msl/memory";
import { CryptoRunIdFactory } from "@msl/domain";
import type { RunIdFactory } from "@msl/domain";
import { createProductionDataFetcher } from "./dataFetcher.js";
import { runEconomicIngestion } from "./EconomicIngestionPipeline.js";
import type { DataFetcher, PipelineConfig, PipelineResult } from "./EconomicIngestionPipeline.js";
import { reconcileEconomics } from "./EconomicReconciliationService.js";
import type { ReconciliationVerdict } from "./EconomicIngestionPipeline.js";
import { createMetrics, createLogger } from "../conversation/observability.js";
import type { MetricsCollector, Logger } from "../conversation/observability.js";
import type Database from "better-sqlite3";

// ── Types ──────────────────────────────────────────────────────────────────

export type SellerSlug = "source" | "target";

export type RuntimeOverrides = {
  store?: EconomicOutcomeStore;
  runStore?: EconomicIngestionRunStore;
  evidenceStore?: EconomicEvidenceStore;
  runIdFactory?: RunIdFactory;
  dataFetcher?: DataFetcher;
  pipeline?: (config: PipelineConfig) => Promise<PipelineResult>;
  mlClient?: MlcApiClient;
  db?: Database.Database;
};

export type EconomicIngestionRuntime = {
  store: EconomicOutcomeStore;
  runStore: EconomicIngestionRunStore;
  evidenceStore: EconomicEvidenceStore;
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
};

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
  const numericSellerId = seller === "source" ? roleConfig.sourceSellerId : roleConfig.targetSellerId;
  // Pipeline uses friendly slugs: source→plasticov, target→maustian
  const pipelineSellerId = seller === "source" ? "plasticov" : "maustian";

  // ── 3. Feature gate check ───────────────────────────────────────────────
  const featureGateEnabled = env.MSL_ECONOMIC_INGESTION_ENABLED?.trim() === "true";

  // ── 4. OAuth and ML client ──────────────────────────────────────────────
  let mlClient: MlcApiClient | undefined;
  let oauthManager: OAuthManager | undefined;
  let ownDb: Database.Database | undefined;

  if (!overrides?.mlClient && !overrides?.dataFetcher) {
    const oauthConfigs = resolveOAuthConfigs(env);
    if (oauthConfigs.size > 0) {
      oauthManager = createMultiAppOAuthManager(oauthConfigs);
      const transport = createMercadoLibreApiFetchTransport();
      mlClient = createOAuthMlcApiClient({
        oauthManager,
        transport,
        now: () => new Date(),
        allowedSellerIds: [roleConfig.sourceSellerId, roleConfig.targetSellerId].filter(Boolean),
      });
    }
  }

  // ── 5. SQLite stores ────────────────────────────────────────────────────
  const cortexPath = env.MSL_CORTEX_SQLITE_PATH?.trim();
  const db = overrides?.db ?? getSharedDb(cortexPath);
  ownDb = overrides?.db ? undefined : db;

  const store = overrides?.store ?? createSqliteEconomicOutcomeStore(db);
  const runStore = overrides?.runStore ?? createSqliteEconomicIngestionRunStore(db);
  const evidenceStore = overrides?.evidenceStore ?? createSqliteEconomicEvidenceStore(db);

  // Ensure economic tables exist before any operations
  if (!overrides?.store) migrateEconomicOutcomeStore(db);
  if (!overrides?.runStore) migrateEconomicIngestionRunStore(db);
  if (!overrides?.evidenceStore) migrateEconomicDurabilityColumns(db);

  // ── 5b. RunIdFactory ────────────────────────────────────────────────────
  const runIdFactory = overrides?.runIdFactory ?? new CryptoRunIdFactory();

  // ── 6. DataFetcher ──────────────────────────────────────────────────────
  const sellerIdMap: Record<string, string> = {
    plasticov: roleConfig.sourceSellerId,
    maustian: roleConfig.targetSellerId,
  };

  const dataFetcher =
    overrides?.dataFetcher ??
    (mlClient
      ? createProductionDataFetcher({ mlClient, sellerIdMap })
      : createProductionDataFetcher({
          mlClient: mlClient!,
          sellerIdMap,
        }));

  // ── 7. Observability ────────────────────────────────────────────────────
  const logger = createLogger("economic-ingestion");
  const metrics = createMetrics();

  // ── 8. Pipeline ─────────────────────────────────────────────────────────
  const pipeline =
    overrides?.pipeline ??
    (async (config: PipelineConfig) => {
      return runEconomicIngestion(config, store, dataFetcher, runIdFactory, runStore, evidenceStore);
    });

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
  };

  // ── 10. Cleanup ─────────────────────────────────────────────────────────
  const close = () => {
    oauthManager?.close?.();
    if (ownDb && overrides?.db === undefined) {
      // Don't close shared DB — connection pool manages it
    }
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
