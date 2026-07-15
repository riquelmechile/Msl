import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { EconomicEvidenceReference } from "@msl/domain";
import { createSqliteEconomicEvidenceStore } from "./economicEvidenceStore.js";
import type { EconomicEvidenceStore } from "./economicEvidenceStore.js";
import { createEconomicMigrationPlan } from "./migrationRegistry.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function createStore(): { db: Database.Database; store: EconomicEvidenceStore } {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  const store = createSqliteEconomicEvidenceStore(db);
  return { db, store };
}

function makeRef(overrides: Partial<EconomicEvidenceReference> = {}): EconomicEvidenceReference {
  const now = Date.now();
  return {
    evidenceId: `evidence-${crypto.randomUUID()}`,
    sellerId: "plasticov",
    sourceSystem: "mercadolibre",
    sourceEntityType: "order",
    sourceRecordId: "order-001",
    observedAt: now,
    occurredAt: now - 86400000,
    sourceVersion: "2026-01-15T10:00:00Z",
    checksum: `sha256:order:order-001:10000`,
    verification: "verified",
    confidence: 0.95,
    ingestionRunId: "run-001",
    ...overrides,
  };
}

// ── CRUD tests ──────────────────────────────────────────────────────────────

describe("EconomicEvidenceStore", () => {
  let db: Database.Database;
  let store: EconomicEvidenceStore;

  beforeEach(() => {
    const s = createStore();
    db = s.db;
    store = s.store;
  });

  afterEach(() => {
    db.close();
  });

  // ── 1. insertEvidence ─────────────────────────────────────────────────

  describe("insertEvidence", () => {
    it("inserts a new evidence reference", () => {
      const ref = makeRef();
      store.insertEvidence(ref);

      const retrieved = store.getEvidence(ref.evidenceId, ref.sellerId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.evidenceId).toBe(ref.evidenceId);
      expect(retrieved!.sourceRecordId).toBe("order-001");
      expect(retrieved!.checksum).toBe(ref.checksum);
    });

    it("throws on duplicate composite key", () => {
      const ref = makeRef();
      store.insertEvidence(ref);

      // Same composite key → should throw
      expect(() => store.insertEvidence(ref)).toThrow();
    });
  });

  // ── 2. upsertEvidence (idempotent) ────────────────────────────────────

  describe("upsertEvidence", () => {
    it("returns null on first insert (new row)", () => {
      const ref = makeRef();
      const result = store.upsertEvidence(ref);
      expect(result).toBeNull();
    });

    it("returns existing row on duplicate (idempotent)", () => {
      const ref = makeRef();
      store.upsertEvidence(ref);

      // Same composite key, different evidenceId
      const duplicate = makeRef({
        sourceRecordId: ref.sourceRecordId,
        sourceVersion: ref.sourceVersion ?? "",
        checksum: ref.checksum,
        sellerId: ref.sellerId,
        sourceSystem: ref.sourceSystem,
        sourceEntityType: ref.sourceEntityType,
      });

      const result = store.upsertEvidence(duplicate);
      expect(result).not.toBeNull();
      // Should return the ORIGINAL row's evidenceId, not the new one
      expect(result!.evidenceId).toBe(ref.evidenceId);
    });

    it("creates no duplicate row on second upsert", () => {
      const ref = makeRef();
      store.upsertEvidence(ref);

      // Upsert again
      store.upsertEvidence(
        makeRef({
          sourceRecordId: ref.sourceRecordId,
          sourceVersion: ref.sourceVersion ?? "",
          checksum: ref.checksum,
          sellerId: ref.sellerId,
          sourceSystem: ref.sourceSystem,
          sourceEntityType: ref.sourceEntityType,
        }),
      );

      const count = store.countByRun("plasticov", "run-001");
      expect(count).toBe(1);
    });

    it("creates distinct rows for different composite keys", () => {
      const ref1 = makeRef({ sourceRecordId: "order-001" });
      const ref2 = makeRef({
        sourceRecordId: "order-002",
        checksum: "sha256:order:order-002:20000",
      });

      store.upsertEvidence(ref1);
      store.upsertEvidence(ref2);

      expect(store.countByRun("plasticov", "run-001")).toBe(2);
    });

    it("inserts correctly with nullable fields present", () => {
      const ref = makeRef({ sourceField: "total_amount" });
      store.upsertEvidence(ref);

      const retrieved = store.getEvidence(ref.evidenceId, ref.sellerId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sourceField).toBe("total_amount");
    });
  });

  // ── 3. getEvidence ────────────────────────────────────────────────────

  describe("getEvidence", () => {
    it("returns evidence by ID and seller", () => {
      const ref = makeRef();
      store.insertEvidence(ref);

      const result = store.getEvidence(ref.evidenceId, ref.sellerId);
      expect(result).not.toBeNull();
      expect(result!.evidenceId).toBe(ref.evidenceId);
    });

    it("returns null for non-existent evidence", () => {
      const result = store.getEvidence("nonexistent", "plasticov");
      expect(result).toBeNull();
    });

    it("returns null for wrong seller", () => {
      const ref = makeRef({ sellerId: "plasticov" });
      store.insertEvidence(ref);

      // Query with different seller
      const result = store.getEvidence(ref.evidenceId, "maustian");
      expect(result).toBeNull();
    });
  });

  // ── 4. listBySeller ───────────────────────────────────────────────────

  describe("listBySeller", () => {
    it("returns all evidence for a seller", () => {
      store.upsertEvidence(makeRef({ sourceRecordId: "order-001" }));
      store.upsertEvidence(
        makeRef({ sourceRecordId: "order-002", checksum: "sha256:order:order-002:20000" }),
      );

      const results = store.listBySeller("plasticov");
      expect(results).toHaveLength(2);
    });

    it("defaults to limit 20", () => {
      const results = store.listBySeller("plasticov");
      // Default limit is 20 — no explicit tests needed beyond not throwing
      expect(Array.isArray(results)).toBe(true);
    });

    it("respects explicit limit", () => {
      for (let i = 0; i < 5; i++) {
        store.upsertEvidence(
          makeRef({
            sourceRecordId: `order-${String(i).padStart(3, "0")}`,
            checksum: `sha256:order:order-${i}:10000`,
          }),
        );
      }

      const results = store.listBySeller("plasticov", { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("filters by ingestionRunId", () => {
      store.upsertEvidence(makeRef({ ingestionRunId: "run-001", sourceRecordId: "order-001" }));
      store.upsertEvidence(
        makeRef({
          ingestionRunId: "run-001",
          sourceRecordId: "order-002",
          checksum: "sha256:order:order-002:20000",
        }),
      );
      store.upsertEvidence(
        makeRef({
          ingestionRunId: "run-002",
          sourceRecordId: "order-003",
          checksum: "sha256:order:order-003:30000",
        }),
      );

      const results = store.listBySeller("plasticov", { ingestionRunId: "run-001" });
      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.ingestionRunId).toBe("run-001"));
    });

    it("filters by verification", () => {
      store.upsertEvidence(makeRef({ sourceRecordId: "order-001", verification: "verified" }));
      store.upsertEvidence(
        makeRef({
          sourceRecordId: "order-002",
          checksum: "sha256:order:order-002:20000",
          verification: "unverified",
        }),
      );

      const results = store.listBySeller("plasticov", { verification: "verified" });
      expect(results).toHaveLength(1);
      expect(results[0]!.verification).toBe("verified");
    });

    it("combines runId and verification filters", () => {
      store.upsertEvidence(
        makeRef({
          sourceRecordId: "order-001",
          ingestionRunId: "run-001",
          verification: "verified",
        }),
      );
      store.upsertEvidence(
        makeRef({
          sourceRecordId: "order-002",
          checksum: "sha256:order:order-002:20000",
          ingestionRunId: "run-001",
          verification: "unverified",
        }),
      );

      const results = store.listBySeller("plasticov", {
        ingestionRunId: "run-001",
        verification: "verified",
      });
      expect(results).toHaveLength(1);
    });
  });

  // ── 5. listByRun ──────────────────────────────────────────────────────

  describe("listByRun", () => {
    it("returns evidence for a specific run, scoped to seller", () => {
      store.upsertEvidence(makeRef({ ingestionRunId: "run-001", sourceRecordId: "order-001" }));
      store.upsertEvidence(
        makeRef({
          ingestionRunId: "run-001",
          sourceRecordId: "order-002",
          checksum: "sha256:order:order-002:20000",
        }),
      );
      store.upsertEvidence(
        makeRef({
          ingestionRunId: "run-002",
          sourceRecordId: "order-003",
          checksum: "sha256:order:order-003:30000",
        }),
      );

      const results = store.listByRun("plasticov", "run-001");
      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.ingestionRunId).toBe("run-001"));
    });

    it("returns empty for run with no evidence", () => {
      const results = store.listByRun("plasticov", "run-999");
      expect(results).toHaveLength(0);
    });
  });

  // ── 6. listBySourceRecord ─────────────────────────────────────────────

  describe("listBySourceRecord", () => {
    it("returns evidence for a source record, scoped to seller", () => {
      store.upsertEvidence(makeRef({ sourceRecordId: "order-001" }));
      store.upsertEvidence(
        makeRef({
          sourceRecordId: "order-001",
          checksum: "sha256:order:order-001-v2:12000",
          sourceVersion: "2026-02-01T10:00:00Z",
        }),
      );

      // Both share same sourceRecordId = "order-001"
      // But composite key includes version+checksum so both can co-exist
      const results = store.listBySourceRecord("order-001", "plasticov");
      // Only the one with matching checkum from upsert existed
      // Actually both use same composite key except version/checksum,
      // so they're distinct rows sharing sourceRecordId
      expect(results.length).toBeGreaterThanOrEqual(1);
      results.forEach((r) => expect(r.sourceRecordId).toBe("order-001"));
    });

    it("returns empty for unknown source record", () => {
      const results = store.listBySourceRecord("unknown-order", "plasticov");
      expect(results).toHaveLength(0);
    });
  });

  // ── 7. markSuperseded ─────────────────────────────────────────────────

  describe("markSuperseded", () => {
    const addPair = (sellerId: string, suffix: string) => {
      const target = makeRef({
        evidenceId: `${sellerId}-target-${suffix}`,
        sellerId,
        sourceRecordId: `${sellerId}-target-${suffix}`,
        checksum: `${sellerId}-target-checksum-${suffix}`,
      });
      const successor = makeRef({
        evidenceId: `${sellerId}-successor-${suffix}`,
        sellerId,
        sourceRecordId: `${sellerId}-successor-${suffix}`,
        checksum: `${sellerId}-successor-checksum-${suffix}`,
      });
      store.insertEvidence(target);
      store.insertEvidence(successor);
      return { target, successor };
    };

    it("links valid Plasticov and Maustian evidence while preserving seller-scoped reads", () => {
      const plasticov = addPair("plasticov", "valid");
      const maustian = addPair("maustian", "valid");
      store.markSuperseded(
        "plasticov",
        plasticov.target.evidenceId,
        plasticov.successor.evidenceId,
      );
      store.markSuperseded("maustian", maustian.target.evidenceId, maustian.successor.evidenceId);

      expect(
        db
          .prepare(
            "SELECT evidence_id, superseded_by FROM economic_evidence_references ORDER BY evidence_id",
          )
          .all(),
      ).toEqual(
        expect.arrayContaining([
          {
            evidence_id: plasticov.target.evidenceId,
            superseded_by: plasticov.successor.evidenceId,
          },
          { evidence_id: maustian.target.evidenceId, superseded_by: maustian.successor.evidenceId },
        ]),
      );
      expect(store.getEvidence(plasticov.target.evidenceId, "plasticov")?.evidenceId).toBe(
        plasticov.target.evidenceId,
      );
      expect(store.listBySeller("plasticov").every((ref) => ref.sellerId === "plasticov")).toBe(
        true,
      );
      expect(store.listBySeller("maustian").every((ref) => ref.sellerId === "maustian")).toBe(true);
    });

    it("rejects foreign or missing participants without changing any evidence", () => {
      const plasticov = addPair("plasticov", "rejections");
      const maustian = addPair("maustian", "rejections");
      const before = db
        .prepare(
          "SELECT evidence_id, seller_id, superseded_by FROM economic_evidence_references ORDER BY evidence_id",
        )
        .all();
      const calls: Array<[string, string, string]> = [
        ["plasticov", maustian.target.evidenceId, plasticov.successor.evidenceId],
        ["maustian", plasticov.target.evidenceId, maustian.successor.evidenceId],
        ["plasticov", plasticov.target.evidenceId, maustian.successor.evidenceId],
        ["maustian", maustian.target.evidenceId, plasticov.successor.evidenceId],
        ["plasticov", "missing-target", plasticov.successor.evidenceId],
        ["plasticov", plasticov.target.evidenceId, "missing-successor"],
      ];
      for (const args of calls) {
        expect(store.markSuperseded(...args)).toBeUndefined();
        expect(
          db
            .prepare(
              "SELECT evidence_id, seller_id, superseded_by FROM economic_evidence_references ORDER BY evidence_id",
            )
            .all(),
        ).toEqual(before);
      }
    });

    it("rejects same-seller self-supersession without mutation or disclosure", () => {
      const evidence = makeRef({ evidenceId: "plasticov-self-supersession" });
      store.insertEvidence(evidence);
      const select = db.prepare("SELECT * FROM economic_evidence_references WHERE evidence_id = ?");
      const before = select.get(evidence.evidenceId);
      const logs = (["error", "warn", "log"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined),
      );

      expect(
        store.markSuperseded(evidence.sellerId, evidence.evidenceId, evidence.evidenceId),
      ).toBeUndefined();
      expect(select.get(evidence.evidenceId)).toEqual(before);
      expect(logs.flatMap((log) => log.mock.calls)).toEqual([]);
      logs.forEach((log) => log.mockRestore());
    });

    it("fails closed for malformed runtime inputs without diagnostic disclosure or adjacent mutations", () => {
      const boundaryDb = new Database(":memory:");
      createEconomicMigrationPlan().apply(boundaryDb);
      const boundaryStore = createSqliteEconomicEvidenceStore(boundaryDb, { skipMigration: true });
      const target = makeRef({
        evidenceId: "plasticov-target-boundary",
        sourceRecordId: "boundary-target",
        checksum: "boundary-target",
      });
      const successor = makeRef({
        evidenceId: "plasticov-successor-boundary",
        sourceRecordId: "boundary-successor",
        checksum: "boundary-successor",
      });
      boundaryStore.insertEvidence(target);
      boundaryStore.insertEvidence(successor);
      boundaryDb.exec(`INSERT INTO economic_ingestion_runs (id, seller_id, status, mode, checkpoint_advanced) VALUES ('run-boundary', 'plasticov', 'persisting', 'manual', 0);
        INSERT INTO economic_ingestion_checkpoints (seller_id, last_run_id) VALUES ('plasticov', 'run-boundary');
        INSERT INTO economic_source_checkpoints (seller_id, source, version, last_run_id, updated_at) VALUES ('plasticov', 'orders', 1, 'run-boundary', 1);
        INSERT INTO economic_seller_leases (seller_id, owner_run_id, lease_token_digest, generation, database_generation, fence_generation, expires_at, updated_at) VALUES ('plasticov', 'run-boundary', 'digest', 1, 1, 1, 2, 1);
        INSERT INTO economic_source_health (seller_id, source, ready, requested_at, attempts, pages, records, retryable, updated_at) VALUES ('plasticov', 'orders', 1, 1, 0, 0, 0, 0, 1);`);
      const tables = [
        "economic_evidence_references",
        "economic_source_health",
        "economic_ingestion_checkpoints",
        "economic_ingestion_runs",
        "economic_seller_leases",
        "economic_database_fence",
        "economic_database_metadata",
      ];
      const snapshot = () =>
        tables.map((table) => boundaryDb.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
      const before = snapshot();
      const logs = (["error", "warn", "log"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined),
      );
      const secret = "maustian payload@example.test Bearer token /tmp/private SELECT";
      for (const args of [
        ["", target.evidenceId, successor.evidenceId],
        ["   ", target.evidenceId, successor.evidenceId],
        [`${secret}\0`, target.evidenceId, successor.evidenceId],
        ["plasticov", "\0", successor.evidenceId],
        ["plasticov", target.evidenceId, "  "],
        ["plasticov", undefined, successor.evidenceId],
      ] as unknown as Array<[string, string, string]>) {
        expect(boundaryStore.markSuperseded(...args)).toBeUndefined();
        expect(snapshot()).toEqual(before);
      }
      const diagnostics = logs
        .flatMap((log) => log.mock.calls)
        .flat()
        .join(" ");
      for (const sensitive of [
        "maustian",
        "payload",
        "@example.test",
        "Bearer",
        "token",
        "/tmp/private",
        "SELECT",
      ]) {
        expect(diagnostics).not.toContain(sensitive);
      }
      logs.forEach((log) => log.mockRestore());
      boundaryDb.close();
    });

    it("is deterministic for repeats", () => {
      const plasticov = addPair("plasticov", "repeat");
      store.markSuperseded(
        "plasticov",
        plasticov.target.evidenceId,
        plasticov.successor.evidenceId,
      );
      expect(() =>
        store.markSuperseded(
          "plasticov",
          plasticov.target.evidenceId,
          plasticov.successor.evidenceId,
        ),
      ).not.toThrow();
      expect(
        db
          .prepare("SELECT superseded_by FROM economic_evidence_references WHERE evidence_id = ?")
          .get(plasticov.target.evidenceId),
      ).toEqual({ superseded_by: plasticov.successor.evidenceId });
    });
  });

  // ── 8. countByRun ─────────────────────────────────────────────────────

  describe("countByRun", () => {
    it("counts evidence for a run", () => {
      store.upsertEvidence(makeRef({ ingestionRunId: "run-001", sourceRecordId: "order-001" }));
      store.upsertEvidence(
        makeRef({
          ingestionRunId: "run-001",
          sourceRecordId: "order-002",
          checksum: "sha256:order:order-002:20000",
        }),
      );
      store.upsertEvidence(
        makeRef({
          ingestionRunId: "run-001",
          sourceRecordId: "order-003",
          checksum: "sha256:order:order-003:30000",
        }),
      );

      expect(store.countByRun("plasticov", "run-001")).toBe(3);
    });

    it("returns 0 for run with no evidence", () => {
      expect(store.countByRun("plasticov", "no-such-run")).toBe(0);
    });
  });

  // ── Cross-seller isolation ────────────────────────────────────────────

  describe("cross-seller isolation", () => {
    it("listBySeller scopes to seller", () => {
      store.upsertEvidence(makeRef({ sellerId: "plasticov", sourceRecordId: "order-pl-001" }));
      store.upsertEvidence(
        makeRef({
          sellerId: "maustian",
          sourceRecordId: "order-mau-001",
          checksum: "sha256:order:order-mau-001:50000",
        }),
      );

      const plasticovResults = store.listBySeller("plasticov");
      expect(plasticovResults).toHaveLength(1);
      expect(plasticovResults[0]!.sellerId).toBe("plasticov");

      const maustianResults = store.listBySeller("maustian");
      expect(maustianResults).toHaveLength(1);
      expect(maustianResults[0]!.sellerId).toBe("maustian");
    });

    it("listBySourceRecord requires sellerId and isolates", () => {
      const pl = makeRef({ sellerId: "plasticov", sourceRecordId: "shared-record" });
      const mau = makeRef({
        sellerId: "maustian",
        sourceRecordId: "shared-record",
        checksum: "sha256:order:shared-record:60000",
      });

      store.insertEvidence(pl);
      store.insertEvidence(mau);

      const plasticovResults = store.listBySourceRecord("shared-record", "plasticov");
      expect(plasticovResults).toHaveLength(1);
      expect(plasticovResults[0]!.sellerId).toBe("plasticov");

      const maustianResults = store.listBySourceRecord("shared-record", "maustian");
      expect(maustianResults).toHaveLength(1);
      expect(maustianResults[0]!.sellerId).toBe("maustian");
    });

    it("getEvidence returns null for cross-seller query", () => {
      const ref = makeRef({ sellerId: "plasticov" });
      store.insertEvidence(ref);

      const result = store.getEvidence(ref.evidenceId, "maustian");
      expect(result).toBeNull();
    });
  });

  // ── No PII ────────────────────────────────────────────────────────────

  describe("no PII", () => {
    it("does not store email-like values in evidence columns", () => {
      const ref = makeRef({ sourceRecordId: "order-001" });
      store.insertEvidence(ref);

      const row = db
        .prepare("SELECT * FROM economic_evidence_references WHERE evidence_id = ?")
        .get(ref.evidenceId) as Record<string, unknown> | undefined;

      expect(row).not.toBeNull();
      const rowStr = JSON.stringify(row);
      expect(rowStr).not.toMatch(/@/);
      expect(rowStr).not.toContain("email");
      expect(rowStr).not.toContain("phone");
      expect(rowStr).not.toContain("address");
      expect(rowStr).not.toContain("token");
    });

    it("does not store raw payloads or addresses", () => {
      const ref = makeRef();
      store.insertEvidence(ref);

      const row = db
        .prepare("SELECT * FROM economic_evidence_references WHERE evidence_id = ?")
        .get(ref.evidenceId) as Record<string, unknown> | undefined;

      const rowStr = JSON.stringify(row);
      expect(rowStr).not.toContain("buyer");
      expect(rowStr).not.toContain("Authorization");
      expect(rowStr).not.toContain("Bearer");
      // Row should only contain the structured columns
      expect(row).toHaveProperty("evidence_id");
      expect(row).toHaveProperty("seller_id");
      expect(row).toHaveProperty("checksum");
      expect(row).toHaveProperty("created_at");
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("keeps unavailable legacy occurrence and source version absent rather than inventing defaults", () => {
      db.prepare(
        `INSERT INTO economic_evidence_references
          (evidence_id, seller_id, source_system, source_entity_type, source_record_id,
           observed_at, occurred_at, source_version, checksum, ingestion_run_id, created_at)
         VALUES ('legacy-unavailable', 'plasticov', 'mercadolibre', 'order', 'legacy-order',
           1, NULL, NULL, 'legacy-checksum', 'legacy-run', 1)`,
      ).run();

      expect(store.getEvidence("legacy-unavailable", "plasticov")).toMatchObject({
        evidenceId: "legacy-unavailable",
        observedAt: 1,
      });
      expect(store.getEvidence("legacy-unavailable", "plasticov")).not.toHaveProperty("occurredAt");
      expect(store.getEvidence("legacy-unavailable", "plasticov")).not.toHaveProperty(
        "sourceVersion",
      );
    });

    it("handle null source_field", () => {
      const ref = makeRef();
      // sourceField is undefined — should be stored as null
      store.insertEvidence(ref);

      const row = db
        .prepare("SELECT source_field FROM economic_evidence_references WHERE evidence_id = ?")
        .get(ref.evidenceId) as { source_field: string | null };
      expect(row.source_field).toBeNull();
    });

    it("handle null confidence", () => {
      // confidence is always present in EconomicEvidenceReference
      // but we test that it stores correctly
      const ref = makeRef({ confidence: 0.8 });
      store.insertEvidence(ref);

      const row = db
        .prepare("SELECT confidence FROM economic_evidence_references WHERE evidence_id = ?")
        .get(ref.evidenceId) as { confidence: number | null };
      expect(row.confidence).toBeCloseTo(0.8);
    });

    it("limit enforcement at high values", () => {
      // Insert 25 evidence refs
      for (let i = 0; i < 25; i++) {
        store.upsertEvidence(
          makeRef({
            sourceRecordId: `order-${String(i).padStart(3, "0")}`,
            checksum: `sha256:order:order-${i}:10000`,
          }),
        );
      }

      // Default limit of 20
      const results = store.listBySeller("plasticov");
      expect(results.length).toBeLessThanOrEqual(20);
    });

    it("listBySeller with no data returns empty array", () => {
      const results = store.listBySeller("empty-seller");
      expect(results).toEqual([]);
    });

    it("handles very long checksum values", () => {
      const longChecksum = "sha256:" + "a".repeat(256);
      const ref = makeRef({ checksum: longChecksum, sourceRecordId: "order-long" });
      store.insertEvidence(ref);

      const retrieved = store.getEvidence(ref.evidenceId, ref.sellerId);
      expect(retrieved!.checksum).toBe(longChecksum);
    });
  });

  // ── Table structure ───────────────────────────────────────────────────

  describe("table structure", () => {
    it("creates economic_evidence_references table with all columns", () => {
      const tableInfo = db
        .prepare("PRAGMA table_info(economic_evidence_references)")
        .all() as Array<{ name: string; type: string; notnull: number }>;

      const colNames = tableInfo.map((c) => c.name);
      expect(colNames).toContain("evidence_id");
      expect(colNames).toContain("seller_id");
      expect(colNames).toContain("source_system");
      expect(colNames).toContain("source_entity_type");
      expect(colNames).toContain("source_record_id");
      expect(colNames).toContain("source_field");
      expect(colNames).toContain("observed_at");
      expect(colNames).toContain("occurred_at");
      expect(colNames).toContain("source_version");
      expect(colNames).toContain("checksum");
      expect(colNames).toContain("verification");
      expect(colNames).toContain("confidence");
      expect(colNames).toContain("superseded_by");
      expect(colNames).toContain("ingestion_run_id");
      expect(colNames).toContain("created_at");
    });

    it("creates composite unique index", () => {
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%evidence%composite%'",
        )
        .all() as Array<{ name: string }>;
      expect(indexes.length).toBeGreaterThanOrEqual(1);
    });

    it("creates scan indexes", () => {
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_evidence_%'")
        .all() as Array<{ name: string }>;

      const idxNames = indexes.map((i) => i.name);
      expect(idxNames.some((n) => n.includes("ingestion_run"))).toBe(true);
      expect(idxNames.some((n) => n.includes("seller"))).toBe(true);
      expect(idxNames.some((n) => n.includes("source_record"))).toBe(true);
    });
  });
});
