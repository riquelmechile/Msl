import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createCreativeJobQueueStore,
  type CreativeJobQueueStore,
  type CreateCreativeJobInput,
} from "../../src/conversation/creativeJobQueueStore.js";

// ── Helpers ──────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  return new Database(":memory:");
}

const sampleJob: CreateCreativeJobInput = {
  jobId: "cj_test_001",
  requestId: "req_001",
  sellerId: "seller-1",
  kind: "product-cover-i2i",
  channel: "mercadolibre",
  provider: "minimax",
  estimatedCostUsd: 0.15,
  payloadJson: JSON.stringify({ prompt: "test" }),
};

// ── Tests ────────────────────────────────────────────────────────────

describe("CreativeJobQueueStore", () => {
  let db: Database.Database;
  let store: CreativeJobQueueStore;

  beforeEach(() => {
    db = createTestDb();
    store = createCreativeJobQueueStore(db);
  });

  describe("createJob", () => {
    it("inserts a job with queued status", () => {
      const job = store.createJob(sampleJob);

      expect(job.job_id).toBe("cj_test_001");
      expect(job.status).toBe("queued");
      expect(job.kind).toBe("product-cover-i2i");
      expect(job.channel).toBe("mercadolibre");
      expect(job.seller_id).toBe("seller-1");
      expect(job.estimated_cost_usd).toBe(0.15);
      expect(job.created_at).toBeTruthy();
    });

    it("is idempotent — returns existing job on duplicate", () => {
      const first = store.createJob(sampleJob);
      const second = store.createJob(sampleJob);

      expect(second.job_id).toBe(first.job_id);
      expect(second.status).toBe("queued");
    });

    it("uses defaults for optional fields", () => {
      const minimal: CreateCreativeJobInput = {
        jobId: "cj_minimal",
        requestId: "req_min",
        sellerId: "seller-2",
        kind: "product-gallery-i2i",
        channel: "storefront",
      };

      const job = store.createJob(minimal);
      expect(job.provider).toBe("");
      expect(job.estimated_cost_usd).toBe(0);
      expect(job.payload_json).toBe("{}");
    });
  });

  describe("getJob", () => {
    it("returns a job by jobId", () => {
      store.createJob(sampleJob);
      const job = store.getJob("cj_test_001");

      expect(job).toBeDefined();
      expect(job!.job_id).toBe("cj_test_001");
    });

    it("returns undefined for non-existent job", () => {
      const job = store.getJob("cj_nonexistent");
      expect(job).toBeUndefined();
    });
  });

  describe("updateStatus", () => {
    it("transitions queued → running", () => {
      store.createJob(sampleJob);
      const updated = store.updateStatus("cj_test_001", "running");

      expect(updated.status).toBe("running");
      expect(updated.updated_at).toBeTruthy();
    });

    it("transitions running → needs-human-review", () => {
      store.createJob(sampleJob);
      store.updateStatus("cj_test_001", "running");
      const updated = store.updateStatus("cj_test_001", "needs-human-review");

      expect(updated.status).toBe("needs-human-review");
    });

    it("transitions needs-human-review → approved", () => {
      store.createJob(sampleJob);
      store.updateStatus("cj_test_001", "running");
      store.updateStatus("cj_test_001", "needs-human-review");
      const updated = store.updateStatus("cj_test_001", "approved");

      expect(updated.status).toBe("approved");
    });

    it("transitions approved → prepared-for-publish", () => {
      store.createJob(sampleJob);
      store.updateStatus("cj_test_001", "running");
      store.updateStatus("cj_test_001", "needs-human-review");
      store.updateStatus("cj_test_001", "approved");
      const updated = store.updateStatus("cj_test_001", "prepared-for-publish");

      expect(updated.status).toBe("prepared-for-publish");
    });

    it("transitions prepared-for-publish → published", () => {
      store.createJob(sampleJob);
      store.updateStatus("cj_test_001", "running");
      store.updateStatus("cj_test_001", "needs-human-review");
      store.updateStatus("cj_test_001", "approved");
      store.updateStatus("cj_test_001", "prepared-for-publish");
      const updated = store.updateStatus("cj_test_001", "published");

      expect(updated.status).toBe("published");
    });

    it("transitions any status → failed", () => {
      store.createJob(sampleJob);
      const updated = store.updateStatus("cj_test_001", "failed");

      expect(updated.status).toBe("failed");
    });

    it("throws on invalid transition", () => {
      store.createJob(sampleJob);
      // Can't go from queued to approved
      expect(() => store.updateStatus("cj_test_001", "approved")).toThrow("Invalid transition");
    });

    it("throws on transition from terminal status", () => {
      store.createJob(sampleJob);
      // Chain through valid transitions to reach published (terminal)
      store.updateStatus("cj_test_001", "running");
      store.updateStatus("cj_test_001", "needs-human-review");
      store.updateStatus("cj_test_001", "approved");
      store.updateStatus("cj_test_001", "prepared-for-publish");
      store.updateStatus("cj_test_001", "published");

      expect(() => store.updateStatus("cj_test_001", "running")).toThrow(
        "terminal status",
      );
    });

    it("throws on non-existent job", () => {
      expect(() => store.updateStatus("cj_nonexistent", "running")).toThrow(
        "not found",
      );
    });
  });

  describe("completeJob", () => {
    it("completes a job and transitions to needs-human-review", () => {
      store.createJob(sampleJob);
      const completed = store.completeJob("cj_test_001", {
        actualCostUsd: 0.12,
        assetPaths: ["/assets/img1.jpg", "/assets/img2.jpg"],
      });

      expect(completed.status).toBe("needs-human-review");
      expect(completed.actual_cost_usd).toBe(0.12);
    });

    it("stores result JSON", () => {
      store.createJob(sampleJob);
      const completed = store.completeJob("cj_test_001", {
        resultJson: JSON.stringify({ images: ["img1"] }),
      });

      expect(completed.status).toBe("needs-human-review");
    });

    it("throws on non-existent job", () => {
      expect(() =>
        store.completeJob("cj_nonexistent", {}),
      ).toThrow("not found");
    });
  });

  describe("failJob", () => {
    it("fails a job and stores error", () => {
      store.createJob(sampleJob);
      const failed = store.failJob("cj_test_001", JSON.stringify({ message: "API error" }));

      expect(failed.status).toBe("failed");
    });
  });

  describe("listByStatus", () => {
    it("lists jobs by status", () => {
      store.createJob(sampleJob);

      // Create a second job and advance it
      store.createJob({ ...sampleJob, jobId: "cj_test_002" });
      store.updateStatus("cj_test_002", "running");

      const queued = store.listByStatus("queued");
      const running = store.listByStatus("running");

      expect(queued).toHaveLength(1);
      expect(queued[0]!.job_id).toBe("cj_test_001");
      expect(running).toHaveLength(1);
      expect(running[0]!.job_id).toBe("cj_test_002");
    });

    it("returns empty array when no jobs match", () => {
      const results = store.listByStatus("published");
      expect(results).toHaveLength(0);
    });
  });

  describe("listAll", () => {
    it("returns all jobs newest first", () => {
      store.createJob(sampleJob);
      store.createJob({ ...sampleJob, jobId: "cj_test_002" });

      const all = store.listAll();
      expect(all).toHaveLength(2);
    });
  });
});
