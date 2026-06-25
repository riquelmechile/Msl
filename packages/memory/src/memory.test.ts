import { describe, expect, it } from "vitest";

import { evaluateFreshness, type ReadSnapshot } from "@msl/domain";

import {
  decideReadSnapshotFreshness,
  decideSelectiveSync,
  type PgvectorMemoryStore,
  type PostgresRepositoryBoundary,
} from "./index.js";

function listingSnapshot(
  overrides: Partial<ReadSnapshot<{ id: string }>> = {},
): ReadSnapshot<{ id: string }> {
  return {
    sellerId: "seller-1",
    kind: "listing",
    source: "mercadolibre-api",
    data: [{ id: "MLC123" }],
    completeness: "complete",
    freshness: evaluateFreshness({
      source: "mercadolibre-api",
      signalKind: "listing",
      capturedAt: new Date("2026-06-25T12:00:00.000Z"),
      now: new Date("2026-06-25T12:05:00.000Z"),
    }),
    confidence: "high",
    ...overrides,
  };
}

describe("PostgreSQL and pgvector memory boundaries", () => {
  it("keeps repository contracts local-first by default", async () => {
    const saved: string[] = [];
    const repository: PostgresRepositoryBoundary<{ id: string }, string> = {
      storage: "postgresql",
      residency: "local-only",
      findById: (id) => Promise.resolve({ id }),
      save: (entity) => {
        saved.push(entity.id);
        return Promise.resolve();
      },
      transaction: (operation) => operation(),
    };

    await repository.save({ id: "memory-1" });

    expect(repository.storage).toBe("postgresql");
    expect(repository.residency).toBe("local-only");
    expect(saved).toEqual(["memory-1"]);
  });

  it("defines pgvector search without requiring an external service", async () => {
    const store: PgvectorMemoryStore = {
      storage: "postgresql-pgvector",
      upsert: () => Promise.resolve(),
      search: () => Promise.resolve([]),
    };

    await expect(
      store.search({ sellerId: "seller-1", embedding: [0.1, 0.2], limit: 3 }),
    ).resolves.toEqual([]);
  });
});

describe("selective sync policy", () => {
  it("keeps fresh local data local when remote sync is not explicitly needed", () => {
    const freshness = evaluateFreshness({
      source: "local-cache",
      signalKind: "historical-summary",
      capturedAt: new Date("2026-06-25T00:00:00.000Z"),
      now: new Date("2026-06-25T12:00:00.000Z"),
    });

    expect(decideSelectiveSync({ freshness, explicitRemoteSyncNeeded: false })).toEqual({
      shouldSync: false,
      storage: "local-only",
      reason: "fresh-local",
      refreshMode: "none",
    });
  });

  it("prioritizes stale critical signals without broad remote sync", () => {
    const freshness = evaluateFreshness({
      source: "local-cache",
      signalKind: "claim",
      capturedAt: new Date("2026-06-25T12:00:00.000Z"),
      now: new Date("2026-06-25T12:06:00.000Z"),
    });

    expect(decideSelectiveSync({ freshness, explicitRemoteSyncNeeded: false })).toEqual({
      shouldSync: true,
      storage: "local-only",
      reason: "critical-stale-refresh",
      refreshMode: "webhook-or-risk-scheduled",
    });
  });
});

describe("read snapshot freshness decisions", () => {
  it("allows fresh complete snapshots with usable confidence", () => {
    expect(decideReadSnapshotFreshness(listingSnapshot())).toEqual({
      status: "fresh-enough",
      reason: "fresh-complete-confidence",
      refreshRequired: false,
    });
  });

  it("requires refresh for stale snapshots", () => {
    const staleSnapshot = listingSnapshot({
      freshness: evaluateFreshness({
        source: "mercadolibre-api",
        signalKind: "listing",
        capturedAt: new Date("2026-06-25T12:00:00.000Z"),
        now: new Date("2026-06-25T13:01:00.000Z"),
      }),
    });

    expect(decideReadSnapshotFreshness(staleSnapshot)).toEqual({
      status: "refresh-required",
      reason: "stale",
      refreshRequired: true,
    });
  });

  it("requires refresh for partial snapshots before claiming confidence", () => {
    expect(decideReadSnapshotFreshness(listingSnapshot({ completeness: "partial" }))).toEqual({
      status: "refresh-required",
      reason: "partial",
      refreshRequired: true,
    });
  });
});
