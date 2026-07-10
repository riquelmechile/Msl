import type { BusinessSignalKind, CacheFreshness, ReadSnapshot, SellerId } from "@msl/domain";

// Re-export Supplier Mirror runtime singleton.
export {
  getSupplierMirrorRuntimeFromEnv,
  resetSupplierMirrorRuntime,
} from "./supplierMirrorRuntime.js";

// Re-export Cortex graph engine for agent conversation context.
export {
  createGraphEngine,
  createDatabase,
  migrate,
  cosineSimilarity,
  GraphEngine,
} from "./cortex/index.js";
export { DuplicateEdgeError, NodeNotFoundError } from "./cortex/index.js";
export { canStoreInCortex, decideCortexFeedbackAction } from "./cortex/index.js";
export type {
  ActivationSnapshot,
  ActorProfileNode,
  ConvergenceResult,
  DarwinianLesson,
  GraphEdge,
  GraphNode,
  SpreadingOptions,
  TraversalResult,
} from "./cortex/index.js";
export type {
  CortexFeedbackAction,
  CortexFeedbackDecision,
  CortexSnapshotStorageRequest,
  DelegationApprovalFeedback,
  DelegationCorrectionFeedback,
  DelegationFeedback,
  DelegationFeedbackKind,
  DelegationPruningFeedback,
  DelegationRejectionFeedback,
} from "./cortex/index.js";
export type {
  CheckpointRow,
  OperationalEvidenceQuery,
  OperationalReadModel,
  OperationalReadModelReader,
  OperationalReadModelSnapshot,
  OperationalReadModelWriter,
  SearchSnapshotsFilter,
  SnapshotRow,
  SnapshotSearchResult,
} from "./operationalReadModel.js";
export {
  createSqliteOperationalReadModel,
  migrateOperationalStore,
} from "./operationalReadModel.js";
export type { EvidenceRequestStore, EnqueueResult, ClaimResult } from "./evidenceRequestStore.js";
export {
  createSqliteEvidenceRequestStore,
  migrateEvidenceStore,
} from "./evidenceRequestStore.js";
export type { SupplierMirrorStore } from "./supplierMirrorStore.js";
export {
  createSqliteSupplierMirrorStore,
  migrateSupplierMirrorStore,
} from "./supplierMirrorStore.js";
export type {
  OwnedEcommerceApprovalRecord,
  OwnedEcommerceStore,
  OwnedEcommerceValidationRecord,
} from "./ownedEcommerceStore.js";
export {
  createSqliteOwnedEcommerceStore,
  migrateOwnedEcommerceStore,
} from "./ownedEcommerceStore.js";

// Re-export shared connection pool and backup utilities.
export { getSharedDb, closeSharedDb } from "./connectionPool.js";
export { backupDatabase } from "./backup.js";

export type LocalDataResidency = "local-only" | "selective-remote-sync";

export type RepositoryBoundary<TEntity, TKey> = {
  findById(key: TKey): Promise<TEntity | null>;
  save(entity: TEntity): Promise<void>;
};

export type PostgresRepositoryBoundary<TEntity, TKey> = RepositoryBoundary<TEntity, TKey> & {
  storage: "postgresql";
  residency: LocalDataResidency;
  transaction<TValue>(operation: () => Promise<TValue>): Promise<TValue>;
};

export type BusinessMemoryRecord = {
  id: string;
  sellerId: SellerId;
  kind: BusinessSignalKind | "learned-preference";
  payload: Readonly<Record<string, unknown>>;
  freshness: CacheFreshness;
  residency: LocalDataResidency;
};

export type VectorEmbedding = ReadonlyArray<number>;

export type PgvectorMemoryDocument = {
  id: string;
  sellerId: SellerId;
  text: string;
  embedding: VectorEmbedding;
  freshness: CacheFreshness;
};

export type PgvectorMemoryStore = {
  storage: "postgresql-pgvector";
  upsert(document: PgvectorMemoryDocument): Promise<void>;
  search(input: {
    sellerId: SellerId;
    embedding: VectorEmbedding;
    limit: number;
  }): Promise<ReadonlyArray<PgvectorMemoryDocument>>;
};

export type SelectiveSyncDecision = {
  shouldSync: boolean;
  storage: LocalDataResidency;
  reason: "fresh-local" | "critical-stale-refresh" | "explicit-remote-sync-needed";
  refreshMode: "none" | "webhook-or-risk-scheduled";
};

export type ReadSnapshotFreshnessDecision = {
  status: "fresh-enough" | "refresh-required";
  reason: "fresh-complete-confidence" | "stale" | "partial" | "low-confidence";
  refreshRequired: boolean;
};

export function decideReadSnapshotFreshness(
  snapshot: ReadSnapshot<unknown>,
): ReadSnapshotFreshnessDecision {
  if (snapshot.freshness.status === "stale") {
    return {
      status: "refresh-required",
      reason: "stale",
      refreshRequired: true,
    };
  }

  if (snapshot.completeness === "partial") {
    return {
      status: "refresh-required",
      reason: "partial",
      refreshRequired: true,
    };
  }

  if (snapshot.confidence === "low") {
    return {
      status: "refresh-required",
      reason: "low-confidence",
      refreshRequired: true,
    };
  }

  return {
    status: "fresh-enough",
    reason: "fresh-complete-confidence",
    refreshRequired: false,
  };
}

export {
  ingestSupplierToCortex,
  ingestAllSuppliersToCortex,
  ingestFallbackLessonToCortex,
  getCortexNodeIdsForSupplierCandidate,
} from "./supplierMirrorCortexBridge.js";
export type { SupplierCortexIngestionResult } from "./supplierMirrorCortexBridge.js";

export function decideSelectiveSync(input: {
  freshness: CacheFreshness;
  explicitRemoteSyncNeeded: boolean;
}): SelectiveSyncDecision {
  if (input.explicitRemoteSyncNeeded) {
    return {
      shouldSync: true,
      storage: "selective-remote-sync",
      reason: "explicit-remote-sync-needed",
      refreshMode: "webhook-or-risk-scheduled",
    };
  }

  if (input.freshness.status === "stale" && input.freshness.risk === "critical") {
    return {
      shouldSync: true,
      storage: "local-only",
      reason: "critical-stale-refresh",
      refreshMode: "webhook-or-risk-scheduled",
    };
  }

  return {
    shouldSync: false,
    storage: "local-only",
    reason: "fresh-local",
    refreshMode: "none",
  };
}
