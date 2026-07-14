#!/usr/bin/env npx tsx

/**
 * Economic CLI — ingests, reconciles, and reports on economic data.
 *
 * Commands:
 *   ingest            Run the economic ingestion pipeline
 *   status            Show last run status
 *   coverage          Show data coverage report
 *   reconcile         Run reconciliation
 *   missing           List missing inputs
 *   inspect-evidence   Inspect evidence references
 *
 * Flags:
 *   --seller source|target   Seller slug (default: "source")
 *   --dry-run                Dry-run mode (ingest only)
 *   --no-persist             Skip persistence (ingest only)
 *   --max-pages <n>          Max pages to fetch (ingest only, default: 5)
 *   --limit <n>              Max orders/snapshots to process
 *   --from <ISO date>        Start date filter (backfill mode)
 *   --to <ISO date>          End date filter (backfill mode)
 *   --max-time <ms>          Max pipeline execution time
 *   --resume                 Resume from checkpoint (incremental mode)
 *   --strict                 Exit non-zero on partial/reconciliation issues
 *   --json                   Output as JSON
 *   --run <id>               Filter seller-scoped status, coverage, reconciliation, missing inputs, or evidence
 *   --source <id>            Filter by source record ID (inspect-evidence)
 *   --verification <v>       Filter by verification status (inspect-evidence)
 */

import { createEconomicIngestionRuntime } from "../economics/factory.js";
import type { SellerSlug, EconomicIngestionRuntime } from "../economics/factory.js";
import type { PipelineConfig } from "../economics/EconomicIngestionPipeline.js";
import {
  safeEconomicErrorMessage,
  sanitizeEconomicRecord,
} from "../economics/economicSanitizer.js";

// ── Types ──────────────────────────────────────────────────────────────────

type CliArgs = {
  command: "ingest" | "status" | "coverage" | "reconcile" | "missing" | "inspect-evidence";
  seller: SellerSlug;
  dryRun: boolean;
  noPersist: boolean;
  maxPages: number;
  limit: number;
  from?: string | undefined;
  to?: string | undefined;
  maxTime?: number | undefined;
  resume: boolean;
  strict: boolean;
  json: boolean;
  // inspect-evidence flags
  runId?: string | undefined;
  sourceRecordId?: string | undefined;
  verification?: string | undefined;
};

type CliOutput = {
  status: "ok" | "error";
  command: string;
  seller: string;
  timestamp: string;
  result?: Record<string, unknown>;
  error?: string;
};

class CliInputError extends Error {}

// ── Argument parsing ───────────────────────────────────────────────────────

const VALID_SELLER_SLUGS = new Set(["source", "target"]);
const VALID_COMMANDS = new Set([
  "ingest",
  "status",
  "coverage",
  "reconcile",
  "missing",
  "inspect-evidence",
]);

export function parseArgs(raw: string[]): CliArgs {
  const args = raw.slice(2);
  const command = args[0] as CliArgs["command"] | undefined;

  if (!command || !VALID_COMMANDS.has(command)) {
    throw new CliInputError("Invalid economic command.");
  }

  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx > 2) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        if (i + 1 < args.length && !args[i + 1]!.startsWith("--")) {
          flags[key] = args[i + 1]!;
          i++;
        } else {
          flags[key] = "true";
        }
      }
    }
  }

  const seller = flags.seller?.trim().toLowerCase() ?? "source";
  if (!VALID_SELLER_SLUGS.has(seller)) {
    throw new CliInputError("Invalid economic seller.");
  }

  const maxPages = parseInt(flags["max-pages"] ?? "5", 10);
  const limit = parseInt(flags.limit ?? "0", 10);
  const maxTime = flags["max-time"] ? parseInt(flags["max-time"], 10) : undefined;

  return {
    command,
    seller: seller as SellerSlug,
    dryRun: flags["dry-run"] === "true" || flags["dry-run"] === "",
    noPersist: flags["no-persist"] === "true" || flags["no-persist"] === "",
    maxPages: isNaN(maxPages) || maxPages < 1 ? 5 : maxPages,
    limit: isNaN(limit) || limit < 1 ? 0 : limit,
    from: flags.from || undefined,
    to: flags.to || undefined,
    maxTime: maxTime && !isNaN(maxTime) && maxTime > 0 ? maxTime : undefined,
    resume: flags.resume === "true" || flags.resume === "",
    strict: flags.strict === "true" || flags.strict === "",
    json: flags.json === "true" || flags.json === "",
    runId: flags.run || undefined,
    sourceRecordId: flags.source || undefined,
    verification: flags.verification || undefined,
  };
}

// ── Output helpers ─────────────────────────────────────────────────────────

function okOutput(args: CliArgs, result: Record<string, unknown>): CliOutput {
  return {
    status: "ok",
    command: args.command,
    seller: args.seller,
    timestamp: new Date().toISOString(),
    result,
  };
}

function errOutput(args: CliArgs, error: string): CliOutput {
  return {
    status: "error",
    command: args.command,
    seller: args.seller,
    timestamp: new Date().toISOString(),
    result: { noExternalMutationExecuted: true },
    error,
  };
}

function emit(output: CliOutput, useJson: boolean): void {
  if (useJson) {
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  } else {
    const emoji = output.status === "ok" ? "✅" : "❌";
    process.stdout.write(`${emoji} ${output.command} for ${output.seller}\n`);
    if (output.status === "error") {
      process.stdout.write(`   Error: ${output.error}\n`);
    } else if (output.result) {
      for (const [key, value] of Object.entries(output.result)) {
        // Sanitize: never output PII or secrets
        process.stdout.write(`   ${key}: ${JSON.stringify(value)}\n`);
      }
    }
  }
}

// ── PII-safe sanitization ──────────────────────────────────────────────────

/**
 * Strip any buyer PII from result objects before output.
 * This is a defense-in-depth measure — the pipeline should not have PII,
 * but we sanitize at the output boundary as well.
 */
async function getSelectedRun(args: CliArgs, runtime: EconomicIngestionRuntime) {
  const run = args.runId
    ? await runtime.runStore.getRun(args.runId)
    : await runtime.runStore.getLastRunBySeller(runtime.health.sellerId);
  if (run?.sellerId && run.sellerId !== runtime.health.sellerId) {
    throw new Error("Run not found for seller.");
  }
  if (args.runId && !run) {
    throw new Error("Run not found for seller.");
  }
  return run;
}

function runSummary(
  run: NonNullable<Awaited<ReturnType<EconomicIngestionRuntime["runStore"]["getRun"]>>>,
) {
  return {
    runId: run.runId,
    mode: run.mode,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt ?? null,
    snapshotsCreated: run.snapshotsCreated,
    reconciliation: run.reconciliation ?? null,
    checkpoint: {
      before: run.checkpointBefore ?? null,
      after: run.checkpointAfter ?? null,
    },
    cumulativeMetrics: run.cumulativeMetrics ?? { status: "unavailable", reason: "Not recorded." },
    noExternalMutationExecuted: true,
  };
}

// ── Command handlers ───────────────────────────────────────────────────────

async function handleIngest(args: CliArgs, runtime: EconomicIngestionRuntime): Promise<CliOutput> {
  const config: Record<string, unknown> = {
    sellerId: runtime.health.sellerId,
    mode: args.dryRun ? "dry-run" : args.resume ? "incremental" : "incremental",
    maxPages: args.maxPages,
    noPersist: args.noPersist,
  };
  if (args.limit > 0) config.limit = args.limit;
  if (args.from) config.from = args.from;
  if (args.to) config.to = args.to;
  if (args.maxTime) config.maxTime = args.maxTime;

  const result = await runtime.pipeline(config as PipelineConfig);

  const output: Record<string, unknown> = {
    runId: result.run.runId,
    sellerId: result.run.sellerId,
    mode: result.run.mode,
    status: result.run.status,
    snapshotsCreated: result.snapshots.length,
    reconciliation: {
      status: result.reconciliation.status,
      reasonCodes: result.reconciliation.reasonCodes ?? [],
    },
    details: result.reconciliation.details,
    coverage: {
      partialSnapshots: result.run.partialSnapshots,
      disputedSnapshots: result.run.disputedSnapshots,
    },
    checkpoint: {
      before: result.run.checkpointBefore ?? null,
      after: result.run.checkpointAfter ?? null,
    },
    noExternalMutationExecuted: result.run.noExternalMutationExecuted,
  };

  if (result.run.status === "failed") {
    const isPersistenceFailure = result.reconciliation.details.includes("Persistence failed");
    return {
      status: "error",
      command: args.command,
      seller: args.seller,
      timestamp: new Date().toISOString(),
      result: {
        ...sanitizeEconomicRecord({
          ...output,
          noExternalMutationExecuted: result.run.noExternalMutationExecuted,
        }),
        // The durable run identity is a technical UUID, not PII. Preserve it
        // verbatim so a failed invocation can be correlated with its row.
        runId: result.run.runId,
      },
      error: safeEconomicErrorMessage(
        isPersistenceFailure
          ? `Persistence failure: ${result.reconciliation.details}`
          : result.reconciliation.details,
      ),
    };
  }

  return okOutput(args, sanitizeEconomicRecord(output));
}

async function handleStatus(args: CliArgs, runtime: EconomicIngestionRuntime): Promise<CliOutput> {
  const lastRun = await getSelectedRun(args, runtime);
  const result: Record<string, unknown> = args.runId
    ? { run: runSummary(lastRun!) }
    : { lastRun: lastRun ? runSummary(lastRun) : null };

  return okOutput(args, sanitizeEconomicRecord(result));
}

async function handleCoverage(
  args: CliArgs,
  runtime: EconomicIngestionRuntime,
): Promise<CliOutput> {
  const store = runtime.store;
  const sellerId = runtime.health.sellerId;
  const selectedRun = args.runId ? await getSelectedRun(args, runtime) : null;
  const components = args.runId
    ? store.listComponentsByRun(sellerId, args.runId)
    : store.listCostComponents(sellerId, { limit: 5000 });
  const snapshots = args.runId
    ? store.listSnapshotsByRun(sellerId, args.runId)
    : store.listUnitEconomicsSnapshots(sellerId, { limit: 1000 });

  // Query cost components per dimension to determine coverage
  const dimensionTypes: Record<string, string> = {
    revenue: "revenue",
    marketplace_fee: "marketplace_fee",
    shipping: "shipping",
    seller_discount: "seller_discount",
    refund_return: "refund",
    advertising: "advertising",
    product_cost: "product_cost",
    landed_cost: "landed_cost",
  };

  const dimensions: Record<string, string> = {};
  let hasAnyData = false;

  for (const [dim, type] of Object.entries(dimensionTypes)) {
    if (dim === "refund_return") {
      // Check both refund and return types
      const refundComponents = components.filter((component) => component.type === "refund");
      const returnComponents = components.filter((component) => component.type === "return");
      const hasData = refundComponents.length > 0 || returnComponents.length > 0;
      dimensions[dim] = hasData ? "complete" : "partial";
      if (hasData) hasAnyData = true;
    } else {
      const matchingComponents = components.filter((component) => component.type === type);
      dimensions[dim] = matchingComponents.length > 0 ? "complete" : "partial";
      if (matchingComponents.length > 0) hasAnyData = true;
    }
  }

  const result: Record<string, unknown> = {
    overallStatus: hasAnyData ? "partial" : "unavailable",
    confidence: hasAnyData ? 0.7 : 0.3,
    dimensions,
    counts: { components: components.length, snapshots: snapshots.length },
    cumulativeMetrics: selectedRun?.cumulativeMetrics ?? {
      status: "unavailable",
      reason: "Run-scoped coverage does not infer historical metrics.",
    },
  };

  return okOutput(args, sanitizeEconomicRecord(result));
}

async function handleReconcile(
  args: CliArgs,
  runtime: EconomicIngestionRuntime,
): Promise<CliOutput> {
  const store = runtime.store;
  const sellerId = runtime.health.sellerId;
  if (args.runId) {
    await getSelectedRun(args, runtime);
  }
  const snapshots = args.runId
    ? store.listSnapshotsByRun(sellerId, args.runId)
    : store.listUnitEconomicsSnapshots(sellerId, { limit: 500 });

  if (snapshots.length === 0) {
    return okOutput(args, {
      verdict: "incomplete",
      message: "No snapshots available for reconciliation. Run ingest first.",
    });
  }

  // Reconcile using existing service
  const sourceTotals = {
    grossRevenue: 0,
    fees: 0,
    shipping: 0,
    ads: 0,
    refunds: 0,
  };

  // Derive source totals from snapshots' cost components
  for (const snap of snapshots) {
    sourceTotals.grossRevenue += snap.grossRevenue;
    sourceTotals.fees += snap.marketplaceFees;
    sourceTotals.shipping += snap.sellerShippingCost;
    sourceTotals.ads += snap.advertisingCost;
    sourceTotals.refunds += snap.refunds;
  }

  const reconciliation = runtime.reconciliation(sourceTotals, snapshots, 1);

  const result: Record<string, unknown> = {
    verdict: reconciliation.status,
    details: reconciliation.details,
    snapshotsAnalyzed: snapshots.length,
  };

  return okOutput(args, sanitizeEconomicRecord(result));
}

async function handleMissing(args: CliArgs, runtime: EconomicIngestionRuntime): Promise<CliOutput> {
  const store = runtime.store;
  const sellerId = runtime.health.sellerId;
  if (args.runId) {
    await getSelectedRun(args, runtime);
  }
  const missingInputs = args.runId
    ? store.listSnapshotsByRun(sellerId, args.runId).flatMap((snapshot) => {
        const missingTypes = (snapshot as { missingInputs?: unknown }).missingInputs;
        return Array.isArray(missingTypes)
          ? [
              {
                outcomeId: snapshot.snapshotId,
                missingTypes: missingTypes.filter(
                  (value): value is string => typeof value === "string",
                ),
              },
            ]
          : [];
      })
    : store.listMissingInputs(sellerId);

  // Deduplicate across all results
  const allMissingTypes = new Set<string>();
  for (const entry of missingInputs) {
    for (const type of entry.missingTypes) {
      allMissingTypes.add(type);
    }
  }

  const result: Record<string, unknown> = {
    missingInputs: [...allMissingTypes].sort(),
    affectedSnapshots: missingInputs.length,
    details: missingInputs.slice(0, 20), // bounded
  };

  return okOutput(args, sanitizeEconomicRecord(result));
}

async function handleInspectEvidence(
  args: CliArgs,
  runtime: EconomicIngestionRuntime,
): Promise<CliOutput> {
  const evidenceStore = runtime.evidenceStore;
  const sellerId = runtime.health.sellerId;

  // Validate seller
  if (!sellerId) {
    return errOutput(args, "Cannot determine seller ID from runtime.");
  }

  if (args.runId) await getSelectedRun(args, runtime);

  const limit = args.limit > 0 ? Math.min(args.limit, 100) : 20;

  let refs;
  if (args.sourceRecordId) {
    refs = evidenceStore.listBySourceRecord(args.sourceRecordId, sellerId);
  } else if (args.runId) {
    // If run is specified, list by seller with run filter
    refs = evidenceStore.listBySeller(sellerId, {
      ingestionRunId: args.runId,
      ...(args.verification ? { verification: args.verification } : {}),
      limit,
    });
  } else {
    refs = evidenceStore.listBySeller(sellerId, {
      ...(args.verification ? { verification: args.verification } : {}),
      limit,
    });
  }

  const evidenceRows = refs
    .filter((ref) => !args.runId || ref.ingestionRunId === args.runId)
    .slice(0, limit)
    .map((ref) => ({
      evidenceId: ref.evidenceId,
      sourceSystem: ref.sourceSystem,
      sourceEntityType: ref.sourceEntityType,
      sourceRecordId: ref.sourceRecordId,
      sourceVersion: ref.sourceVersion,
      checksum: ref.checksum.length > 12 ? ref.checksum.slice(0, 12) : ref.checksum,
      verification: ref.verification,
      confidence: ref.confidence,
      ingestionRunId: ref.ingestionRunId,
      observedAt: ref.observedAt,
      occurredAt: ref.occurredAt,
      createdAt: ref.observedAt, // approximate — created_at is internal
    }));

  const result: Record<string, unknown> = {
    sellerId,
    totalReferences: evidenceRows.length,
    references: evidenceRows,
  };

  return okOutput(args, sanitizeEconomicRecord(result));
}

// ── Seller slug validation ─────────────────────────────────────────────────

// ── Main ───────────────────────────────────────────────────────────────────

function jsonRequested(argv: string[]): boolean {
  return argv.slice(2).some((arg) => arg === "--json" || arg === "--json=true");
}

function invalidInputOutput(error: unknown): CliOutput {
  return {
    status: "error",
    command: "unknown",
    seller: "unknown",
    timestamp: new Date().toISOString(),
    result: { noExternalMutationExecuted: true },
    error: safeEconomicErrorMessage(error),
  };
}

export async function runCli(
  argv: string[],
  factory: (seller: SellerSlug) => EconomicIngestionRuntime = createEconomicIngestionRuntime,
): Promise<{ output: CliOutput; exitCode: number }> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    return { output: invalidInputOutput(err), exitCode: 1 };
  }

  // Emit warning when seller defaults
  if (!args.json && !argv.slice(2).some((a) => a.startsWith("--seller"))) {
    process.stderr.write(
      "[warn] No --seller specified, defaulting to 'source' (Plasticov). " +
        "Use --seller=source or --seller=target to be explicit.\n",
    );
  }

  let runtime: EconomicIngestionRuntime | undefined;
  let output: CliOutput;
  let exitCode = 0;

  try {
    runtime = factory(args.seller);
    switch (args.command) {
      case "ingest":
        output = await handleIngest(args, runtime);
        break;
      case "status":
        output = await handleStatus(args, runtime);
        break;
      case "coverage":
        output = await handleCoverage(args, runtime);
        break;
      case "reconcile":
        output = await handleReconcile(args, runtime);
        break;
      case "missing":
        output = await handleMissing(args, runtime);
        break;
      case "inspect-evidence":
        output = await handleInspectEvidence(args, runtime);
        break;
      default:
        output = errOutput(args, `Unknown command: ${String(args.command)}`);
    }
  } catch (err) {
    output = errOutput(args, safeEconomicErrorMessage(err));
  } finally {
    try {
      runtime?.close();
    } catch {
      // Runtime cleanup must never replace the already-sanitized CLI boundary.
    }
  }

  if (output.status === "error") {
    exitCode = 1;
  }

  return { output, exitCode };
}

async function main(): Promise<void> {
  const { output, exitCode } = await runCli(process.argv);
  emit(output, jsonRequested(process.argv));
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

// Only auto-run when executed directly, not when imported (e.g. during tests).
const isDirectExecution =
  process.argv[1]?.endsWith("economicCli.ts") || process.argv[1]?.endsWith("economicCli.js");

if (isDirectExecution) {
  void main();
}
