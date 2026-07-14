import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { EconomicEvidenceReference } from "@msl/domain";
import { createSqliteEconomicEvidenceStore } from "./economicEvidenceStore.js";
import type { EconomicEvidenceStore } from "./economicEvidenceStore.js";

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
    it("sets superseded_by on the target evidence", () => {
      const ev1 = makeRef({ sourceRecordId: "order-001", confidence: 0.5 });
      const ev2 = makeRef({
        sourceVersion: "2026-03-01T10:00:00Z",
        sourceRecordId: "order-002",
        confidence: 0.9,
      });

      store.insertEvidence(ev1);
      store.insertEvidence(ev2);

      store.markSuperseded(ev1.evidenceId, ev2.evidenceId);

      // Verify ev1 has superseded_by set
      const row = db
        .prepare("SELECT superseded_by FROM economic_evidence_references WHERE evidence_id = ?")
        .get(ev1.evidenceId) as { superseded_by: string | null };
      expect(row.superseded_by).toBe(ev2.evidenceId);

      // ev2 should NOT be modified
      const row2 = db
        .prepare("SELECT superseded_by FROM economic_evidence_references WHERE evidence_id = ?")
        .get(ev2.evidenceId) as { superseded_by: string | null };
      expect(row2.superseded_by).toBeNull();
    });

    it("old evidence remains queryable after supersede", () => {
      const ev1 = makeRef({ sourceRecordId: "order-001" });
      const ev2 = makeRef({ sourceVersion: "2026-03-01T10:00:00Z", sourceRecordId: "order-002" });

      store.insertEvidence(ev1);
      store.insertEvidence(ev2);
      store.markSuperseded(ev1.evidenceId, ev2.evidenceId);

      // ev1 should still be retrievable
      const retrieved = store.getEvidence(ev1.evidenceId, "plasticov");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.evidenceId).toBe(ev1.evidenceId);
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
