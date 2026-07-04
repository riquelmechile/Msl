import type {
  SupplierId,
  SupplierRegistryEntry,
  SupplierSourceType,
  SupplierItemSnapshot,
  SupplierMirrorConfidence,
  SupplierMirrorFreshness,
  SupplierStockObservation,
} from "@msl/domain";

export const supplierMirrorDefaultPollIntervalMs = 10 * 60 * 1000;

export type SupplierMirrorWorkerOptions = {
  store: SupplierMirrorStorePort;
  adapters: ReadonlyMap<SupplierId, SupplierSourceAdapter>;
  rateLimiter?: SupplierMirrorRateLimiter;
};

export type SupplierMirrorSchedulerOptions = SupplierMirrorWorkerOptions & {
  enabled?: boolean;
  intervalMs?: number;
  jitterMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
};

export type SupplierMirrorWorkerCycleResult = {
  status: "completed";
  suppliersChecked: number;
  suppliersSkippedByRateLimit: number;
  itemsPersisted: number;
  observationsPersisted: number;
  evidenceIds: readonly string[];
};

type SupplierMirrorScheduledRuntime = {
  enabled: boolean;
  intervalMs: number;
  stop(): void;
};

export type SupplierMirrorAdapterRegistry = {
  register(supplierId: SupplierId, adapter: SupplierSourceAdapter): void;
  get(supplierId: SupplierId): SupplierSourceAdapter | undefined;
  asReadonlyMap(): ReadonlyMap<SupplierId, SupplierSourceAdapter>;
};

export type SupplierMirrorRateLimiter = {
  allow(key: string): boolean;
};

export type SupplierMirrorRateLimiterOptions = {
  minIntervalMs: number;
  now?: () => Date;
};

export type SupplierMirrorIngestionResult = {
  itemsPersisted: number;
  observationsPersisted: number;
  evidenceIds: readonly string[];
};

export type SupplierMirrorStorePort = {
  listEnabledSuppliers(): Promise<SupplierRegistryEntry[]>;
  upsertSupplierItemSnapshot(snapshot: SupplierItemSnapshot): Promise<void>;
  recordStockObservation(observation: SupplierStockObservation): Promise<void>;
};

export type SupplierSourceEvidence = {
  id: string;
  supplierId: SupplierId;
  supplierItemId?: string;
  source: SupplierSourceType;
  confidence: SupplierMirrorConfidence;
  freshness: SupplierMirrorFreshness;
  capturedAt: string;
  summary: string;
  metadata: Readonly<Record<string, unknown>>;
};

export type SupplierSourceCollectInput = {
  supplierId: SupplierId;
  lowStockThreshold?: number;
  itemIds?: readonly string[];
};

export type SupplierSourceCollectResult = {
  supplierId: SupplierId;
  source: SupplierSourceType;
  items: readonly SupplierItemSnapshot[];
  stockObservations: readonly SupplierStockObservation[];
  evidence: readonly SupplierSourceEvidence[];
};

export type SupplierSourceAdapter = {
  readonly source: SupplierSourceType;
  collect(input: SupplierSourceCollectInput): Promise<SupplierSourceCollectResult>;
};

export function createSupplierMirrorAdapterRegistry(
  initialAdapters: ReadonlyMap<SupplierId, SupplierSourceAdapter> = new Map(),
): SupplierMirrorAdapterRegistry {
  const adapters = new Map(initialAdapters);
  return {
    register(supplierId, adapter) {
      adapters.set(supplierId, adapter);
    },
    get(supplierId) {
      return adapters.get(supplierId);
    },
    asReadonlyMap() {
      return adapters;
    },
  };
}

export function createSupplierMirrorRateLimiter(
  options: SupplierMirrorRateLimiterOptions,
): SupplierMirrorRateLimiter {
  const now = options.now ?? (() => new Date());
  const lastAllowedAt = new Map<string, number>();

  return {
    allow(key) {
      const current = now().getTime();
      const previous = lastAllowedAt.get(key);
      if (previous !== undefined && current - previous < options.minIntervalMs) {
        return false;
      }
      lastAllowedAt.set(key, current);
      return true;
    },
  };
}

export function startSupplierMirrorScheduler(
  options: SupplierMirrorSchedulerOptions,
): SupplierMirrorScheduledRuntime {
  const intervalMs = options.intervalMs ?? supplierMirrorDefaultPollIntervalMs;
  if (options.enabled !== true) {
    return { enabled: false, intervalMs, stop: () => undefined };
  }

  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const jitterMs = options.jitterMs ?? Math.floor(intervalMs * 0.1);
  const worker = createSupplierMirrorWorker(options);
  const handle = setIntervalFn(() => {
    const delayMs = jitterMs <= 0 ? 0 : Math.floor(Math.random() * jitterMs);
    setTimeoutFn(() => {
      void worker.runOnce();
    }, delayMs);
  }, intervalMs);

  return {
    enabled: true,
    intervalMs,
    stop: () => clearIntervalFn(handle),
  };
}

export function createSupplierMirrorWorker(options: SupplierMirrorWorkerOptions): {
  runOnce(): Promise<SupplierMirrorWorkerCycleResult>;
} {
  return {
    async runOnce() {
      let suppliersChecked = 0;
      let suppliersSkippedByRateLimit = 0;
      let itemsPersisted = 0;
      let observationsPersisted = 0;
      const evidenceIds: string[] = [];
      const suppliers = await options.store.listEnabledSuppliers();

      for (const supplier of suppliers) {
        const adapter = options.adapters.get(supplier.id);
        if (adapter === undefined) {
          continue;
        }
        if (options.rateLimiter?.allow(rateLimitKey(supplier.id)) === false) {
          suppliersSkippedByRateLimit += 1;
          continue;
        }

        suppliersChecked += 1;
        const result = await adapter.collect({ supplierId: supplier.id });
        const ingestion = await persistSupplierMirrorIngestion(options.store, result);
        itemsPersisted += ingestion.itemsPersisted;
        observationsPersisted += ingestion.observationsPersisted;
        evidenceIds.push(...ingestion.evidenceIds);
      }

      return {
        status: "completed",
        suppliersChecked,
        suppliersSkippedByRateLimit,
        itemsPersisted,
        observationsPersisted,
        evidenceIds: unique(evidenceIds),
      };
    },
  };
}

export async function persistSupplierMirrorIngestion(
  store: SupplierMirrorStorePort,
  result: SupplierSourceCollectResult,
): Promise<SupplierMirrorIngestionResult> {
  for (const snapshot of result.items) {
    await store.upsertSupplierItemSnapshot(snapshot);
  }
  for (const observation of result.stockObservations) {
    await store.recordStockObservation(observation);
  }

  return {
    itemsPersisted: result.items.length,
    observationsPersisted: result.stockObservations.length,
    evidenceIds: unique([
      ...result.evidence.map((evidence) => evidence.id),
      ...result.stockObservations.map((observation) => observation.evidenceId),
    ]),
  };
}

function rateLimitKey(id: string): string {
  return stableKey("supplier-mirror", "rate-limit", "supplier", id);
}

function stableKey(...parts: readonly string[]): string {
  return parts.map((part) => part.replace(/[^a-zA-Z0-9-]/g, "-")).join(":");
}

function unique(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values));
}
