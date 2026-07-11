import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSqliteEconomicIngestionRunStore } from "../src/economicIngestionRunStore.js";
import type { EconomicIngestionRunStore } from "../src/economicIngestionRunStore.js";

function setup(): { db: Database.Database; store: EconomicIngestionRunStore } {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const store = createSqliteEconomicIngestionRunStore(db);
  return { db, store };
}

describe("EconomicIngestionRunStore", () => {
  let db: Database.Database;
  let store: EconomicIngestionRunStore;

  beforeEach(() => {
    const s = setup();
    db = s.db;
    store = s.store;
  });

  afterEach(() => {
    db.close();
  });

  describe("CRUD operations", () => {
    it("creates a run and retrieves it by ID", async () => {
      const run = await store.createRun({
        runId: "run-001",
        sellerId: "plasticov",
        mode: "incremental",
        status: "pending",
        startedAt: 1700000000000,
      });

      expect(run.runId).toBe("run-001");
      expect(run.sellerId).toBe("plasticov");
      expect(run.mode).toBe("incremental");
      expect(run.status).toBe("pending");

      const retrieved = await store.getRun("run-001");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.runId).toBe("run-001");
    });

    it("updates a run status and result", async () => {
      await store.createRun({
        runId: "run-002",
        sellerId: "plasticov",
        mode: "backfill",
        status: "fetching",
        startedAt: 1700000000000,
      });

      const updated = await store.updateRun("run-002", {
        status: "completed",
        completedAt: 1700000005000,
        result: { snapshotsCreated: 42 },
      });

      expect(updated.status).toBe("completed");
      expect(updated.completedAt).toBe(1700000005000);

      const retrieved = await store.getRun("run-002");
      expect(retrieved!.status).toBe("completed");
    });

    it("returns null for non-existent run", async () => {
      const retrieved = await store.getRun("nonexistent");
      expect(retrieved).toBeNull();
    });

    it("throws for update on non-existent run", async () => {
      await expect(
        store.updateRun("nonexistent", { status: "completed" }),
      ).rejects.toThrow("Ingestion run not found");
    });

    it("getLastRunBySeller returns most recent run", async () => {
      await store.createRun({
        runId: "run-old",
        sellerId: "plasticov",
        mode: "incremental",
        status: "completed",
        startedAt: 1700000000000,
      });

      // Small pause to ensure different created_at timestamps
      await new Promise((r) => setTimeout(r, 10));

      await store.createRun({
        runId: "run-new",
        sellerId: "plasticov",
        mode: "backfill",
        status: "fetching",
        startedAt: 1700000001000,
      });

      const last = await store.getLastRunBySeller("plasticov");
      expect(last).not.toBeNull();
      expect(last!.runId).toBe("run-new");
    });

    it("getLastRunBySeller returns null for seller with no runs", async () => {
      const last = await store.getLastRunBySeller("unknown-seller");
      expect(last).toBeNull();
    });

    it("listRunsBySeller returns runs in descending order", async () => {
      await store.createRun({
        runId: "run-a",
        sellerId: "plasticov",
        mode: "incremental",
        status: "completed",
        startedAt: 1700000000000,
      });

      // Ensure distinct created_at timestamps for deterministic ordering
      await new Promise((r) => setTimeout(r, 15));

      await store.createRun({
        runId: "run-b",
        sellerId: "plasticov",
        mode: "backfill",
        status: "fetching",
        startedAt: 1700000001000,
      });

      await new Promise((r) => setTimeout(r, 15));

      await store.createRun({
        runId: "run-c",
        sellerId: "plasticov",
        mode: "repair",
        status: "failed",
        startedAt: 1700000002000,
      });

      const runs = await store.listRunsBySeller("plasticov", 10);
      expect(runs).toHaveLength(3);
      expect(runs[0]!.runId).toBe("run-c");
      expect(runs[1]!.runId).toBe("run-b");
      expect(runs[2]!.runId).toBe("run-a");
    });

    it("listRunsBySeller respects limit", async () => {
      await store.createRun({
        runId: "run-1",
        sellerId: "plasticov",
        mode: "incremental",
        status: "completed",
        startedAt: 1700000000000,
      });
      await new Promise((r) => setTimeout(r, 10));
      await store.createRun({
        runId: "run-2",
        sellerId: "plasticov",
        mode: "incremental",
        status: "completed",
        startedAt: 1700000000000,
      });

      const runs = await store.listRunsBySeller("plasticov", 1);
      expect(runs).toHaveLength(1);
    });
  });

  describe("seller isolation", () => {
    it("isolates runs between sellers", async () => {
      await store.createRun({
        runId: "plasticov-run",
        sellerId: "plasticov",
        mode: "incremental",
        status: "completed",
        startedAt: 1700000000000,
      });

      await store.createRun({
        runId: "maustian-run",
        sellerId: "maustian",
        mode: "incremental",
        status: "completed",
        startedAt: 1700000000000,
      });

      const plasticovRuns = await store.listRunsBySeller("plasticov");
      expect(plasticovRuns).toHaveLength(1);
      expect(plasticovRuns[0]!.runId).toBe("plasticov-run");

      const maustianRuns = await store.listRunsBySeller("maustian");
      expect(maustianRuns).toHaveLength(1);
      expect(maustianRuns[0]!.runId).toBe("maustian-run");
    });

    it("getLastRunBySeller is isolated per seller", async () => {
      await store.createRun({
        runId: "plasticov-last",
        sellerId: "plasticov",
        mode: "incremental",
        status: "completed",
        startedAt: 1700000000000,
      });

      const maustianLast = await store.getLastRunBySeller("maustian");
      expect(maustianLast).toBeNull();
    });

    it("checkpoint is isolated per seller", async () => {
      await store.updateCheckpoint("plasticov", {
        lastOrderDate: "2025-01-15",
        lastOrderId: "ord-123",
      });

      await store.updateCheckpoint("maustian", {
        lastOrderDate: "2025-02-20",
        lastOrderId: "ord-456",
      });

      const plasticovCheckpoint = await store.getCheckpoint("plasticov");
      expect(plasticovCheckpoint).not.toBeNull();
      expect(plasticovCheckpoint!.lastOrderDate).toBe("2025-01-15");

      const maustianCheckpoint = await store.getCheckpoint("maustian");
      expect(maustianCheckpoint).not.toBeNull();
      expect(maustianCheckpoint!.lastOrderDate).toBe("2025-02-20");
    });
  });

  describe("active run", () => {
    it("returns active run when one exists", async () => {
      await store.createRun({
        runId: "active-run",
        sellerId: "plasticov",
        mode: "incremental",
        status: "persisting",
        startedAt: 1700000000000,
      });

      const active = await store.getActiveRun("plasticov");
      expect(active).not.toBeNull();
      expect(active!.runId).toBe("active-run");
      expect(active!.status).toBe("persisting");
    });

    it("returns null when no active run exists", async () => {
      await store.createRun({
        runId: "completed-run",
        sellerId: "plasticov",
        mode: "incremental",
        status: "completed",
        startedAt: 1700000000000,
      });

      const active = await store.getActiveRun("plasticov");
      expect(active).toBeNull();
    });
  });

  describe("abandoned run recovery", () => {
    it("marks abandoned running runs as failed", async () => {
      await store.createRun({
        runId: "abandoned-run",
        sellerId: "plasticov",
        mode: "incremental",
        status: "persisting",
        startedAt: 1700000000000,
      });

      await store.recoverAbandonedRun("plasticov");

      const recovered = await store.getRun("abandoned-run");
      expect(recovered).not.toBeNull();
      expect(recovered!.status).toBe("failed");
    });

    it("does not affect completed runs", async () => {
      await store.createRun({
        runId: "good-run",
        sellerId: "plasticov",
        mode: "incremental",
        status: "completed",
        startedAt: 1700000000000,
      });

      await store.recoverAbandonedRun("plasticov");

      const run = await store.getRun("good-run");
      expect(run!.status).toBe("completed");
    });

    it("is isolated per seller", async () => {
      await store.createRun({
        runId: "plasticov-abandoned",
        sellerId: "plasticov",
        mode: "incremental",
        status: "persisting",
        startedAt: 1700000000000,
      });

      await store.createRun({
        runId: "maustian-running",
        sellerId: "maustian",
        mode: "incremental",
        status: "persisting",
        startedAt: 1700000000000,
      });

      await store.recoverAbandonedRun("plasticov");

      const plasticovRun = await store.getRun("plasticov-abandoned");
      expect(plasticovRun!.status).toBe("failed");

      const maustianRun = await store.getRun("maustian-running");
      expect(maustianRun!.status).toBe("persisting");
    });
  });

  describe("checkpoint", () => {
    it("creates and retrieves checkpoint", async () => {
      await store.updateCheckpoint("plasticov", {
        lastOrderDate: "2025-06-01",
        lastOrderId: "ord-789",
        lastRunId: "run-check-1",
      });

      const checkpoint = await store.getCheckpoint("plasticov");
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.lastOrderDate).toBe("2025-06-01");
      expect(checkpoint!.lastOrderId).toBe("ord-789");
      expect(checkpoint!.lastRunId).toBe("run-check-1");
      expect(checkpoint!.updatedAt).toBeDefined();
    });

    it("upserts checkpoint (idempotent)", async () => {
      await store.updateCheckpoint("plasticov", {
        lastOrderDate: "2025-06-01",
        lastRunId: "run-1",
      });

      await store.updateCheckpoint("plasticov", {
        lastOrderDate: "2025-06-15",
        lastOrderId: "ord-999",
      });

      const checkpoint = await store.getCheckpoint("plasticov");
      expect(checkpoint!.lastOrderDate).toBe("2025-06-15");
      expect(checkpoint!.lastOrderId).toBe("ord-999");
      expect(checkpoint!.lastRunId).toBe("run-1"); // preserved from first upsert
    });

    it("returns null for seller with no checkpoint", async () => {
      const checkpoint = await store.getCheckpoint("unknown-seller");
      expect(checkpoint).toBeNull();
    });
  });

  describe("error sanitization", () => {
    it("strips stack traces with file paths", async () => {
      const run = await store.createRun({
        runId: "error-run",
        sellerId: "plasticov",
        mode: "incremental",
        status: "failed",
        error:
          "Something broke\n    at Object.handler (/home/user/src/file.ts:42:10)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
      });

      // Error should not contain file paths
      const retrieved = await store.getRun("error-run");
      expect(retrieved).not.toBeNull();
      // The run reconstruction doesn't include error messages by default
      // but the persisted row should not contain file paths
      const row = db
        .prepare("SELECT error FROM economic_ingestion_runs WHERE id = ?")
        .get("error-run") as { error: string | null } | undefined;
      if (row?.error) {
        expect(row.error).not.toContain("/home/user/src/");
        expect(row.error).not.toContain("file.ts");
      }
    });
  });

  describe("idempotency", () => {
    it("creating a run with same ID throws on PK conflict", async () => {
      await store.createRun({
        runId: "idem-run",
        sellerId: "plasticov",
        mode: "incremental",
        status: "pending",
        startedAt: 1700000000000,
      });

      await expect(
        store.createRun({
          runId: "idem-run",
          sellerId: "plasticov",
          mode: "incremental",
          status: "pending",
          startedAt: 1700000000000,
        }),
      ).rejects.toThrow();
    });
  });
});
