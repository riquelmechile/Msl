import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { unlinkSync } from "node:fs";

import { evaluateFreshness, type ReadSnapshot } from "@msl/domain";

import {
  decideReadSnapshotFreshness,
  decideSelectiveSync,
  type PgvectorMemoryStore,
  type PostgresRepositoryBoundary,
} from "./index.js";
import { backupDatabase } from "./backup.js";

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

// ─────────────────────────────────────────────────────────────────────
// Database backup (bottleneck 2.7)
// ─────────────────────────────────────────────────────────────────────
describe("backupDatabase", () => {
  const backupPath = "/tmp/msl-backup-test.db";

  it("creates a valid backup copy of a file-based database", async () => {
    const sourcePath = "/tmp/msl-backup-source.db";
    // Clean up from previous runs
    try { unlinkSync(sourcePath); } catch { /* ok */ }
    try { unlinkSync(backupPath); } catch { /* ok */ }

    // Create a file-based source DB with some data.
    const sourceDb = new Database(sourcePath);
    try {
      sourceDb.pragma("journal_mode = WAL");
      sourceDb.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
      sourceDb.exec("INSERT INTO test (value) VALUES ('hello'), ('world')");

      const pages = await backupDatabase(sourceDb, backupPath, false);
      expect(typeof pages).toBe("number");
    } finally {
      sourceDb.close();
    }

    // Open the backup and verify data integrity
    const backup = new Database(backupPath);
    try {
      const rows = backup.prepare("SELECT * FROM test").all() as Array<{ id: number; value: string }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]!.value).toBe("hello");
      expect(rows[1]!.value).toBe("world");
    } finally {
      backup.close();
    }

    // Cleanup
    try { unlinkSync(sourcePath); } catch { /* ok */ }
    try { unlinkSync(backupPath); } catch { /* ok */ }
  });
});
