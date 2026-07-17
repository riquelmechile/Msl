import Database from "better-sqlite3";
import {
  createDatabaseManager,
  createEconomicMemoryRuntime,
  createSqliteEconomicLearningStore,
  createSqliteOperationalReadModel,
} from "@msl/memory";
import type {
  DatabaseManager,
  EconomicLearningStore,
  EconomicMemoryRuntime,
  EconomicOutcomeReader,
  OperationalReadModel,
} from "@msl/memory";
import {
  createAgentMessageBusStore,
  type AgentMessageBusStore,
} from "../conversation/agentMessageBusStore.js";
import {
  createAgentConsensusStore,
  type AgentConsensusStore,
} from "../conversation/agentConsensusStore.js";
import {
  createCreativeJobQueueStore,
  type CreativeJobQueueStore,
} from "../conversation/creativeJobQueueStore.js";
import { createProductCatalogStore } from "../workers/productCatalogStore.js";
import { LaunchCostTracker } from "../economics/launchCostTracker.js";
import type { ProductCatalogStore } from "@msl/domain";

export type AgentDaemonPersistenceRuntime = {
  readonly bus: AgentMessageBusStore;
  readonly consensusStore: AgentConsensusStore;
  readonly reader: OperationalReadModel;
  readonly economicOutcomeStore: EconomicOutcomeReader;
  readonly economicLearningStore: EconomicLearningStore;
  readonly databaseManager: DatabaseManager;
  readonly productCatalogStore: ProductCatalogStore;
  readonly launchCostTracker: LaunchCostTracker;
  readonly creativeJobQueueStore: CreativeJobQueueStore;
  close(): void;
};

type PersistenceResources = Omit<AgentDaemonPersistenceRuntime, "databaseManager" | "close"> & {
  readonly db: Database.Database;
  readonly economicRuntime: EconomicMemoryRuntime;
};

export function resolveProductLaunchRuntimePath(
  env: { MSL_PRODUCT_LAUNCH_SQLITE_PATH?: string | undefined },
  cortexPath?: string,
): string | undefined {
  return env.MSL_PRODUCT_LAUNCH_SQLITE_PATH?.trim() || cortexPath?.trim() || undefined;
}

function delegate<T extends object>(current: () => T): T {
  return new Proxy({} as T, {
    get:
      (_target, property) =>
      (...args: unknown[]) => {
        const target = current();
        const method = Reflect.get(target, property) as (...values: unknown[]) => unknown;
        return Reflect.apply(method, target, args);
      },
  });
}

export function createAgentDaemonPersistenceRuntime(
  databasePath: string,
): AgentDaemonPersistenceRuntime {
  let resources: PersistenceResources | undefined;
  const open = (): PersistenceResources => {
    if (resources) return resources;
    const db = new Database(databasePath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    db.pragma("synchronous = NORMAL");
    const economicRuntime = createEconomicMemoryRuntime({ databasePath });
    const productCatalogStore = createProductCatalogStore(db);
    const bus = createAgentMessageBusStore(db);
    const creativeJobQueueStore = createCreativeJobQueueStore(db);
    const createAndDispatchCreativeJob = db.transaction(
      (input: Parameters<CreativeJobQueueStore["createJob"]>[0]) => {
        const job = creativeJobQueueStore.createJob(input);
        if (job.status !== "queued") return job;

        const metadata = JSON.parse(job.payload_json) as Record<string, unknown>;
        const constraints =
          metadata.constraints && typeof metadata.constraints === "object"
            ? metadata.constraints
            : {};
        bus.enqueue({
          senderAgentId: "owned-ecommerce",
          receiverAgentId: "creative-studio",
          messageType: "creative.asset.requested",
          payloadJson: JSON.stringify({
            ...metadata,
            requestId: job.request_id.startsWith("cj_") ? job.request_id : `cj_${job.request_id}`,
            requestedByAgent: "owned-ecommerce",
            sellerId: job.seller_id,
            channel: job.channel,
            kind: job.kind,
            objective: metadata.objective ?? "conversion",
            budgetTier: metadata.budgetTier ?? "low",
            references: Array.isArray(metadata.references) ? metadata.references : [],
            constraints: {
              preserveProductTruth: false,
              noBrandInfringement: true,
              requiresHumanApproval: true,
              ...constraints,
            },
          }),
          dedupeKey: `creative-job:${job.job_id}`,
          correlationId: job.request_id,
          sellerId: job.seller_id,
        });
        return creativeJobQueueStore.updateStatus(job.job_id, "provider-routing");
      },
    );
    const launchCostTracker = new LaunchCostTracker({
      catalogStore: productCatalogStore,
      maxLaunchUsd: Number(process.env.MSL_PRODUCT_LAUNCH_MAX_USD ?? "0.25"),
    });
    resources = {
      db,
      economicRuntime,
      bus,
      consensusStore: createAgentConsensusStore(db),
      reader: createSqliteOperationalReadModel(db),
      economicOutcomeStore: economicRuntime.readers.outcomes,
      economicLearningStore: createSqliteEconomicLearningStore(db),
      productCatalogStore,
      launchCostTracker,
      creativeJobQueueStore: {
        ...creativeJobQueueStore,
        createJob: createAndDispatchCreativeJob,
      },
    };
    return resources;
  };
  const close = (): void => {
    resources?.economicRuntime.close();
    resources?.db.close();
    resources = undefined;
  };
  const current = (): PersistenceResources => resources ?? open();
  const manager = createDatabaseManager(databasePath, () => current().db);
  const databaseManager = new Proxy(manager, {
    get(target, property) {
      if (property === "restoreFrom") {
        return () =>
          Promise.reject(
            new Error(
              "Generic restoreFrom is forbidden for the economic database; use restoreEconomicFrom",
            ),
          );
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? (value.bind(target) as unknown) : value;
    },
  });

  return {
    bus: delegate(() => current().bus),
    consensusStore: delegate(() => current().consensusStore),
    reader: delegate(() => current().reader),
    economicOutcomeStore: delegate(() => current().economicOutcomeStore),
    economicLearningStore: delegate(() => current().economicLearningStore),
    productCatalogStore: delegate(() => current().productCatalogStore),
    launchCostTracker: delegate(() => current().launchCostTracker),
    creativeJobQueueStore: delegate(() => current().creativeJobQueueStore),
    databaseManager,
    close,
  };
}
