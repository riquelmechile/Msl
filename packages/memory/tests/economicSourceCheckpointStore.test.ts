import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { tmpdir } from "node:os";
import { createEconomicMigrationPlan } from "../src/migrationRegistry.js";
import { createSqliteEconomicIngestionRunStore } from "../src/economicIngestionRunStore.js";

type Opened = { db: Database.Database; directory: string };
const opened: Opened[] = [];

function openFile(name: string): Opened {
  const directory = mkdtempSync(join(tmpdir(), `msl-r3-${name}-`));
  const db = new Database(join(directory, "economic.sqlite"));
  createEconomicMigrationPlan().apply(db);
  const resource = { db, directory };
  opened.push(resource);
  return resource;
}

afterEach(() => {
  while (opened.length > 0) {
    const resource = opened.pop();
    if (!resource) continue;
    resource.db.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

const fence = { generation: 1, tokenDigest: "checkpoint-writer" } as const;
const initial = { version: 0, occurredAt: null, sourceRecordId: null } as const;

type RaceMessage =
  | { type: "ready" }
  | { type: "at-barrier" }
  | { type: "result"; outcome: "advanced" | "concurrent" }
  | { type: "error"; message: string };

const initialInsertWorker = String.raw`
  const Database = require("better-sqlite3");
  const { parentPort, workerData } = require("node:worker_threads");
  const barrier = new Int32Array(workerData.barrier);
  parentPort.postMessage({ type: "ready" });
  parentPort.once("message", (command) => {
    if (command !== "start") throw new Error("Unexpected command");
    Atomics.add(barrier, 0, 1);
    parentPort.postMessage({ type: "at-barrier" });
    Atomics.wait(barrier, 1, 0);
    const db = new Database(workerData.databasePath);
    try {
      db.pragma("busy_timeout = 1000");
      const result = db.prepare(
        "INSERT OR IGNORE INTO economic_source_checkpoints (seller_id, source, occurred_at, source_record_id, version, last_run_id, updated_at) VALUES ('plasticov', 'orders', ?, ?, 1, ?, 1)",
      ).run(workerData.occurredAt, workerData.sourceRecordId, workerData.runId);
      parentPort.postMessage({ type: "result", outcome: result.changes === 1 ? "advanced" : "concurrent" });
    } catch (error) {
      parentPort.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      db.close();
    }
  });
`;

function waitForWorkerMessage<T extends RaceMessage["type"]>(
  worker: Worker,
  type: T,
): Promise<Extract<RaceMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 5_000);
    worker.on("message", (message: RaceMessage) => {
      if (message.type === "error") {
        clearTimeout(timeout);
        reject(new Error(message.message));
      } else if (message.type === type) {
        clearTimeout(timeout);
        resolve(message as Extract<RaceMessage, { type: T }>);
      }
    });
  });
}

describe("R3 source checkpoint CAS", () => {
  it("applies 1007/1008 on fresh, recorded-1006 upgrade, and rerun", () => {
    const { db } = openFile("migration");
    expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 0, skipped: 11 });
    expect(
      db
        .prepare("SELECT COUNT(*) AS count FROM schema_version WHERE version IN (1007, 1008)")
        .get(),
    ).toEqual({ count: 2 });
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'economic_source_checkpoints'").get(),
    ).toEqual({ name: "economic_source_checkpoints" });
  });

  it("upgrades a recorded 1006 database through the registered 1007–1011 plan", () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-r3-upgrade-"));
    const db = new Database(join(directory, "economic.sqlite"));
    opened.push({ db, directory });
    try {
      db.exec("CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT)");
      for (let version = 1001; version <= 1006; version++) {
        db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, 'now')").run(
          version,
        );
      }

      expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 5, skipped: 6 });
      expect(
        db
          .prepare("SELECT version FROM schema_version WHERE version >= 1007 ORDER BY version")
          .all(),
      ).toEqual([
        { version: 1007 },
        { version: 1008 },
        { version: 1009 },
        { version: 1010 },
        { version: 1011 },
      ]);
      expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 0, skipped: 11 });
    } finally {
      // The shared afterEach owns cleanup; close here only to prove no handles leak.
      db.close();
    }
  });

  it("advances once, then classifies equal, stale, and seller/source-isolated writes", async () => {
    const { db } = openFile("cas");
    const store = createSqliteEconomicIngestionRunStore(db);
    const advance = (source: "orders" | "claims" | "product-ads", sellerId = "plasticov") =>
      store.advanceSourceCheckpoint!({
        sellerId,
        source,
        occurredAt: 10,
        sourceRecordId: "order-a",
        runId: "run-a",
        expected: initial,
        fence,
      });
    await expect(advance("orders")).resolves.toMatchObject({ status: "advanced" });
    await expect(advance("orders")).resolves.toMatchObject({ status: "already-applied" });
    await expect(
      store.advanceSourceCheckpoint!({
        sellerId: "plasticov",
        source: "orders",
        occurredAt: 9,
        sourceRecordId: "order-z",
        runId: "stale",
        expected: initial,
        fence,
      }),
    ).resolves.toMatchObject({ status: "stale" });
    await expect(advance("claims")).resolves.toMatchObject({ status: "advanced" });
    await expect(advance("orders", "maustian")).resolves.toMatchObject({ status: "advanced" });
  });

  it("uses strict expected tuple CAS across independent connections and rejects a changed fence", async () => {
    const first = openFile("connections");
    const second = new Database(join(first.directory, "economic.sqlite"));
    try {
      const left = createSqliteEconomicIngestionRunStore(first.db);
      const right = createSqliteEconomicIngestionRunStore(second);
      await left.advanceSourceCheckpoint!({
        sellerId: "plasticov",
        source: "orders",
        occurredAt: 10,
        sourceRecordId: "a",
        runId: "left",
        expected: initial,
        fence,
      });
      await expect(
        right.advanceSourceCheckpoint!({
          sellerId: "plasticov",
          source: "orders",
          occurredAt: 11,
          sourceRecordId: "b",
          runId: "right",
          expected: initial,
          fence,
        }),
      ).resolves.toMatchObject({ status: "concurrent" });
      await expect(
        left.advanceSourceCheckpoint!({
          sellerId: "plasticov",
          source: "orders",
          occurredAt: 12,
          sourceRecordId: "c",
          runId: "blocked",
          expected: { version: 1, occurredAt: 10, sourceRecordId: "a" },
          fence: { generation: 2, tokenDigest: "checkpoint-writer" },
        }),
      ).rejects.toThrow("fence rejected");
    } finally {
      second.close();
    }
  });

  it("classifies an insert race without falsely advancing the losing writer", async () => {
    const { db } = openFile("insert-race");
    const store = createSqliteEconomicIngestionRunStore(db);
    db.exec(`
      CREATE TRIGGER source_checkpoint_insert_race
      BEFORE INSERT ON economic_source_checkpoints
      WHEN NEW.seller_id = 'plasticov' AND NEW.source = 'orders'
      BEGIN
        INSERT OR IGNORE INTO economic_source_checkpoints
          (seller_id, source, occurred_at, source_record_id, version, last_run_id, updated_at)
        VALUES ('plasticov', 'orders', 11, 'winning-order', 1, 'winner', 1);
        SELECT RAISE(IGNORE);
      END;
    `);

    await expect(
      store.advanceSourceCheckpoint!({
        sellerId: "plasticov",
        source: "orders",
        occurredAt: 12,
        sourceRecordId: "losing-order",
        runId: "loser",
        expected: initial,
        fence,
      }),
    ).resolves.toMatchObject({ status: "concurrent" });
    await expect(store.getSourceCheckpoint!("plasticov", "orders")).resolves.toMatchObject({
      occurredAt: 11,
      sourceRecordId: "winning-order",
      lastRunId: "winner",
    });
  });

  it("has exactly one initial CAS winner across two worker connections released by one barrier", async () => {
    const first = openFile("worker-insert-race");
    const databasePath = join(first.directory, "economic.sqlite");
    const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const workers = [
      new Worker(initialInsertWorker, {
        eval: true,
        workerData: {
          barrier,
          databasePath,
          occurredAt: 10,
          sourceRecordId: "left",
          runId: "left-run",
        },
      }),
      new Worker(initialInsertWorker, {
        eval: true,
        workerData: {
          barrier,
          databasePath,
          occurredAt: 11,
          sourceRecordId: "right",
          runId: "right-run",
        },
      }),
    ];

    try {
      await Promise.all(workers.map((worker) => waitForWorkerMessage(worker, "ready")));
      const barriers = workers.map((worker) => waitForWorkerMessage(worker, "at-barrier"));
      workers.forEach((worker) => worker.postMessage("start"));
      await Promise.all(barriers);
      expect(Atomics.load(new Int32Array(barrier), 0)).toBe(2);
      Atomics.store(new Int32Array(barrier), 1, 1);
      Atomics.notify(new Int32Array(barrier), 1, 2);

      const outcomes = await Promise.all(
        workers.map((worker) => waitForWorkerMessage(worker, "result")),
      );
      expect(outcomes.map(({ outcome }) => outcome).sort()).toEqual(["advanced", "concurrent"]);
      expect(
        first.db
          .prepare(
            "SELECT occurred_at, source_record_id, version, last_run_id FROM economic_source_checkpoints WHERE seller_id = 'plasticov' AND source = 'orders'",
          )
          .get(),
      ).toMatchObject({ version: 1 });
      expect(first.db.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
    }
  });

  it("returns retry-exhausted after three real SQLite update conflicts", async () => {
    const { db } = openFile("retry-exhausted");
    const store = createSqliteEconomicIngestionRunStore(db);
    await store.advanceSourceCheckpoint!({
      sellerId: "plasticov",
      source: "orders",
      occurredAt: 10,
      sourceRecordId: "before",
      runId: "seed",
      expected: initial,
      fence,
    });
    db.exec(`
      CREATE TRIGGER source_checkpoint_update_conflict
      BEFORE UPDATE ON economic_source_checkpoints
      WHEN NEW.seller_id = 'plasticov' AND NEW.source = 'orders'
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    await expect(
      store.advanceSourceCheckpoint!({
        sellerId: "plasticov",
        source: "orders",
        occurredAt: 11,
        sourceRecordId: "after",
        runId: "retrying",
        expected: { version: 1, occurredAt: 10, sourceRecordId: "before" },
        fence,
        retryDelayMs: 0,
      }),
    ).resolves.toEqual({ status: "retry-exhausted" });
    await expect(store.getSourceCheckpoint!("plasticov", "orders")).resolves.toMatchObject({
      occurredAt: 10,
      sourceRecordId: "before",
      version: 1,
    });
  });
});
