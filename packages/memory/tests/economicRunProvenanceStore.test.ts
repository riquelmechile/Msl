import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { createSqliteEconomicEvidenceStore } from "../src/economicEvidenceStore.js";
import { createSqliteEconomicOutcomeStore } from "../src/economicOutcomeStore.js";
import { createEconomicMigrationPlan } from "../src/migrationRegistry.js";

const now = 1_700_000_000_000;

type WorkerMessage =
  | { type: "ready" }
  | { type: "holding" }
  | { type: "attempting-contention" }
  | { type: "contention"; code: string }
  | {
      type: "result";
      evidenceOutcome: "inserted" | "conflict";
      role: "holder" | "contender";
    };

type WorkerSession = {
  worker: Worker;
  messages: WorkerMessage[];
};

const writerWorkerSource = String.raw`
  const Database = require("better-sqlite3");
  const { parentPort, workerData } = require("node:worker_threads");

  function waitFor(command) {
    return new Promise((resolve) => {
      parentPort.once("message", (message) => {
        if (message !== command) throw new Error("Unexpected worker command: " + message);
        resolve();
      });
    });
  }

  function insertRun(db, runId, sellerId) {
    db.prepare(
      "INSERT INTO economic_ingestion_runs (id, seller_id, status, mode, started_at, checkpoint_advanced) VALUES (?, ?, 'persisting', 'manual', ?, 0)",
    ).run(runId, sellerId, 1700000000000);
  }

  function upsertEvidence(db, evidenceId, sellerId, runId) {
    // This is the productive EconomicEvidenceStore upsert SQL. The worker is
    // plain JavaScript because a Node worker cannot import this Vitest-transformed
    // TypeScript module without adding a production loader just for the test.
    const result = db.prepare(
      "INSERT INTO economic_evidence_references (evidence_id, seller_id, source_system, source_entity_type, source_record_id, source_field, observed_at, occurred_at, source_version, checksum, verification, confidence, superseded_by, ingestion_run_id, created_at) VALUES (?, ?, 'mercadolibre', 'order', 'concurrent-safe-order', NULL, 1700000000000, 1700000000000, 'v1', 'concurrent-safe-checksum', 'verified', 1, NULL, ?, 1700000000000) ON CONFLICT(seller_id, source_system, source_entity_type, source_record_id, source_version, checksum) DO NOTHING",
    ).run(evidenceId, sellerId, runId);
    return result.changes === 1 ? "inserted" : "conflict";
  }

  async function main() {
    const db = new Database(workerData.databasePath);
    try {
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 150");
      db.pragma("foreign_keys = ON");
      parentPort.postMessage({ type: "ready" });
      await waitFor("start");

      if (workerData.role === "holder") {
        db.exec("BEGIN IMMEDIATE");
        insertRun(db, workerData.runId, workerData.sellerId);
        const evidenceOutcome = upsertEvidence(
          db,
          workerData.evidenceId,
          workerData.sellerId,
          workerData.runId,
        );
        parentPort.postMessage({ type: "holding" });
        await waitFor("release");
        db.exec("COMMIT");
        parentPort.postMessage({ type: "result", role: "holder", evidenceOutcome });
        return;
      }

      parentPort.postMessage({ type: "attempting-contention" });
      try {
        db.exec("BEGIN IMMEDIATE");
        throw new Error(
          "Expected a bounded SQLITE_BUSY result while the holder owns the writer lock",
        );
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error ? error.code : "UNKNOWN";
        if (code !== "SQLITE_BUSY") throw error;
        parentPort.postMessage({ type: "contention", code });
      }

      await waitFor("retry");
      db.exec("BEGIN IMMEDIATE");
      insertRun(db, workerData.runId, workerData.sellerId);
      upsertEvidence(db, workerData.evidenceId, workerData.sellerId, workerData.runId);
      const evidenceOutcome = upsertEvidence(
        db,
        workerData.conflictingEvidenceId,
        workerData.conflictingSellerId,
        workerData.runId,
      );
      db.exec("COMMIT");
      parentPort.postMessage({ type: "result", role: "contender", evidenceOutcome });
    } finally {
      if (db.inTransaction) db.exec("ROLLBACK");
      db.close();
    }
  }

  main().catch((error) => {
    parentPort.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  });
`;

function createWorkerSession(worker: Worker): WorkerSession {
  const messages: WorkerMessage[] = [];
  worker.on("message", (message: WorkerMessage) => messages.push(message));
  return { worker, messages };
}

async function waitForMessage<T extends WorkerMessage["type"]>(
  session: WorkerSession,
  type: T,
): Promise<Extract<WorkerMessage, { type: T }>> {
  const existing = session.messages.find(
    (message): message is Extract<WorkerMessage, { type: T }> => message.type === type,
  );
  if (existing) return existing;

  return await new Promise<Extract<WorkerMessage, { type: T }>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      session.worker.off("message", onMessage);
      reject(new Error(`Timed out waiting for worker message: ${type}`));
    }, 5_000);
    const onMessage = (message: WorkerMessage) => {
      if (message.type !== type) return;
      clearTimeout(timeout);
      session.worker.off("message", onMessage);
      resolve(message as Extract<WorkerMessage, { type: T }>);
    };
    session.worker.on("message", onMessage);
  });
}

function component(sellerId: string, ingestionRunId: string, sourceVersion = "v1") {
  return {
    sellerId,
    ingestionRunId,
    type: "refund" as const,
    amount: { amountMinor: 1200, currency: "CLP" as const },
    source: "mercadolibre" as const,
    sourceRecordId: "order-safe-1",
    economicMeaning: "refund",
    sourceVersion,
    occurredAt: now,
    observedAt: now,
    verification: "verified" as const,
    confidence: 1,
  };
}

function snapshot(sellerId: string, ingestionRunId: string) {
  return {
    snapshotId: `snapshot-${sellerId}-${ingestionRunId}`,
    sellerId,
    ingestionRunId,
    orderId: "order-safe-1",
    itemId: "item-safe-1",
    currency: "CLP" as const,
    sourceVersion: "v1",
    economicAlgorithmVersion: "economic-v1",
    economicChecksum: "checksum-safe-1",
    calculatedAt: now,
  } as never;
}

function evidence(sellerId: string, ingestionRunId: string, sourceVersion = "v1") {
  return {
    evidenceId: `evidence-${sellerId}-${ingestionRunId}-${sourceVersion}`,
    sellerId,
    ingestionRunId,
    sourceSystem: "mercadolibre",
    sourceEntityType: "order",
    sourceRecordId: "order-safe-1",
    observedAt: now,
    occurredAt: now,
    sourceVersion,
    checksum: `checksum-safe-${sourceVersion}`,
    verification: "verified" as const,
    confidence: 1,
  };
}

describe("economic run provenance stores", () => {
  let db: Database.Database | undefined;

  afterEach(() => db?.close());

  it("persists seller/run provenance and isolates run reads and aggregate counts", () => {
    db = new Database(":memory:");
    createEconomicMigrationPlan().apply(db);
    const outcomes = createSqliteEconomicOutcomeStore(db);
    const evidenceStore = createSqliteEconomicEvidenceStore(db);

    outcomes.insertCostComponent(component("seller-a", "run-a"));
    outcomes.insertCostComponent(component("seller-b", "run-a"));
    outcomes.insertUnitEconomicsSnapshot(snapshot("seller-a", "run-a"));
    outcomes.insertUnitEconomicsSnapshot(snapshot("seller-b", "run-a"));
    evidenceStore.upsertEvidence(evidence("seller-a", "run-a"));
    evidenceStore.upsertEvidence(evidence("seller-b", "run-a"));

    expect(outcomes.listComponentsByRun("seller-a", "run-a")).toHaveLength(1);
    expect(outcomes.countComponentsByRun("seller-a", "run-a")).toBe(1);
    expect(outcomes.listSnapshotsByRun("seller-a", "run-a")).toHaveLength(1);
    expect(outcomes.countSnapshotsByRun("seller-a", "run-a")).toBe(1);
    expect(outcomes.countSellerAggregates("seller-a")).toEqual({ components: 1, snapshots: 1 });
    expect(evidenceStore.listByRun("seller-a", "run-a")).toHaveLength(1);
    expect(evidenceStore.countByRun("seller-a", "run-a")).toBe(1);
  });

  it("keeps canonical provenance on duplicate/restart, retains refund versions, and is safe for sequential duplicate contenders", () => {
    db = new Database(":memory:");
    createEconomicMigrationPlan().apply(db);
    const outcomes = createSqliteEconomicOutcomeStore(db);
    const evidenceStore = createSqliteEconomicEvidenceStore(db);

    const firstComponent = outcomes.insertCostComponent(component("seller-a", "run-first"));
    const duplicateComponent = outcomes.insertCostComponent(component("seller-a", "run-restart"));
    expect(duplicateComponent.id).toBe(firstComponent.id);
    expect(outcomes.listComponentsByRun("seller-a", "run-first")).toHaveLength(1);
    expect(outcomes.listComponentsByRun("seller-a", "run-restart")).toHaveLength(0);

    outcomes.insertCostComponent(component("seller-a", "run-refund-v2", "v2"));
    expect(outcomes.listBySourceRecord("seller-a", "order-safe-1")).toHaveLength(2);

    const firstSnapshot = outcomes.insertUnitEconomicsSnapshot(snapshot("seller-a", "run-first"));
    const duplicateSnapshot = outcomes.insertUnitEconomicsSnapshot(
      snapshot("seller-a", "run-restart"),
    );
    expect(duplicateSnapshot.snapshotId).toBe(firstSnapshot.snapshotId);
    expect(outcomes.countSnapshotsByRun("seller-a", "run-first")).toBe(1);
    expect(outcomes.countSnapshotsByRun("seller-a", "run-restart")).toBe(0);

    expect(evidenceStore.upsertEvidence(evidence("seller-a", "run-first"))).toBeNull();
    const duplicateEvidence = evidenceStore.upsertEvidence(evidence("seller-a", "run-restart"));
    expect(duplicateEvidence?.ingestionRunId).toBe("run-first");
    expect(evidenceStore.upsertEvidence(evidence("seller-a", "run-refund-v2", "v2"))).toBeNull();
    expect(evidenceStore.countByRun("seller-a", "run-first")).toBe(1);
    expect(evidenceStore.countByRun("seller-a", "run-restart")).toBe(0);
    expect(evidenceStore.listBySourceRecord("order-safe-1", "seller-a")).toHaveLength(2);
  });

  it("proves real SQLite writer contention and seller-isolated evidence idempotency", async () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-economic-provenance-"));
    const databasePath = join(directory, "economic.sqlite");
    let holder: WorkerSession | undefined;
    let contender: WorkerSession | undefined;
    let verificationDb: Database.Database | undefined;
    let reopenedDb: Database.Database | undefined;

    try {
      db = new Database(databasePath);
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 150");
      db.pragma("foreign_keys = ON");
      createEconomicMigrationPlan().apply(db);
      db.close();
      db = undefined;

      holder = createWorkerSession(
        new Worker(writerWorkerSource, {
          eval: true,
          workerData: {
            role: "holder",
            databasePath,
            sellerId: "seller-concurrent-a",
            runId: "run-concurrent-a",
            evidenceId: "evidence-concurrent-a",
          },
        }),
      );
      contender = createWorkerSession(
        new Worker(writerWorkerSource, {
          eval: true,
          workerData: {
            role: "contender",
            databasePath,
            sellerId: "seller-concurrent-b",
            runId: "run-concurrent-b",
            evidenceId: "evidence-concurrent-b",
            conflictingSellerId: "seller-concurrent-a",
            conflictingEvidenceId: "evidence-concurrent-conflict",
          },
        }),
      );

      await Promise.all([waitForMessage(holder, "ready"), waitForMessage(contender, "ready")]);
      holder.worker.postMessage("start");
      await waitForMessage(holder, "holding");
      contender.worker.postMessage("start");
      await waitForMessage(contender, "attempting-contention");
      expect(await waitForMessage(contender, "contention")).toEqual({
        type: "contention",
        code: "SQLITE_BUSY",
      });

      holder.worker.postMessage("release");
      expect(await waitForMessage(holder, "result")).toMatchObject({
        role: "holder",
        evidenceOutcome: "inserted",
      });
      contender.worker.postMessage("retry");
      expect(await waitForMessage(contender, "result")).toMatchObject({
        role: "contender",
        evidenceOutcome: "conflict",
      });

      verificationDb = new Database(databasePath);
      verificationDb.pragma("foreign_keys = ON");
      expect(verificationDb.prepare("PRAGMA quick_check").get()).toEqual({
        quick_check: "ok",
      });
      expect(
        verificationDb
          .prepare("SELECT seller_id, id FROM economic_ingestion_runs ORDER BY seller_id")
          .all(),
      ).toEqual([
        { seller_id: "seller-concurrent-a", id: "run-concurrent-a" },
        { seller_id: "seller-concurrent-b", id: "run-concurrent-b" },
      ]);
      expect(
        verificationDb
          .prepare("SELECT ingestion_run_id FROM economic_evidence_references WHERE seller_id = ?")
          .all("seller-concurrent-a"),
      ).toEqual([{ ingestion_run_id: "run-concurrent-a" }]);
      expect(
        verificationDb
          .prepare("SELECT ingestion_run_id FROM economic_evidence_references WHERE seller_id = ?")
          .all("seller-concurrent-b"),
      ).toEqual([{ ingestion_run_id: "run-concurrent-b" }]);
      expect(
        verificationDb
          .prepare(
            "SELECT COUNT(*) AS count FROM economic_evidence_references WHERE seller_id = ? AND source_record_id = 'concurrent-safe-order'",
          )
          .get("seller-concurrent-a"),
      ).toEqual({ count: 1 });
      expect(
        verificationDb.prepare("PRAGMA index_list('economic_evidence_references')").all(),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "idx_evidence_composite_unique", unique: 1 }),
        ]),
      );
      expect(verificationDb.inTransaction).toBe(false);
      verificationDb.close();
      verificationDb = undefined;

      reopenedDb = new Database(databasePath);
      expect(reopenedDb.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
      expect(reopenedDb.inTransaction).toBe(false);
    } finally {
      reopenedDb?.close();
      verificationDb?.close();
      db?.close();
      await Promise.all([holder?.worker.terminate(), contender?.worker.terminate()]);
      rmSync(directory, { recursive: true, force: true });
      expect(existsSync(directory)).toBe(false);
    }
  });
});
