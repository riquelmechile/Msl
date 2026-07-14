import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireEconomicDatabaseFence,
  consumeEconomicWriteAdmissionReceipt,
  createEconomicMigrationPlan,
  issueEconomicWriteAdmissionReceipt,
  readEconomicDatabaseFence,
  releaseEconomicDatabaseFence,
  renewEconomicDatabaseFence,
  validateEconomicWriteAdmissionReceipt,
} from "../src/migrationRegistry.js";

describe("economic database fence and write admission receipts", () => {
  let db: Database.Database | undefined;

  afterEach(() => db?.close());

  it("migrates 1010 to 1011 on a real file, reruns safely, and stores no raw receipt token", () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-r5-receipt-"));
    const path = join(directory, "economic.sqlite");
    try {
      db = new Database(path);
      createEconomicMigrationPlan().apply(db);
      db.prepare("DELETE FROM schema_version WHERE version = 1011").run();
      db.exec("DROP TABLE economic_database_write_admission_receipts");
      expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 1, skipped: 10 });
      expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 0, skipped: 11 });
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get("idx_economic_write_admission_receipts_binding"),
      ).toBeDefined();
      db.close();
      db = new Database(path);
      expect(db.pragma("quick_check")).toEqual([{ quick_check: "ok" }]);
      expect(db.pragma("foreign_key_check")).toEqual([]);
      const acquired = acquireEconomicDatabaseFence({ db, ownerRunId: "run-a", now: 1_000 });
      expect(acquired.status).toBe("acquired");
      if (acquired.status !== "acquired") throw new Error("Fence acquisition failed");
      const issued = issueEconomicWriteAdmissionReceipt({
        db,
        sellerId: "plasticov",
        writerKind: "pipeline-finalization",
        ownerRunId: "run-a",
        fence: acquired.fence,
        leaseGeneration: 1,
        now: 1_001,
      });
      expect(issued.status).toBe("issued");
      if (issued.status !== "issued") throw new Error("Receipt issue failed");
      expect(
        validateEconomicWriteAdmissionReceipt({ db, receipt: issued.receipt, now: 1_002 }),
      ).toEqual({
        status: "valid",
      });
      expect(
        consumeEconomicWriteAdmissionReceipt({ db, receipt: issued.receipt, now: 1_003 }),
      ).toEqual({
        status: "consumed",
      });
      expect(
        consumeEconomicWriteAdmissionReceipt({ db, receipt: issued.receipt, now: 1_004 }),
      ).toEqual({
        status: "already-consumed",
      });
      const stored = db
        .prepare("SELECT receipt_token_digest FROM economic_database_write_admission_receipts")
        .get() as { receipt_token_digest: string };
      expect(stored.receipt_token_digest).not.toBe(issued.receipt.token);
    } finally {
      db?.close();
      db = undefined;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("classifies hostile fence ownership and keeps coordination epoch-neutral", () => {
    db = new Database(":memory:");
    createEconomicMigrationPlan().apply(db);
    const epoch = readEconomicDatabaseFence(db, 1).writeEpoch;
    const first = acquireEconomicDatabaseFence({ db, ownerRunId: "run-a", now: 1 });
    expect(first.status).toBe("acquired");
    if (first.status !== "acquired") throw new Error("Fence acquisition failed");
    expect(acquireEconomicDatabaseFence({ db, ownerRunId: "run-b", now: 2 })).toMatchObject({
      status: "held",
    });
    expect(
      renewEconomicDatabaseFence({ db, fence: { ...first.fence, token: "wrong" }, now: 3 }),
    ).toEqual({
      status: "lost",
    });
    expect(
      releaseEconomicDatabaseFence({ db, fence: { ...first.fence, token: "wrong" }, now: 4 }),
    ).toEqual({
      status: "lost",
    });
    expect(renewEconomicDatabaseFence({ db, fence: first.fence, now: 5 })).toMatchObject({
      status: "renewed",
    });
    expect(releaseEconomicDatabaseFence({ db, fence: first.fence, now: 6 })).toEqual({
      status: "released",
    });
    expect(readEconomicDatabaseFence(db, 6).writeEpoch).toBe(epoch);
  });

  it("rejects an issued writer receipt at the deterministic two-worker fence barrier without partial rows or epoch movement", () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-r5-fence-barrier-"));
    const path = join(directory, "economic.sqlite");
    let writer: Database.Database | undefined;
    let contender: Database.Database | undefined;
    try {
      writer = new Database(path);
      createEconomicMigrationPlan().apply(writer);
      const first = acquireEconomicDatabaseFence({
        db: writer,
        ownerRunId: "writer-run",
        now: 1_000,
      });
      expect(first.status).toBe("acquired");
      if (first.status !== "acquired") throw new Error("writer fence acquisition failed");
      const issued = issueEconomicWriteAdmissionReceipt({
        db: writer,
        sellerId: "plasticov",
        writerKind: "pipeline-finalization",
        ownerRunId: "writer-run",
        fence: first.fence,
        leaseGeneration: 1,
        now: 1_001,
      });
      expect(issued.status).toBe("issued");
      if (issued.status !== "issued") throw new Error("writer receipt issue failed");

      // This is the barrier: the receipt exists, then a separate file-backed
      // worker replaces the fence before the writer opens its final transaction.
      contender = new Database(path);
      expect(
        releaseEconomicDatabaseFence({ db: contender, fence: first.fence, now: 1_002 }),
      ).toEqual({
        status: "released",
      });
      const replacement = acquireEconomicDatabaseFence({
        db: contender,
        ownerRunId: "contender-run",
        now: 1_003,
      });
      expect(replacement.status).toBe("acquired");

      const epoch = readEconomicDatabaseFence(writer, 1_004).writeEpoch;
      expect(() => {
        writer!.exec("BEGIN IMMEDIATE");
        try {
          expect(
            validateEconomicWriteAdmissionReceipt({
              db: writer!,
              receipt: issued.receipt,
              now: 1_004,
            }),
          ).toEqual({ status: "lost" });
          throw new Error("writer precommit rejected");
        } catch (error) {
          writer!.exec("ROLLBACK");
          throw error;
        }
      }).toThrow("writer precommit rejected");
      expect(
        writer
          .prepare(
            "SELECT COUNT(*) AS count FROM economic_evidence_references WHERE seller_id = 'plasticov'",
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(readEconomicDatabaseFence(writer, 1_004).writeEpoch).toBe(epoch);
      expect(
        validateEconomicWriteAdmissionReceipt({ db: writer, receipt: issued.receipt, now: 1_004 }),
      ).toEqual({
        status: "lost",
      });
    } finally {
      contender?.close();
      writer?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
