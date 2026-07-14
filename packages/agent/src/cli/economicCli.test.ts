import { describe, it, expect, vi } from "vitest";
import type { EconomicIngestionRuntime, SellerSlug } from "../economics/factory.js";
import type { PipelineResult } from "../economics/EconomicIngestionPipeline.js";

// ── Fake runtime factory ───────────────────────────────────────────────────

function createFakeRuntime(overrides?: {
  pipelineResult?: PipelineResult;
}): EconomicIngestionRuntime {
  const pipelineFn = vi.fn().mockResolvedValue(
    overrides?.pipelineResult ??
      ({
        run: {
          runId: "fake-run-1",
          sellerId: "fake-seller-id",
          mode: "incremental",
          sourceKinds: ["orders"],
          startedAt: Date.now(),
          recordsFetched: 10,
          recordsNormalized: 10,
          componentsCreated: 5,
          snapshotsCreated: 3,
          duplicatesIgnored: 0,
          partialSnapshots: 1,
          disputedSnapshots: 0,
          errors: [],
          status: "completed",
          noExternalMutationExecuted: true,
        },
        snapshots: [],
        reconciliation: {
          status: "balanced",
          details: "All matched.",
          sourceTotal: 1000,
          computedTotal: 1000,
          difference: 0,
        },
      } as PipelineResult),
  );

  return {
    store: {
      listCostComponents: vi.fn().mockReturnValue([]),
      listUnitEconomicsSnapshots: vi.fn().mockReturnValue([]),
      listMissingInputs: vi.fn().mockReturnValue([]),
      // Other store methods unused by CLI
      insertOutcome: vi.fn(),
      updateOutcomeStatus: vi.fn(),
      verifyOutcome: vi.fn(),
      disputeOutcome: vi.fn(),
      getOutcome: vi.fn(),
      listOutcomesBySeller: vi.fn(),
      listOutcomesByProposal: vi.fn(),
      listOutcomesByOrder: vi.fn(),
      listOutcomesByCorrelationId: vi.fn(),
      insertUnitEconomicsSnapshot: vi.fn(),
      summarizeProfit: vi.fn(),
      insertCostComponent: vi.fn(),
      upsertCostComponent: vi.fn(),
      listBySourceRecord: vi.fn(),
      reverseCostComponent: vi.fn(),
    },
    runStore: {
      createRun: vi.fn(),
      updateRun: vi.fn(),
      getRun: vi.fn().mockResolvedValue(null),
      getLastRunBySeller: vi.fn().mockResolvedValue(null),
      listRunsBySeller: vi.fn().mockResolvedValue([]),
      getActiveRun: vi.fn().mockResolvedValue(null),
      recoverAbandonedRun: vi.fn(),
      getCheckpoint: vi.fn().mockResolvedValue(null),
      updateCheckpoint: vi.fn(),
    },
    pipeline: pipelineFn,
    reconciliation: vi.fn().mockReturnValue({
      status: "balanced",
      details: "All categories match exactly.",
      sourceTotal: 1000,
      computedTotal: 1000,
      difference: 0,
    }),
    dataFetcher: vi.fn(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    metrics: {
      record: vi.fn(),
      flush: vi.fn().mockReturnValue([]),
    },
    health: {
      sellerId: "fake-seller-id",
      sellerSlug: "source" as SellerSlug,
      storeReady: true,
      runStoreReady: true,
      dataFetcherReady: true,
      featureGateEnabled: true,
    },
    close: vi.fn(),
  } as unknown as EconomicIngestionRuntime;
}

// ── Dynamic import ─────────────────────────────────────────────────────────

// Use dynamic import so we can load the compiled CLI module
async function importCli() {
  return import("./economicCli.js");
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("economicCli", () => {
  describe("argument parsing", () => {
    it("parses seller flag", async () => {
      const { parseArgs } = await importCli();
      const args = parseArgs(["node", "cli.js", "status", "--seller=source"]);
      expect(args.seller).toBe("source");
      expect(args.command).toBe("status");
    });

    it("defaults seller to source", async () => {
      const { parseArgs } = await importCli();
      const args = parseArgs(["node", "cli.js", "status"]);
      expect(args.seller).toBe("source");
    });

    it("parses dry-run flag", async () => {
      const { parseArgs } = await importCli();
      const args = parseArgs(["node", "cli.js", "ingest", "--dry-run"]);
      expect(args.dryRun).toBe(true);
    });

    it("parses no-persist flag", async () => {
      const { parseArgs } = await importCli();
      const args = parseArgs(["node", "cli.js", "ingest", "--no-persist"]);
      expect(args.noPersist).toBe(true);
    });

    it("parses max-pages flag", async () => {
      const { parseArgs } = await importCli();
      const args = parseArgs(["node", "cli.js", "ingest", "--max-pages=3"]);
      expect(args.maxPages).toBe(3);
    });

    it("parses json flag", async () => {
      const { parseArgs } = await importCli();
      const args = parseArgs(["node", "cli.js", "status", "--json"]);
      expect(args.json).toBe(true);
    });

    it("parses limit flag", async () => {
      const { parseArgs } = await importCli();
      const args = parseArgs(["node", "cli.js", "ingest", "--limit=100"]);
      expect(args.limit).toBe(100);
    });

    it("parses from and to flags", async () => {
      const { parseArgs } = await importCli();
      const args = parseArgs(["node", "cli.js", "ingest", "--from=2025-01-01", "--to=2025-06-30"]);
      expect(args.from).toBe("2025-01-01");
      expect(args.to).toBe("2025-06-30");
    });
  });

  describe("runCli — command routing", () => {
    it("calls pipeline.run() for ingest command", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();
      const factory = vi.fn().mockReturnValue(runtime);

      const { output, exitCode } = await runCli(
        ["node", "cli.js", "ingest", "--seller=source"],
        factory,
      );

      expect(exitCode).toBe(0);
      expect(output.status).toBe("ok");
      expect(runtime.pipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          sellerId: "fake-seller-id",
          mode: "incremental",
        }),
      );
    });

    it("calls runStore.getLastRunBySeller() for status", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();

      // Set up a mock last run
      const getLastRunBySeller = vi.fn().mockResolvedValue({
        runId: "last-run",
        mode: "incremental",
        status: "completed",
        startedAt: Date.now(),
        snapshotsCreated: 5,
      });
      runtime.runStore.getLastRunBySeller = getLastRunBySeller;

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(["node", "cli.js", "status", "--seller=source"], factory);

      expect(output.status).toBe("ok");
      expect(getLastRunBySeller).toHaveBeenCalledWith("fake-seller-id");
      expect(output.result?.lastRun).not.toBeNull();
    });

    it("calls store for coverage", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(["node", "cli.js", "coverage", "--seller=source"], factory);

      expect(output.status).toBe("ok");
      expect(output.result?.overallStatus).toBeDefined();
      expect(output.result?.dimensions).toBeDefined();
    });

    it("calls reconciliation for reconcile", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();

      // Return some snapshots so reconcile can work
      runtime.store.listUnitEconomicsSnapshots = vi.fn().mockReturnValue([]);

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(["node", "cli.js", "reconcile", "--seller=source"], factory);

      expect(output.status).toBe("ok");
      expect(output.result?.verdict).toBeDefined();
    });

    it("calls store.listMissingInputs for missing", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();

      runtime.store.listMissingInputs = vi
        .fn()
        .mockReturnValue([{ outcomeId: "out-1", missingTypes: ["product_cost", "landed_cost"] }]);

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(["node", "cli.js", "missing", "--seller=source"], factory);

      expect(output.status).toBe("ok");
      expect(output.result?.missingInputs).toContain("product_cost");
      expect(output.result?.missingInputs).toContain("landed_cost");
    });
  });

  describe("error handling", () => {
    it("returns exit code 1 on pipeline failure", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime({
        pipelineResult: {
          run: {
            runId: "failed-run",
            sellerId: "fake-seller-id",
            mode: "incremental",
            sourceKinds: [],
            startedAt: Date.now(),
            recordsFetched: 0,
            recordsNormalized: 0,
            componentsCreated: 0,
            snapshotsCreated: 0,
            duplicatesIgnored: 0,
            partialSnapshots: 0,
            disputedSnapshots: 0,
            errors: ["Something broke"],
            status: "failed",
            noExternalMutationExecuted: true,
          },
          snapshots: [],
          reconciliation: {
            status: "incomplete",
            details: "Pipeline failed: Something broke",
          },
        },
      });

      const factory = vi.fn().mockReturnValue(runtime);

      const { exitCode } = await runCli(["node", "cli.js", "ingest", "--seller=source"], factory);

      expect(exitCode).toBe(1);
    });

    it("accepts both known sellers in parseArgs", async () => {
      const { parseArgs } = await importCli();
      expect(parseArgs(["node", "cli.js", "status", "--seller=source"]).seller).toBe("source");
      expect(parseArgs(["node", "cli.js", "status", "--seller=target"]).seller).toBe("target");
    });
  });

  describe("output format", () => {
    it("produces valid JSON output", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();
      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(
        ["node", "cli.js", "status", "--seller=source", "--json"],
        factory,
      );

      const json: unknown = JSON.parse(JSON.stringify(output));
      expect(json).toMatchObject({ status: "ok", command: "status", seller: "source" });
      expect(typeof json === "object" && json !== null && "timestamp" in json).toBe(true);
      if (typeof json === "object" && json !== null && "timestamp" in json) {
        expect(json.timestamp).toBeDefined();
      }
    });

    it("does not include email patterns in output", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();

      // Simulate a component with an email-like ID
      runtime.store.listCostComponents = vi.fn().mockReturnValue([
        {
          id: "comp-1",
          sellerId: "fake-seller-id",
          type: "marketplace_fee",
          amount: { amountMinor: 100, currency: "CLP" },
          source: "mercadolibre",
          sourceRecordId: "user@email.com",
          verification: "verified",
          confidence: 0.95,
          occurredAt: Date.now(),
          observedAt: Date.now(),
        },
      ]);

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(
        ["node", "cli.js", "coverage", "--seller=source", "--json"],
        factory,
      );

      const json = JSON.stringify(output);
      // Email should be sanitized
      expect(json).not.toMatch(/user@email\.com/);
    });
  });

  // ── PR 4: inspect-evidence tests ──────────────────────────────────────

  describe("inspect-evidence command", () => {
    it("returns empty list when store has no data", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();

      // Mock evidence store with no data
      runtime.evidenceStore = {
        listBySeller: vi.fn().mockReturnValue([]),
        listByRun: vi.fn().mockReturnValue([]),
        listBySourceRecord: vi.fn().mockReturnValue([]),
        insertEvidence: vi.fn(),
        upsertEvidence: vi.fn(),
        getEvidence: vi.fn().mockReturnValue(null),
        markSuperseded: vi.fn(),
        countByRun: vi.fn().mockReturnValue(0),
      };

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(
        ["node", "cli.js", "inspect-evidence", "--seller=source"],
        factory,
      );

      expect(output.status).toBe("ok");
      expect(output.result?.totalReferences).toBe(0);
      expect(output.result?.references).toEqual([]);
    });

    it("filters evidence by seller", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();

      const mockRefs = [
        {
          evidenceId: "ev-1",
          sellerId: "fake-seller-id",
          sourceSystem: "mercadolibre",
          sourceEntityType: "order",
          sourceRecordId: "order-001",
          sourceVersion: "v1",
          checksum: "abc123abcdef",
          verification: "verified",
          confidence: 0.95,
          ingestionRunId: "run-001",
          observedAt: Date.now(),
          occurredAt: Date.now() - 86400000,
        },
      ];

      const listBySeller = vi.fn().mockReturnValue(mockRefs);
      runtime.evidenceStore = {
        listBySeller,
        listByRun: vi.fn().mockReturnValue([]),
        listBySourceRecord: vi.fn().mockReturnValue([]),
        insertEvidence: vi.fn(),
        upsertEvidence: vi.fn(),
        getEvidence: vi.fn(),
        markSuperseded: vi.fn(),
        countByRun: vi.fn(),
      };

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(
        ["node", "cli.js", "inspect-evidence", "--seller=source"],
        factory,
      );

      expect(output.status).toBe("ok");
      expect(output.result?.totalReferences).toBe(1);
      expect((output.result?.references as Array<Record<string, unknown>>)?.[0]?.evidenceId).toBe(
        "ev-1",
      );
    });

    it("filters by run ID", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();

      const mockRefs = [
        {
          evidenceId: "ev-run-1",
          sellerId: "plasticov",
          sourceSystem: "mercadolibre",
          sourceEntityType: "order",
          sourceRecordId: "order-r1",
          sourceVersion: "v1",
          checksum: "abc123def456",
          verification: "verified",
          confidence: 0.9,
          ingestionRunId: "run-specific",
          observedAt: Date.now(),
          occurredAt: Date.now() - 86400000,
        },
      ];

      const listBySeller = vi.fn().mockReturnValue(mockRefs);
      runtime.evidenceStore = {
        listBySeller,
        listByRun: vi.fn().mockReturnValue(mockRefs),
        listBySourceRecord: vi.fn().mockReturnValue([]),
        insertEvidence: vi.fn(),
        upsertEvidence: vi.fn(),
        getEvidence: vi.fn(),
        markSuperseded: vi.fn(),
        countByRun: vi.fn(),
      };

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(
        ["node", "cli.js", "inspect-evidence", "--seller=source", "--run=run-specific"],
        factory,
      );

      expect(output.status).toBe("ok");
      // verify listBySeller was called with ingestionRunId filter
      expect(listBySeller).toHaveBeenCalledWith(
        "fake-seller-id",
        expect.objectContaining({ ingestionRunId: "run-specific" }),
      );
    });

    it("filters by source record", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();

      const mockRefs = [
        {
          evidenceId: "ev-src-1",
          sellerId: "plasticov",
          sourceSystem: "mercadolibre",
          sourceEntityType: "order",
          sourceRecordId: "order-src-001",
          sourceVersion: "v1",
          checksum: "abc789",
          verification: "verified",
          confidence: 0.85,
          ingestionRunId: "run-src",
          observedAt: Date.now(),
          occurredAt: Date.now() - 86400000,
        },
      ];

      const listBySourceRecord = vi.fn().mockReturnValue(mockRefs);
      runtime.evidenceStore = {
        listBySeller: vi.fn().mockReturnValue([]),
        listByRun: vi.fn().mockReturnValue([]),
        listBySourceRecord,
        insertEvidence: vi.fn(),
        upsertEvidence: vi.fn(),
        getEvidence: vi.fn(),
        markSuperseded: vi.fn(),
        countByRun: vi.fn(),
      };

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(
        ["node", "cli.js", "inspect-evidence", "--seller=source", "--source=order-src-001"],
        factory,
      );

      expect(output.status).toBe("ok");
      expect(listBySourceRecord).toHaveBeenCalledWith("order-src-001", "fake-seller-id");
    });

    it("enforces default limit of 20", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();

      // Generate 25 mock refs — the CLI should cap at 20 (default)
      const manyRefs = Array.from({ length: 25 }, (_, i) => ({
        evidenceId: `ev-${i}`,
        sellerId: "plasticov",
        sourceSystem: "mercadolibre",
        sourceEntityType: "order",
        sourceRecordId: `order-${String(i).padStart(3, "0")}`,
        sourceVersion: "v1",
        checksum: `checksum-${i}`,
        verification: "verified",
        confidence: 0.9,
        ingestionRunId: "run-limit",
        observedAt: Date.now(),
        occurredAt: Date.now() - 86400000,
      }));

      runtime.evidenceStore = {
        listBySeller: vi.fn().mockReturnValue(manyRefs),
        listByRun: vi.fn().mockReturnValue([]),
        listBySourceRecord: vi.fn().mockReturnValue([]),
        insertEvidence: vi.fn(),
        upsertEvidence: vi.fn(),
        getEvidence: vi.fn(),
        markSuperseded: vi.fn(),
        countByRun: vi.fn(),
      };

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(
        ["node", "cli.js", "inspect-evidence", "--seller=source"],
        factory,
      );

      expect(output.status).toBe("ok");
      // CLI caps at 20 results with default limit
      expect((output.result?.references as Array<unknown>)?.length).toBeLessThanOrEqual(20);
    });

    it("respects explicit --limit flag", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();

      const manyRefs = Array.from({ length: 50 }, (_, i) => ({
        evidenceId: `ev-${i}`,
        sellerId: "plasticov",
        sourceSystem: "mercadolibre",
        sourceEntityType: "order",
        sourceRecordId: `order-${String(i).padStart(3, "0")}`,
        sourceVersion: "v1",
        checksum: `checksum-${i}`,
        verification: "verified",
        confidence: 0.9,
        ingestionRunId: "run-limit-5",
        observedAt: Date.now(),
        occurredAt: Date.now() - 86400000,
      }));

      runtime.evidenceStore = {
        listBySeller: vi.fn().mockReturnValue(manyRefs),
        listByRun: vi.fn().mockReturnValue([]),
        listBySourceRecord: vi.fn().mockReturnValue([]),
        insertEvidence: vi.fn(),
        upsertEvidence: vi.fn(),
        getEvidence: vi.fn(),
        markSuperseded: vi.fn(),
        countByRun: vi.fn(),
      };

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(
        ["node", "cli.js", "inspect-evidence", "--seller=source", "--limit=5"],
        factory,
      );

      expect(output.status).toBe("ok");
      expect((output.result?.references as Array<unknown>)?.length).toBeLessThanOrEqual(5);
    });

    it("cross-seller: seller X cannot see seller Y's evidence", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();

      // Plasticov evidence
      const plasticovRefs = [
        {
          evidenceId: "ev-pl",
          sellerId: "fake-seller-id",
          sourceSystem: "mercadolibre",
          sourceEntityType: "order",
          sourceRecordId: "order-pl-001",
          sourceVersion: "v1",
          checksum: "pl-checksum",
          verification: "verified",
          confidence: 0.95,
          ingestionRunId: "run-pl",
          observedAt: Date.now(),
          occurredAt: Date.now() - 86400000,
        },
      ];

      const listBySeller = vi.fn().mockImplementation((sellerId: string) => {
        // Only return evidence for the queried seller
        return sellerId === "fake-seller-id" ? plasticovRefs : [];
      });
      runtime.evidenceStore = {
        listBySeller,
        listByRun: vi.fn().mockReturnValue([]),
        listBySourceRecord: vi.fn().mockReturnValue([]),
        insertEvidence: vi.fn(),
        upsertEvidence: vi.fn(),
        getEvidence: vi.fn(),
        markSuperseded: vi.fn(),
        countByRun: vi.fn(),
      };

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(
        ["node", "cli.js", "inspect-evidence", "--seller=source"],
        factory,
      );

      expect(output.status).toBe("ok");
      // Evidence should be returned (1 ref)
      expect(output.result?.totalReferences).toBe(1);
      // verify listBySeller was scoped to the correct seller
      expect(listBySeller).toHaveBeenCalledWith(
        "fake-seller-id",
        expect.objectContaining({ limit: 20 }),
      );
    });

    it("no PII in evidence output", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();

      // Evidence refs should not contain PII by design — verify sanitizeForOutput strips any
      const mockRefs = [
        {
          evidenceId: "ev-pii-test",
          sellerId: "plasticov",
          sourceSystem: "mercadolibre",
          sourceEntityType: "order",
          sourceRecordId: "order-001",
          sourceVersion: "v1",
          // checksum is truncated in CLI output
          checksum: "abcdef1234567890abcdef1234567890abcdef12",
          verification: "verified",
          confidence: 0.95,
          ingestionRunId: "run-001",
          observedAt: Date.now(),
          occurredAt: Date.now() - 86400000,
        },
      ];

      runtime.evidenceStore = {
        listBySeller: vi.fn().mockReturnValue(mockRefs),
        listByRun: vi.fn().mockReturnValue([]),
        listBySourceRecord: vi.fn().mockReturnValue([]),
        insertEvidence: vi.fn(),
        upsertEvidence: vi.fn(),
        getEvidence: vi.fn(),
        markSuperseded: vi.fn(),
        countByRun: vi.fn(),
      };

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(
        ["node", "cli.js", "inspect-evidence", "--seller=source", "--json"],
        factory,
      );

      const json = JSON.stringify(output);
      // Verify no PII patterns
      expect(json).not.toMatch(/@/);
      expect(json).not.toMatch(/buyer|email|phone|address|token|secret/i);
      // Checksum should be truncated to 12 chars
      const refs = output.result?.references as Array<{ checksum: string }> | undefined;
      if (refs && refs.length > 0) {
        expect(refs[0]!.checksum.length).toBe(12);
      }
    });
  });
});
