import { describe, expect, it } from "vitest";
import type { OperationalReadModelReader, OperationalReadModelSnapshot } from "@msl/memory";
import type { OperationalEvidenceQuery } from "@msl/memory";
import { createSqliteOperationalReadModel } from "@msl/memory";
import Database from "better-sqlite3";
import { OperationalDailyDataSource } from "../../src/conversation/operationalDataSource.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function mockSnapshot<T>(overrides: {
  kind: string;
  data: T;
  evidenceId?: string;
  capturedAt?: string;
  freshnessStatus?: "fresh" | "stale";
}): OperationalReadModelSnapshot<T> {
  return {
    sellerId: "seller-1",
    kind: overrides.kind as OperationalReadModelSnapshot<T>["kind"],
    source: "local-cache",
    data: overrides.data,
    completeness: "complete",
    freshness: {
      source: "local-cache",
      signalKind: overrides.kind as OperationalReadModelSnapshot<T>["kind"],
      risk: "medium",
      capturedAt: new Date(overrides.capturedAt ?? "2026-07-02T10:00:00Z"),
      maxAgeMs: 60 * 60 * 1000,
      status: overrides.freshnessStatus ?? "fresh",
    },
    confidence: "high",
    evidence: {
      evidenceId: overrides.evidenceId ?? "evt-1",
      snapshotKind: overrides.kind as OperationalReadModelSnapshot<T>["kind"],
      sellerId: "seller-1",
      entityId: "item-1",
      capturedAt: new Date(overrides.capturedAt ?? "2026-07-02T10:00:00Z"),
      freshnessStatus: overrides.freshnessStatus ?? "fresh",
      completeness: "complete",
      source: "operational-read-model",
    },
  };
}

function mockReader(
  snapshots: Record<string, OperationalReadModelSnapshot<unknown> | null>,
): OperationalReadModelReader {
  /* eslint-disable @typescript-eslint/require-await */
  return {
    async findEvidence(query: OperationalEvidenceQuery) {
      const snap = snapshots[query.snapshotKind];
      return snap ? snap.evidence : null;
    },
    async readSnapshot<TData>(query: OperationalEvidenceQuery) {
      const snap = snapshots[query.snapshotKind];
      return (snap as OperationalReadModelSnapshot<TData> | null) ?? null;
    },
    async listSnapshots() {
      return [];
    },
  };
  /* eslint-enable @typescript-eslint/require-await */
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("OperationalDailyDataSource", () => {
  it("returns category stats populated from operational DB snapshot", async () => {
    const reader = mockReader({
      listing: mockSnapshot({
        kind: "listing",
        data: [
          { name: "Electrónica", activeProducts: 50, monthlySales: 1_000_000, marginAvg: 30 },
          { name: "Ropa", activeProducts: 30, monthlySales: 500_000, marginAvg: 45 },
        ],
      }),
    });

    const ds = await OperationalDailyDataSource.create(reader, "seller-1");
    const stats = ds.getCategoryStats();

    expect(stats).toHaveLength(2);
    expect(stats[0]!.name).toBe("Electrónica");
    expect(stats[0]!.activeProducts).toBe(50);
    expect(stats[0]!.monthlySales).toBe(1_000_000);
    expect(stats[0]!.marginAvg).toBe(30);
    expect(stats[1]!.name).toBe("Ropa");
  });

  it("returns monthly volume from operational DB order snapshot", async () => {
    const reader = mockReader({
      order: mockSnapshot({
        kind: "order",
        data: { total: 5_000_000 },
      }),
    });

    const ds = await OperationalDailyDataSource.create(reader, "seller-1");
    expect(ds.getMonthlyVolume()).toBe(5_000_000);
  });

  it("sums monthly volume from an array of order snapshots", async () => {
    const reader = mockReader({
      order: mockSnapshot({
        kind: "order",
        data: [{ total: 1_000_000 }, { total: 2_000_000 }, { total: 500_000 }],
      }),
    });

    const ds = await OperationalDailyDataSource.create(reader, "seller-1");
    expect(ds.getMonthlyVolume()).toBe(3_500_000);
  });

  it("returns reputation data populated from operational DB snapshot", async () => {
    const reader = mockReader({
      reputation: mockSnapshot({
        kind: "reputation",
        data: {
          level: "Gold",
          rating: 4.5,
          openClaims: 5,
          mediationClaims: 2,
          pendingResponse: 1,
          resolvedThisMonth: 10,
          claimRate: 0.8,
          avgResponseTimeHours: 6.0,
        },
      }),
    });

    const ds = await OperationalDailyDataSource.create(reader, "seller-1");
    const rep = ds.getReputation();

    expect(rep.level).toBe("Gold");
    expect(rep.rating).toBe(4.5);
    expect(rep.openClaims).toBe(5);
    expect(rep.mediationClaims).toBe(2);
    expect(rep.pendingResponse).toBe(1);
    expect(rep.resolvedThisMonth).toBe(10);
    expect(rep.claimRate).toBe(0.8);
    expect(rep.avgResponseTimeHours).toBe(6.0);
  });

  it("falls back to defaults when category snapshot is null", async () => {
    const reader = mockReader({
      listing: null,
    });

    const ds = await OperationalDailyDataSource.create(reader, "seller-1");
    const stats = ds.getCategoryStats();

    expect(stats.length).toBeGreaterThan(0);
    expect(stats[0]!.name).toBe("Hogar y Muebles");
  });

  it("falls back to defaults when volume snapshot is null", async () => {
    const reader = mockReader({
      order: null,
    });

    const ds = await OperationalDailyDataSource.create(reader, "seller-1");
    expect(ds.getMonthlyVolume()).toBe(9_820_000);
  });

  it("falls back to defaults when reputation snapshot is null", async () => {
    const reader = mockReader({
      reputation: null,
    });

    const ds = await OperationalDailyDataSource.create(reader, "seller-1");
    const rep = ds.getReputation();

    expect(rep.level).toBe("Platinum");
    expect(rep.rating).toBe(4.8);
  });

  it("falls back gracefully when all snapshots are null", async () => {
    const reader = mockReader({
      listing: null,
      order: null,
      reputation: null,
    });

    const ds = await OperationalDailyDataSource.create(reader, "seller-1");

    expect(ds.getCategoryStats().length).toBeGreaterThan(0);
    expect(ds.getMonthlyVolume()).toBeGreaterThan(0);
    expect(ds.getReputation().level.length).toBeGreaterThan(0);
  });

  it("includes freshness notes with captured_at timestamps", async () => {
    const reader = mockReader({
      listing: mockSnapshot({
        kind: "listing",
        data: [{ name: "Test", activeProducts: 1 }],
        evidenceId: "evt-listing-1",
        capturedAt: "2026-07-02T10:00:00Z",
        freshnessStatus: "fresh",
      }),
      order: mockSnapshot({
        kind: "order",
        data: { total: 1000 },
        evidenceId: "evt-order-1",
        capturedAt: "2026-07-02T08:00:00Z",
        freshnessStatus: "stale",
      }),
      reputation: mockSnapshot({
        kind: "reputation",
        data: {
          level: "Silver",
          rating: 4.0,
          openClaims: 0,
          mediationClaims: 0,
          pendingResponse: 0,
          resolvedThisMonth: 0,
          claimRate: 0,
          avgResponseTimeHours: 0,
        },
        evidenceId: "evt-rep-1",
        capturedAt: "2026-06-30T10:00:00Z",
        freshnessStatus: "stale",
      }),
    });

    const ds = await OperationalDailyDataSource.create(reader, "seller-1");
    const notes = ds.getFreshnessNotes();

    expect(notes).toContain("[listing] evt-listing-1");
    expect(notes).toContain("captured=2026-07-02T10:00:00Z");
    expect(notes).toContain("fresh");
    expect(notes).toContain("[order] evt-order-1");
    expect(notes).toContain("stale");
    expect(notes).toContain("[reputation] evt-rep-1");
    // Each line ≤ 80 chars
    for (const line of notes.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it("returns empty freshness notes when no snapshots were loaded", async () => {
    const reader = mockReader({
      listing: null,
      order: null,
      reputation: null,
    });

    const ds = await OperationalDailyDataSource.create(reader, "seller-1");
    expect(ds.getFreshnessNotes()).toBe("");
  });

  it("produces age description in freshness notes", async () => {
    const justNow = new Date().toISOString();
    const reader = mockReader({
      listing: mockSnapshot({
        kind: "listing",
        data: [{ name: "Test", activeProducts: 1 }],
        evidenceId: "evt-fresh-1",
        capturedAt: justNow,
        freshnessStatus: "fresh",
      }),
    });

    const ds = await OperationalDailyDataSource.create(reader, "seller-1");
    const notes = ds.getFreshnessNotes();

    // Captured just now should show minutes
    expect(notes).toMatch(/m ago/);
  });
});

// ── Integration tests ────────────────────────────────────────────────────

describe("OperationalDailyDataSource — integration with SQLite", () => {
  it("reads real data from in-memory SQLite operational store", async () => {
    const db = new Database(":memory:");
    const reader = createSqliteOperationalReadModel(db);

    // Insert listing snapshot.
    await reader.upsertSnapshot({
      sellerId: "seller-1",
      kind: "listing",
      source: "local-cache",
      data: [
        { name: "Electrónica", activeProducts: 50, monthlySales: 1_000_000, marginAvg: 30 },
        { name: "Ropa", activeProducts: 30, monthlySales: 500_000, marginAvg: 45 },
      ],
      completeness: "complete",
      freshness: {
        source: "local-cache",
        signalKind: "listing",
        risk: "medium",
        capturedAt: new Date("2026-07-02T10:00:00Z"),
        maxAgeMs: 60 * 60 * 1000,
        status: "fresh",
      },
      confidence: "high",
      evidence: {
        evidenceId: "evt-list-1",
        snapshotKind: "listing",
        sellerId: "seller-1",
        entityId: "item-1",
        capturedAt: new Date("2026-07-02T10:00:00Z"),
        freshnessStatus: "fresh",
        completeness: "complete",
        source: "operational-read-model",
      },
    });

    // Insert order snapshot.
    await reader.upsertSnapshot({
      sellerId: "seller-1",
      kind: "order",
      source: "local-cache",
      data: { total: 5_000_000 },
      completeness: "complete",
      freshness: {
        source: "local-cache",
        signalKind: "order",
        risk: "critical",
        capturedAt: new Date("2026-07-02T09:00:00Z"),
        maxAgeMs: 5 * 60 * 1000,
        status: "fresh",
      },
      confidence: "high",
      evidence: {
        evidenceId: "evt-ord-1",
        snapshotKind: "order",
        sellerId: "seller-1",
        entityId: "item-1",
        capturedAt: new Date("2026-07-02T09:00:00Z"),
        freshnessStatus: "fresh",
        completeness: "complete",
        source: "operational-read-model",
      },
    });

    // Insert reputation snapshot.
    await reader.upsertSnapshot({
      sellerId: "seller-1",
      kind: "reputation",
      source: "local-cache",
      data: {
        level: "Gold",
        rating: 4.5,
        openClaims: 5,
        mediationClaims: 2,
        pendingResponse: 1,
        resolvedThisMonth: 10,
        claimRate: 0.8,
        avgResponseTimeHours: 6.0,
      },
      completeness: "complete",
      freshness: {
        source: "local-cache",
        signalKind: "reputation",
        risk: "critical",
        capturedAt: new Date("2026-07-02T08:00:00Z"),
        maxAgeMs: 5 * 60 * 1000,
        status: "fresh",
      },
      confidence: "high",
      evidence: {
        evidenceId: "evt-rep-1",
        snapshotKind: "reputation",
        sellerId: "seller-1",
        entityId: "item-1",
        capturedAt: new Date("2026-07-02T08:00:00Z"),
        freshnessStatus: "fresh",
        completeness: "complete",
        source: "operational-read-model",
      },
    });

    const ds = await OperationalDailyDataSource.create(reader, "seller-1");

    // Verify category stats.
    const stats = ds.getCategoryStats();
    expect(stats).toHaveLength(2);
    expect(stats[0]!.name).toBe("Electrónica");
    expect(stats[0]!.activeProducts).toBe(50);

    // Verify volume.
    expect(ds.getMonthlyVolume()).toBe(5_000_000);

    // Verify reputation.
    const rep = ds.getReputation();
    expect(rep.level).toBe("Gold");
    expect(rep.openClaims).toBe(5);

    // Verify freshness notes.
    const notes = ds.getFreshnessNotes();
    expect(notes).toContain("evt-list-1");
    expect(notes).toContain("evt-ord-1");
    expect(notes).toContain("evt-rep-1");

    db.close();
  });

  it("falls back to defaults when DB has no matching snapshots", async () => {
    const db = new Database(":memory:");
    const reader = createSqliteOperationalReadModel(db);

    const ds = await OperationalDailyDataSource.create(reader, "seller-1");

    // Should use hardcoded defaults.
    expect(ds.getCategoryStats().length).toBeGreaterThan(0);
    expect(ds.getMonthlyVolume()).toBeGreaterThan(0);
    expect(ds.getReputation().level.length).toBeGreaterThan(0);

    db.close();
  });
});
