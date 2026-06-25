import type { BusinessSignalKind, CacheFreshness, SellerId } from "@msl/domain";

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
