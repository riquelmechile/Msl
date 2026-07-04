import type {
  SupplierId,
  SupplierRegistryEntry,
  SupplierSourceType,
  SupplierItemSnapshot,
  SupplierMirrorConfidence,
  SupplierMirrorFreshness,
  SupplierMirrorLedgerRecord,
  SupplierMirrorNotificationEvent,
  SupplierStockObservation,
  SupplierTargetMapping,
  SupplierTargetPolicy,
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
  listSupplierItemSnapshots?(supplierId: SupplierId): Promise<SupplierItemSnapshot[]>;
  listStockObservations?(
    supplierId: SupplierId,
    supplierItemId: string,
  ): Promise<SupplierStockObservation[]>;
  listTargetMappings?(
    supplierId: SupplierId,
    supplierItemId: string,
  ): Promise<SupplierTargetMapping[]>;
  resolveTargetPolicy?(input: {
    supplierId: SupplierId;
    supplierItemId: string;
    categoryId?: string;
  }): Promise<SupplierTargetPolicy | null>;
  appendLedger?(record: SupplierMirrorLedgerRecord): Promise<SupplierMirrorLedgerRecord>;
  recordNotificationEvent?(
    event: SupplierMirrorNotificationEvent,
  ): Promise<SupplierMirrorNotificationEvent>;
};

export type SupplierMirrorStockBreakCandidate = {
  supplierId: SupplierId;
  supplierItemId: string;
  snapshot: SupplierItemSnapshot;
  policy: SupplierTargetPolicy;
  latestObservation: SupplierStockObservation;
  mappings: readonly SupplierTargetMapping[];
};

export type SupplierMirrorStockBreakVerification =
  | {
      status: "confirmed";
      evidenceIds: readonly string[];
      observation: SupplierStockObservation;
    }
  | { status: "inconclusive"; reason: string; evidenceIds: readonly string[] };

export type SupplierMirrorStockBreakVerifier = {
  verify(
    candidate: SupplierMirrorStockBreakCandidate,
  ): Promise<SupplierMirrorStockBreakVerification>;
};

export type SupplierMirrorPauseExecutor = {
  pause(input: {
    targetSellerId: string;
    targetItemId: string;
    idempotencyKey: string;
    evidenceIds: readonly string[];
  }): Promise<{ status: "paused"; evidenceId?: string }>;
};

export type SupplierMirrorStockBreakMonitorOptions = {
  store: SupplierMirrorStorePort;
  verifier?: SupplierMirrorStockBreakVerifier;
  pauseExecutor: SupplierMirrorPauseExecutor;
  now?: () => Date;
};

export type SupplierMirrorStockBreakMonitorResult = {
  candidatesEvaluated: number;
  pausesExecuted: number;
  deferred: number;
  skipped: number;
  ledgerRecords: readonly SupplierMirrorLedgerRecord[];
  notificationEvents: readonly SupplierMirrorNotificationEvent[];
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

export async function runSupplierMirrorStockBreakMonitor(
  options: SupplierMirrorStockBreakMonitorOptions,
): Promise<SupplierMirrorStockBreakMonitorResult> {
  requireMonitorStore(options.store);

  const now = options.now ?? (() => new Date());
  const verifier = options.verifier ?? { verify: verifyLatestAuthoritativeStockBreak };
  const candidates = await selectSupplierMirrorStockBreakCandidates(options.store);
  const ledgerRecords: SupplierMirrorLedgerRecord[] = [];
  const notificationEvents: SupplierMirrorNotificationEvent[] = [];
  let pausesExecuted = 0;
  let deferred = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const verification = await verifier.verify(candidate);
    if (verification.status !== "confirmed") {
      const event = buildNotificationEvent({
        candidate,
        type: "verification-inconclusive",
        reason: verification.reason,
        evidenceIds: verification.evidenceIds,
        now,
      });
      notificationEvents.push(await options.store.recordNotificationEvent!(event));
      skipped += 1;
      continue;
    }

    for (const mapping of candidate.mappings.filter((item) => item.state === "approved")) {
      const evidenceIds = unique([
        candidate.latestObservation.evidenceId,
        candidate.snapshot.evidenceId,
        ...mapping.evidenceIds,
        ...verification.evidenceIds,
      ]);
      const idempotencyKey = stockBreakIdempotencyKey(mapping);

      if (!candidate.policy.targetSellerIds.includes(mapping.targetSellerId)) {
        const reason = "target-seller-not-allowed-by-policy";
        const record = await appendMonitorLedger(options.store, {
          candidate,
          mapping,
          idempotencyKey,
          status: "deferred",
          actionType: "defer",
          reason,
          evidenceIds,
          now,
        });
        const event = await options.store.recordNotificationEvent!(
          buildNotificationEvent({
            candidate,
            mapping,
            type: "pause-deferred",
            reason,
            evidenceIds,
            now,
          }),
        );
        ledgerRecords.push(record);
        notificationEvents.push(event);
        deferred += 1;
        continue;
      }

      if (!candidate.policy.autoPauseAllowed) {
        const reason = "auto-pause-not-allowed-by-policy";
        const record = await appendMonitorLedger(options.store, {
          candidate,
          mapping,
          idempotencyKey,
          status: "deferred",
          actionType: "defer",
          reason,
          evidenceIds,
          now,
        });
        const event = await options.store.recordNotificationEvent!(
          buildNotificationEvent({
            candidate,
            mapping,
            type: "pause-deferred",
            reason,
            evidenceIds,
            now,
          }),
        );
        ledgerRecords.push(record);
        notificationEvents.push(event);
        deferred += 1;
        continue;
      }

      const pauseResult = await options.pauseExecutor.pause({
        targetSellerId: mapping.targetSellerId,
        targetItemId: mapping.targetItemId,
        idempotencyKey,
        evidenceIds,
      });
      const executedEvidenceIds = unique([
        ...evidenceIds,
        ...(pauseResult.evidenceId === undefined ? [] : [pauseResult.evidenceId]),
      ]);
      const record = await appendMonitorLedger(options.store, {
        candidate,
        mapping,
        idempotencyKey,
        status: "executed",
        actionType: "pause-listing",
        reason: "verified-stock-break-auto-pause-executed",
        evidenceIds: executedEvidenceIds,
        now,
      });
      const event = await options.store.recordNotificationEvent!(
        buildNotificationEvent({
          candidate,
          mapping,
          type: "stock-break-confirmed",
          reason: "verified-stock-break-auto-pause-executed",
          evidenceIds: executedEvidenceIds,
          now,
        }),
      );
      ledgerRecords.push(record);
      notificationEvents.push(event);
      pausesExecuted += 1;
    }
  }

  return {
    candidatesEvaluated: candidates.length,
    pausesExecuted,
    deferred,
    skipped,
    ledgerRecords,
    notificationEvents,
  };
}

export async function selectSupplierMirrorStockBreakCandidates(
  store: SupplierMirrorStorePort,
): Promise<SupplierMirrorStockBreakCandidate[]> {
  requireMonitorStore(store);
  const candidates: SupplierMirrorStockBreakCandidate[] = [];
  const suppliers = await store.listEnabledSuppliers();

  for (const supplier of suppliers) {
    const snapshots = await store.listSupplierItemSnapshots!(supplier.id);
    for (const snapshot of snapshots) {
      const policy = await store.resolveTargetPolicy!({
        supplierId: snapshot.supplierId,
        supplierItemId: snapshot.supplierItemId,
        ...(snapshot.categoryId === undefined ? {} : { categoryId: snapshot.categoryId }),
      });
      if (policy === null) continue;

      const observations = await store.listStockObservations!(
        snapshot.supplierId,
        snapshot.supplierItemId,
      );
      const latestObservation = observations[0];
      if (latestObservation === undefined) continue;
      if (!isPossibleStockBreak(latestObservation, policy)) continue;

      const mappings = await store.listTargetMappings!(
        snapshot.supplierId,
        snapshot.supplierItemId,
      );
      const approvedMappings = mappings.filter((mapping) => mapping.state === "approved");
      if (approvedMappings.length === 0) continue;

      candidates.push({
        supplierId: supplier.id,
        supplierItemId: snapshot.supplierItemId,
        snapshot,
        policy,
        latestObservation,
        mappings: approvedMappings,
      });
    }
  }

  return candidates;
}

function verifyLatestAuthoritativeStockBreak(
  candidate: SupplierMirrorStockBreakCandidate,
): Promise<SupplierMirrorStockBreakVerification> {
  if (
    candidate.latestObservation.authority === "stock-authoritative" &&
    candidate.latestObservation.confidence === "high" &&
    isPossibleStockBreak(candidate.latestObservation, candidate.policy)
  ) {
    return Promise.resolve({
      status: "confirmed",
      observation: candidate.latestObservation,
      evidenceIds: [candidate.latestObservation.evidenceId],
    });
  }

  return Promise.resolve({
    status: "inconclusive",
    reason: "stock-break-verification-inconclusive",
    evidenceIds: [candidate.latestObservation.evidenceId],
  });
}

function requireMonitorStore(store: SupplierMirrorStorePort): void {
  if (
    store.listSupplierItemSnapshots === undefined ||
    store.listStockObservations === undefined ||
    store.listTargetMappings === undefined ||
    store.resolveTargetPolicy === undefined ||
    store.appendLedger === undefined ||
    store.recordNotificationEvent === undefined
  ) {
    throw new Error("Supplier Mirror stock-break monitor requires full store methods");
  }
}

function isPossibleStockBreak(
  observation: SupplierStockObservation,
  policy: SupplierTargetPolicy,
): boolean {
  return (
    observation.status === "out-of-stock" ||
    observation.status === "low-stock" ||
    (observation.quantity !== null && observation.quantity <= policy.lowStockThreshold)
  );
}

async function appendMonitorLedger(
  store: SupplierMirrorStorePort,
  input: {
    candidate: SupplierMirrorStockBreakCandidate;
    mapping: SupplierTargetMapping;
    idempotencyKey: string;
    actionType: SupplierMirrorLedgerRecord["actionType"];
    status: SupplierMirrorLedgerRecord["status"];
    reason: string;
    evidenceIds: readonly string[];
    now: () => Date;
  },
): Promise<SupplierMirrorLedgerRecord> {
  return store.appendLedger!({
    id: stableKey("supplier-mirror", "ledger", input.idempotencyKey),
    actionType: input.actionType,
    idempotencyKey: input.idempotencyKey,
    status: input.status,
    reason: input.reason,
    supplierId: input.candidate.supplierId,
    supplierItemId: input.candidate.supplierItemId,
    targetSellerId: input.mapping.targetSellerId,
    targetItemId: input.mapping.targetItemId,
    evidenceIds: input.evidenceIds,
    before: { targetStatus: "active" },
    after: input.status === "executed" ? { targetStatus: "paused" } : null,
    createdAt: input.now().toISOString(),
  });
}

function buildNotificationEvent(input: {
  candidate: SupplierMirrorStockBreakCandidate;
  mapping?: SupplierTargetMapping;
  type: SupplierMirrorNotificationEvent["type"];
  reason: string;
  evidenceIds: readonly string[];
  now: () => Date;
}): SupplierMirrorNotificationEvent {
  return {
    id: stableKey(
      "supplier-mirror",
      "notification",
      input.type,
      input.candidate.supplierId,
      input.candidate.supplierItemId,
      input.mapping?.targetSellerId ?? "no-target",
      input.mapping?.targetItemId ?? "no-item",
    ),
    type: input.type,
    status: "pending",
    supplierId: input.candidate.supplierId,
    supplierItemId: input.candidate.supplierItemId,
    ...(input.mapping === undefined
      ? {}
      : { targetSellerId: input.mapping.targetSellerId, targetItemId: input.mapping.targetItemId }),
    reason: input.reason,
    evidenceIds: input.evidenceIds,
    metadata: {
      lowStockThreshold: input.candidate.policy.lowStockThreshold,
      autoPauseAllowed: input.candidate.policy.autoPauseAllowed,
      policyTargetSellerIds: input.candidate.policy.targetSellerIds,
    },
    createdAt: input.now().toISOString(),
  };
}

function stockBreakIdempotencyKey(mapping: SupplierTargetMapping): string {
  return stableKey(
    "supplier-mirror",
    "stock-break",
    "pause",
    mapping.supplierId,
    mapping.supplierItemId,
    mapping.targetSellerId,
    mapping.targetItemId,
  );
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
