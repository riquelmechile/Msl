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

export type AgentDaemonPersistenceRuntime = {
  readonly bus: AgentMessageBusStore;
  readonly consensusStore: AgentConsensusStore;
  readonly reader: OperationalReadModel;
  readonly economicOutcomeStore: EconomicOutcomeReader;
  readonly economicLearningStore: EconomicLearningStore;
  readonly databaseManager: DatabaseManager;
  close(): void;
};

type PersistenceResources = Omit<AgentDaemonPersistenceRuntime, "databaseManager" | "close"> & {
  readonly db: Database.Database;
  readonly economicRuntime: EconomicMemoryRuntime;
};

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
    resources = {
      db,
      economicRuntime,
      bus: createAgentMessageBusStore(db),
      consensusStore: createAgentConsensusStore(db),
      reader: createSqliteOperationalReadModel(db),
      economicOutcomeStore: economicRuntime.readers.outcomes,
      economicLearningStore: createSqliteEconomicLearningStore(db),
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
        return async () => {
          throw new Error(
            "Generic restoreFrom is forbidden for the economic database; use restoreEconomicFrom",
          );
        };
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
    databaseManager,
    close,
  };
}
