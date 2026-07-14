import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEconomicMemoryRuntime } from "../src/economicWriteSession.js";
import { readEconomicDatabaseFence } from "../src/migrationRegistry.js";

describe("AdmittedEconomicWriteSession", () => {
  it("consumes one receipt and advances the epoch exactly once", async () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-admitted-session-"));
    const databasePath = join(directory, "economic.sqlite");
    const now = 101;
    const runtime = createEconomicMemoryRuntime({ databasePath, now: () => now });
    const db = new Database(databasePath);
    try {
      const before = readEconomicDatabaseFence(db, now).writeEpoch;
      const ownership = await runtime.writeSessionFactory.open({
        sellerId: "plasticov",
        ownerRunId: "run-a",
        receiptTtlMs: 1_000,
      });
      const failedRun = {
        runId: "run-a",
        sellerId: "plasticov",
        mode: "incremental" as const,
        sourceKinds: ["orders"],
        startedAt: now,
        completedAt: now,
        recordsFetched: 0,
        recordsNormalized: 0,
        componentsCreated: 0,
        snapshotsCreated: 0,
        duplicatesIgnored: 0,
        partialSnapshots: 0,
        disputedSnapshots: 0,
        errors: ["failed"],
        status: "failed" as const,
        noExternalMutationExecuted: true as const,
      };
      await ownership.session.recordFailure({ run: failedRun, error: "failed" });
      expect(readEconomicDatabaseFence(db, now).writeEpoch).toBe(before + 1);
      await expect(
        ownership.session.recordFailure({ run: failedRun, error: "failed" }),
      ).rejects.toThrow("already consumed");
      await ownership.release();
    } finally {
      db.close();
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("releases lease and fence when receipt issuance fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-admission-cleanup-"));
    const databasePath = join(directory, "economic.sqlite");
    const runtime = createEconomicMemoryRuntime({ databasePath, now: () => 101 });
    const db = new Database(databasePath);
    try {
      await expect(
        runtime.writeSessionFactory.open({
          sellerId: "plasticov",
          ownerRunId: "run-receipt-failure",
          receiptTtlMs: 0,
        }),
      ).rejects.toThrow("Invalid admission receipt TTL");
      expect(readEconomicDatabaseFence(db, 101).ownerRunId).toBeNull();
      expect(db.prepare("SELECT COUNT(*) AS count FROM economic_seller_leases").get()).toEqual({
        count: 0,
      });
    } finally {
      db.close();
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("releases the fence in finally when lease release fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-release-cleanup-"));
    const databasePath = join(directory, "economic.sqlite");
    const runtime = createEconomicMemoryRuntime({ databasePath, now: () => 101 });
    const db = new Database(databasePath);
    try {
      const ownership = await runtime.writeSessionFactory.open({
        sellerId: "plasticov",
        ownerRunId: "run-release-failure",
        receiptTtlMs: 1_000,
      });
      db.exec("DROP TABLE economic_seller_leases");
      await expect(ownership.release()).rejects.toThrow("no such table: economic_seller_leases");
      expect(readEconomicDatabaseFence(db, 101).ownerRunId).toBeNull();
    } finally {
      db.close();
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
