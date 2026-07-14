import { describe, it, expect, vi } from "vitest";
import type { EconomicIngestionRuntime, SellerSlug } from "../economics/factory.js";
import type {
  PipelineResult,
  ReconciliationVerdict,
} from "../economics/EconomicIngestionPipeline.js";
import { runEconomicIngestion } from "../economics/EconomicIngestionPipeline.js";
import { DeterministicRunIdFactory } from "@msl/domain";
import { createEconomicMemoryRuntime, createExecutionBudget } from "@msl/memory";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeEconomicDetails } from "../economics/economicSanitizer.js";

type CliFactory = (seller: SellerSlug) => EconomicIngestionRuntime;

type ParsedCliOutput = {
  readonly status: string;
  readonly command: string;
  readonly seller: string;
  readonly timestamp: string;
};

function parseCliOutput(value: unknown): ParsedCliOutput {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("CLI output is not JSON serializable");
  const parsed: unknown = JSON.parse(serialized);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("status" in parsed) ||
    typeof parsed.status !== "string" ||
    !("command" in parsed) ||
    typeof parsed.command !== "string" ||
    !("seller" in parsed) ||
    typeof parsed.seller !== "string" ||
    !("timestamp" in parsed) ||
    typeof parsed.timestamp !== "string"
  ) {
    throw new Error("CLI output does not match the expected JSON schema");
  }
  return {
    status: parsed.status,
    command: parsed.command,
    seller: parsed.seller,
    timestamp: parsed.timestamp,
  };
}

function runtimeFactoryFor(runtime: EconomicIngestionRuntime): CliFactory {
  return (_seller: SellerSlug): EconomicIngestionRuntime => runtime;
}

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
        } as ReconciliationVerdict,
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
      runtime.runStore.getLastRunBySeller = vi.fn().mockResolvedValue({
        runId: "last-run",
        mode: "incremental",
        status: "completed",
        startedAt: Date.now(),
        snapshotsCreated: 5,
      });

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(["node", "cli.js", "status", "--seller=source"], factory);

      expect(output.status).toBe("ok");
      expect(runtime.runStore.getLastRunBySeller).toHaveBeenCalledWith("fake-seller-id");
      expect(output.result?.lastRun).not.toBeNull();
    });

    it("returns only the requested seller-scoped run for status", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();
      const getRun = vi.fn().mockResolvedValue({
        runId: "run-source",
        sellerId: "fake-seller-id",
        mode: "incremental",
        status: "completed",
        startedAt: 1,
        snapshotsCreated: 2,
        noExternalMutationExecuted: true,
      });
      runtime.runStore.getRun = getRun;

      const { output, exitCode } = await runCli(
        ["node", "cli.js", "status", "--seller=source", "--run=run-source", "--json"],
        vi.fn().mockReturnValue(runtime),
      );

      expect(exitCode).toBe(0);
      expect(getRun).toHaveBeenCalledWith("run-source");
      expect(output.result?.run).toMatchObject({ runId: "run-source" });
      expect(output.result).not.toHaveProperty("totalRuns");
      expect(JSON.stringify(output)).toContain("noExternalMutationExecuted");
    });

    it("rejects a selected run owned by another seller without exposing it", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();
      runtime.runStore.getRun = vi
        .fn()
        .mockResolvedValue({ runId: "other-run", sellerId: "maustian" });

      const { output, exitCode } = await runCli(
        ["node", "cli.js", "status", "--seller=source", "--run=other-run", "--json"],
        vi.fn().mockReturnValue(runtime),
      );

      expect(exitCode).toBe(1);
      expect(output.error).toBe("Run not found for seller.");
      expect(JSON.stringify(output)).not.toContain("maustian");
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

    it("uses seller-and-run component and snapshot APIs for run coverage", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();
      const getRun = vi
        .fn()
        .mockResolvedValue({ runId: "run-coverage", sellerId: "fake-seller-id" });
      const listComponentsByRun = vi.fn().mockReturnValue([]);
      const listSnapshotsByRun = vi.fn().mockReturnValue([]);
      runtime.runStore.getRun = getRun;
      runtime.store.listComponentsByRun = listComponentsByRun;
      runtime.store.listSnapshotsByRun = listSnapshotsByRun;

      const { output } = await runCli(
        ["node", "cli.js", "coverage", "--seller=source", "--run=run-coverage"],
        vi.fn().mockReturnValue(runtime),
      );

      expect(listComponentsByRun).toHaveBeenCalledWith("fake-seller-id", "run-coverage");
      expect(listSnapshotsByRun).toHaveBeenCalledWith("fake-seller-id", "run-coverage");
      expect(output.result?.cumulativeMetrics).toMatchObject({ status: "unavailable" });
    });

    it.each(["status", "coverage", "reconcile", "missing", "inspect-evidence"] as const)(
      "returns safe non-zero JSON for an unknown selected run on %s",
      async (command) => {
        const { runCli } = await importCli();
        const runtime = createFakeRuntime();
        runtime.runStore.getRun = vi.fn().mockResolvedValue(null);

        const { output, exitCode } = await runCli(
          ["node", "cli.js", command, "--seller=source", "--run=missing-run", "--json"],
          runtimeFactoryFor(runtime),
        );

        const json = JSON.stringify(output);
        expect((): void => {
          JSON.parse(json);
        }).not.toThrow();
        expect(exitCode).toBe(1);
        expect(output).toMatchObject({ status: "error", error: "Run not found for seller." });
        expect(json).not.toContain("missing-run");
      },
    );

    it.each(["coverage", "reconcile", "missing", "inspect-evidence"] as const)(
      "returns safe non-zero JSON for a wrong-seller selected run on %s",
      async (command) => {
        const { runCli } = await importCli();
        const runtime = createFakeRuntime();
        runtime.runStore.getRun = vi.fn().mockResolvedValue({
          runId: "foreign-run",
          sellerId: "other-seller",
        });

        const { output, exitCode } = await runCli(
          ["node", "cli.js", command, "--seller=source", "--run=foreign-run", "--json"],
          runtimeFactoryFor(runtime),
        );

        const json = JSON.stringify(output);
        expect((): void => {
          JSON.parse(json);
        }).not.toThrow();
        expect(exitCode).toBe(1);
        expect(output.error).toBe("Run not found for seller.");
        expect(json).not.toContain("other-seller");
      },
    );

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

    it("uses only selected-run snapshots for missing inputs", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();
      const getRun = vi
        .fn()
        .mockResolvedValue({ runId: "run-missing", sellerId: "fake-seller-id" });
      const listSnapshotsByRun = vi
        .fn()
        .mockReturnValue([{ snapshotId: "snapshot-run-missing", missingInputs: ["product_cost"] }]);
      runtime.runStore.getRun = getRun;
      runtime.store.listSnapshotsByRun = listSnapshotsByRun;

      const { output, exitCode } = await runCli(
        ["node", "cli.js", "missing", "--seller=source", "--run=run-missing", "--json"],
        vi.fn().mockReturnValue(runtime),
      );

      expect(exitCode).toBe(0);
      expect(output.result?.missingInputs).toEqual(["product_cost"]);
      expect(listSnapshotsByRun).toHaveBeenCalledWith("fake-seller-id", "run-missing");
    });

    it("uses only selected-run snapshots for reconciliation", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();
      const getRun = vi
        .fn()
        .mockResolvedValue({ runId: "run-reconcile", sellerId: "fake-seller-id" });
      const listSnapshotsByRun = vi.fn().mockReturnValue([]);
      runtime.runStore.getRun = getRun;
      runtime.store.listSnapshotsByRun = listSnapshotsByRun;

      const { output, exitCode } = await runCli(
        ["node", "cli.js", "reconcile", "--seller=source", "--run=run-reconcile", "--json"],
        vi.fn().mockReturnValue(runtime),
      );

      expect(exitCode).toBe(0);
      expect(output.result?.verdict).toBe("incomplete");
      expect(listSnapshotsByRun).toHaveBeenCalledWith("fake-seller-id", "run-reconcile");
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
          } as ReconciliationVerdict,
        },
      });

      const factory = vi.fn().mockReturnValue(runtime);

      const { exitCode } = await runCli(["node", "cli.js", "ingest", "--seller=source"], factory);

      expect(exitCode).toBe(1);
    });

    it("sanitizes failed reconciliation details while preserving reason code and no-mutation status", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime({
        pipelineResult: {
          run: {
            runId: "failed-safe-run",
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
            errors: [],
            status: "failed",
            noExternalMutationExecuted: true,
          },
          snapshots: [],
          reconciliation: {
            status: "mismatched",
            details:
              "buyer@example.com raw_payload=private token=top-secret /home/agent/private.ts\n    at run (/home/agent/private.ts:1:1)",
            reasonCodes: ["reconciliation-mismatch"],
          } satisfies ReconciliationVerdict,
        } satisfies PipelineResult,
      });

      const { output, exitCode } = await runCli(
        ["node", "cli.js", "ingest", "--seller=source", "--json"],
        runtimeFactoryFor(runtime),
      );

      const json = JSON.stringify(output);
      expect((): void => {
        JSON.parse(json);
      }).not.toThrow();
      expect(exitCode).toBe(1);
      expect(output.result).toMatchObject({
        status: "failed",
        noExternalMutationExecuted: true,
        reconciliation: { reasonCodes: ["reconciliation-mismatch"] },
      });
      expect(json).not.toMatch(/buyer@example\.com|private|top-secret|\/home\/|\bat\s/);
    });

    it("propagates a real finalization failure as sanitized non-zero JSON with the original run ID", async () => {
      const { runCli } = await importCli();
      const runId = "economic-ingestion-00000000-0000-4000-a000-000000000127";
      const directory = mkdtempSync(join(tmpdir(), "msl-cli-finalization-"));
      const databasePath = join(directory, "economic.sqlite");
      const memoryRuntime = createEconomicMemoryRuntime({ databasePath });
      const db = new Database(databasePath);
      const store = memoryRuntime.readers.outcomes;
      const runStore = memoryRuntime.readers.runs;
      const evidenceStore = memoryRuntime.readers.evidence;
      db.exec(`
        CREATE TRIGGER reject_completed_economic_run_for_cli
        BEFORE UPDATE OF status ON economic_ingestion_runs
        WHEN NEW.status = 'completed'
        BEGIN
          SELECT RAISE(ABORT, 'finalization secret=super-secret');
        END;
      `);
      const runtime = createFakeRuntime();
      runtime.store = store;
      runtime.runStore = runStore;
      runtime.evidenceStore = evidenceStore;
      runtime.health = {
        ...runtime.health,
        sellerId: "plasticov",
        sellerSlug: "source",
      };
      runtime.pipeline = (config) =>
        runEconomicIngestion(
          config,
          memoryRuntime.readers,
          memoryRuntime.writeSessionFactory,
          () =>
            Promise.resolve({
              orders: [
                {
                  id: "order-cli-finalization-failure",
                  status: "paid",
                  total_amount: 10000,
                  currency_id: "CLP",
                  date_created: "2026-01-15T10:00:00Z",
                  order_items: [
                    {
                      item: { id: "MLI-CLI", title: "CLI test item" },
                      quantity: 1,
                      unit_price: 10000,
                    },
                  ],
                  sale_fee_amount: 1100,
                  shipping_cost: 800,
                  shipping_mode: "seller",
                },
              ],
              items: [],
              claims: [],
              ads: [],
            }),
          createExecutionBudget(60_000),
          new DeterministicRunIdFactory([runId]),
        );
      runtime.close = () => {
        db.close();
        memoryRuntime.close();
        rmSync(directory, { recursive: true, force: true });
      };

      const { output, exitCode } = await runCli(
        ["node", "cli.js", "ingest", "--seller=source", "--json"],
        vi.fn().mockReturnValue(runtime),
      );

      const json = JSON.parse(JSON.stringify(output)) as {
        status: string;
        result?: Record<string, unknown>;
        error?: string;
      };
      expect(exitCode).toBe(1);
      expect(json.status).toBe("error");
      expect(json.result).toMatchObject({
        runId,
        status: "failed",
        noExternalMutationExecuted: true,
      });
      expect(json.error).not.toContain("super-secret");
      expect(json.error).not.toMatch(/\bat\s+.*\//);
    });

    it.each([
      ["invalid command", ["node", "cli.js", "credential=secret", "--json"]],
      ["invalid seller", ["node", "cli.js", "status", "--seller=buyer@example.com", "--json"]],
    ])("returns safe non-zero JSON for %s", async (_name, argv) => {
      const { runCli } = await importCli();

      const { output, exitCode } = await runCli(argv, vi.fn());
      const json = JSON.stringify(output);

      expect((): void => {
        JSON.parse(json);
      }).not.toThrow();
      expect(exitCode).toBe(1);
      expect(output).toMatchObject({
        status: "error",
        result: { noExternalMutationExecuted: true },
      });
      expect(json).not.toMatch(/secret|buyer@example\.com/);
    });

    it("returns safe non-zero JSON when runtime factory construction throws", async () => {
      const { runCli } = await importCli();
      const { output, exitCode } = await runCli(
        ["node", "cli.js", "status", "--seller=source", "--json"],
        () => {
          throw new Error(
            "buyer@example.com token=top-secret /private/runtime.ts\n    at factory (/private/runtime.ts:1:1)",
          );
        },
      );
      const json = JSON.stringify(output);

      expect((): void => {
        JSON.parse(json);
      }).not.toThrow();
      expect(exitCode).toBe(1);
      expect(output.result).toMatchObject({ noExternalMutationExecuted: true });
      expect(json).not.toMatch(/buyer@example\.com|top-secret|\/private\/|\bat\s/);
    });

    it("returns safe non-zero JSON when a handler store call throws", async () => {
      const { runCli } = await importCli();
      const runtime = createFakeRuntime();
      runtime.runStore.getLastRunBySeller = vi
        .fn()
        .mockRejectedValue(
          new Error("buyer@example.com raw_payload=private token=top-secret /private/store.ts"),
        );

      const { output, exitCode } = await runCli(
        ["node", "cli.js", "status", "--seller=source", "--json"],
        runtimeFactoryFor(runtime),
      );
      const json = JSON.stringify(output);

      expect((): void => {
        JSON.parse(json);
      }).not.toThrow();
      expect(exitCode).toBe(1);
      expect(output.result).toMatchObject({ noExternalMutationExecuted: true });
      expect(json).not.toMatch(/buyer@example\.com|private|top-secret|\/private\//);
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

      const json = parseCliOutput(output);
      expect(json.status).toBe("ok");
      expect(json.command).toBe("status");
      expect(json.seller).toBe("source");
      expect(json.timestamp).toBeDefined();
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
        getEvidence: vi.fn().mockReturnValue(null),
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

      runtime.evidenceStore = {
        listBySeller: vi.fn().mockReturnValue(mockRefs),
        listByRun: vi.fn().mockReturnValue([]),
        listBySourceRecord: vi.fn().mockReturnValue([]),
        getEvidence: vi.fn(),
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
      runtime.runStore.getRun = vi
        .fn()
        .mockResolvedValue({ runId: "run-specific", sellerId: "fake-seller-id" });

      runtime.evidenceStore = {
        listBySeller: vi.fn().mockReturnValue(mockRefs),
        listByRun: vi.fn().mockReturnValue(mockRefs),
        listBySourceRecord: vi.fn().mockReturnValue([]),
        getEvidence: vi.fn(),
        countByRun: vi.fn(),
      };

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(
        ["node", "cli.js", "inspect-evidence", "--seller=source", "--run=run-specific"],
        factory,
      );

      expect(output.status).toBe("ok");
      // verify listBySeller was called with ingestionRunId filter
      expect(runtime.evidenceStore.listBySeller).toHaveBeenCalledWith(
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

      runtime.evidenceStore = {
        listBySeller: vi.fn().mockReturnValue([]),
        listByRun: vi.fn().mockReturnValue([]),
        listBySourceRecord: vi.fn().mockReturnValue(mockRefs),
        getEvidence: vi.fn(),
        countByRun: vi.fn(),
      };

      const factory = vi.fn().mockReturnValue(runtime);

      const { output } = await runCli(
        ["node", "cli.js", "inspect-evidence", "--seller=source", "--source=order-src-001"],
        factory,
      );

      expect(output.status).toBe("ok");
      expect(runtime.evidenceStore.listBySourceRecord).toHaveBeenCalledWith(
        "order-src-001",
        "fake-seller-id",
      );
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
        getEvidence: vi.fn(),
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
        getEvidence: vi.fn(),
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

      runtime.evidenceStore = {
        listBySeller: vi.fn().mockImplementation((sellerId: string) => {
          // Only return evidence for the queried seller
          return sellerId === "fake-seller-id" ? plasticovRefs : [];
        }),
        listByRun: vi.fn().mockReturnValue([]),
        listBySourceRecord: vi.fn().mockReturnValue([]),
        getEvidence: vi.fn(),
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
      expect(runtime.evidenceStore.listBySeller).toHaveBeenCalledWith(
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
        getEvidence: vi.fn(),
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

describe("sanitizeEconomicDetails", () => {
  it("returns bounded JSON-safe output and never invokes getters", () => {
    let getterCalls = 0;
    const cycle: Record<string, unknown> = { safe: "economic source" };
    cycle.self = cycle;
    Object.defineProperty(cycle, "danger", {
      enumerable: true,
      get(): string {
        getterCalls += 1;
        throw new Error("must not run");
      },
    });
    const large = "x".repeat(50_000);
    const result = sanitizeEconomicDetails({
      reasonCode: "reconciliation-mismatch",
      amountMinor: 12,
      difference: 1,
      tolerance: 1,
      currency: "CLP",
      sellerId: "plasticov",
      source: "orders",
      count: 2,
      email: "buyer@example.com",
      rawPayload: { private: true },
      authorization: "Bearer secret-value",
      nested: cycle,
      error: new Error(
        "token=secret /home/private/file.ts\n    at stack (/home/private/file.ts:1:1)",
      ),
      date: new Date(),
      binary: new Uint8Array([1, 2]),
      callback: () => undefined,
      marker: Symbol("marker"),
      big: 10n,
      large,
      deep: { a: { b: { c: { d: { e: { f: { g: "too deep" } } } } } } },
      entries: Array.from({ length: 100 }, (_, index) => ({ index })),
    });

    const json = JSON.stringify(result);
    expect((): void => {
      JSON.parse(json);
    }).not.toThrow();
    expect(getterCalls).toBe(0);
    expect(json.length).toBeLessThanOrEqual(10_000);
    expect(json).toContain("reconciliation-mismatch");
    expect(json).toContain("plasticov");
    expect(json).toMatch(/\[redacted\]|\[email\]/);
    expect(json).not.toMatch(/buyer@example\.com|secret-value|\/home\/private|must not run/);
    expect(json).toContain("[cycle]");
    expect(json).toContain("[getter-omitted]");
    expect(json).toContain("[unsupported-object]");
  });

  it("keeps adversarial nested numeric, sentinel, wide, and huge values within the global JSON budget", () => {
    const nestedNumbers: unknown[] = [];
    let cursor = nestedNumbers;
    for (let level = 0; level < 20; level += 1) {
      const next = Array.from({ length: 100 }, (_, index) => index);
      cursor.push(next);
      cursor = next;
    }
    const sentinelObjects = Array.from({ length: 100 }, (_, index) => ({
      [`key-${index}`]: {
        deep: { unsupported: new Date(), value: "v".repeat(10_000) },
      },
    }));
    const wideObject = Object.fromEntries(
      Array.from({ length: 500 }, (_, index) => [`numeric-${index}`, index]),
    );
    const hugeValues = Array.from({ length: 10_000 }, (_, index) => index);

    expect(() => {
      const result = sanitizeEconomicDetails({
        nestedNumbers,
        sentinelObjects,
        wideObject,
        hugeValues,
        finite: Number.MAX_VALUE,
        boolean: true,
        empty: null,
      });
      const json = JSON.stringify(result);
      expect(JSON.parse(json)).toBeDefined();
      expect(json.length).toBeLessThanOrEqual(10_000);
    }).not.toThrow();
  });
});
