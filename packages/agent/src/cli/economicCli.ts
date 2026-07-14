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
 *   --run <id>               Filter by ingestion run ID (inspect-evidence)
 *   --source <id>            Filter by source record ID (inspect-evidence)
 *   --verification <v>       Filter by verification status (inspect-evidence)
 */

import { createEconomicIngestionRuntime } from "../economics/factory.js";
import type { SellerSlug, EconomicIngestionRuntime } from "../economics/factory.js";
import type { PipelineConfig } from "../economics/EconomicIngestionPipeline.js";

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
    const cmds = [...VALID_COMMANDS].join("|");
    process.stderr.write(
      `Usage: npx tsx economicCli.ts <${cmds}> [--seller=source|target] [--json]\n`,
    );
    process.exit(1);
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
    process.stderr.write(
      `Invalid seller "${seller}". Must be "source" (Plasticov) or "target" (Maustian).\n`,
    );
    process.exit(1);
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
function sanitizeForOutput(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    // Strip email patterns
    let sanitized = obj.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email]");
    // Strip potential document numbers (simple pattern)
    sanitized = sanitized.replace(/\b\d{7,10}\b/g, (m) => m.slice(0, 2) + "***");
    return sanitized;
  }
  if (Array.isArray(obj)) return obj.map(sanitizeForOutput);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Never emit secrets
      if (key.toLowerCase().includes("token") || key.toLowerCase().includes("secret")) {
        result[key] = "***REDACTED***";
        continue;
      }
      result[key] = sanitizeForOutput(value);
    }
    return result;
  }
  return obj;
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
    mode: result.run.mode,
    status: result.run.status,
    snapshotsCreated: result.snapshots.length,
    reconciliation: result.reconciliation.status,
    details: result.reconciliation.details,
  };

  if (result.run.status === "failed") {
    const isPersistenceFailure = result.reconciliation.details.includes("Persistence failed");
    return {
      status: "error",
      command: args.command,
      seller: args.seller,
      timestamp: new Date().toISOString(),
      error: isPersistenceFailure
        ? `Persistence failure: ${result.reconciliation.details}`
        : result.reconciliation.details,
    };
  }

  return okOutput(args, sanitizeForOutput(output) as Record<string, unknown>);
}

async function handleStatus(args: CliArgs, runtime: EconomicIngestionRuntime): Promise<CliOutput> {
  const lastRun = await runtime.runStore.getLastRunBySeller(runtime.health.sellerId);
  const runs = await runtime.runStore.listRunsBySeller(runtime.health.sellerId, 10);

  const result: Record<string, unknown> = {
    lastRun: lastRun
      ? {
          runId: lastRun.runId,
          mode: lastRun.mode,
          status: lastRun.status,
          startedAt: lastRun.startedAt,
          completedAt: lastRun.completedAt ?? null,
          snapshotsCreated: lastRun.snapshotsCreated,
        }
      : null,
    totalRuns: runs.length,
  };

  return okOutput(args, sanitizeForOutput(result) as Record<string, unknown>);
}

function handleCoverage(args: CliArgs, runtime: EconomicIngestionRuntime): CliOutput {
  const store = runtime.store;
  const sellerId = runtime.health.sellerId;

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
      const refundComponents = store.listCostComponents(sellerId, { type: "refund", limit: 1 });
      const returnComponents = store.listCostComponents(sellerId, { type: "return", limit: 1 });
      const hasData = refundComponents.length > 0 || returnComponents.length > 0;
      dimensions[dim] = hasData ? "complete" : "partial";
      if (hasData) hasAnyData = true;
    } else {
      const components = store.listCostComponents(sellerId, {
        type: type as never,
        limit: 1,
      });
      dimensions[dim] = components.length > 0 ? "complete" : "partial";
      if (components.length > 0) hasAnyData = true;
    }
  }

  const result: Record<string, unknown> = {
    overallStatus: hasAnyData ? "partial" : "unavailable",
    confidence: hasAnyData ? 0.7 : 0.3,
    dimensions,
  };

  return okOutput(args, sanitizeForOutput(result) as Record<string, unknown>);
}

function handleReconcile(args: CliArgs, runtime: EconomicIngestionRuntime): CliOutput {
  const store = runtime.store;
  const sellerId = runtime.health.sellerId;

  const snapshots = store.listUnitEconomicsSnapshots(sellerId, { limit: 500 });

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

  return okOutput(args, sanitizeForOutput(result) as Record<string, unknown>);
}

function handleMissing(args: CliArgs, runtime: EconomicIngestionRuntime): CliOutput {
  const store = runtime.store;
  const sellerId = runtime.health.sellerId;

  const missingInputs = store.listMissingInputs(sellerId);

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

  return okOutput(args, sanitizeForOutput(result) as Record<string, unknown>);
}

function handleInspectEvidence(args: CliArgs, runtime: EconomicIngestionRuntime): CliOutput {
  const evidenceStore = runtime.evidenceStore;
  const sellerId = runtime.health.sellerId;

  // Validate seller
  if (!sellerId) {
    return {
      status: "error",
      command: args.command,
      seller: args.seller,
      timestamp: new Date().toISOString(),
      error: "Cannot determine seller ID from runtime.",
    };
  }

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

  const evidenceRows = refs.slice(0, limit).map((ref) => ({
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

  return okOutput(args, sanitizeForOutput(result) as Record<string, unknown>);
}

// ── Seller slug validation ─────────────────────────────────────────────────

function rejectUnknownSeller(seller: string): never {
  process.stderr.write(
    `Unknown seller "${seller}". Valid sellers: source (Plasticov), target (Maustian).\n`,
  );
  process.exit(1);
}

// ── Runtime factory ────────────────────────────────────────────────────────

function createRuntime(seller: SellerSlug): EconomicIngestionRuntime {
  try {
    return createEconomicIngestionRuntime(seller);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Failed to create economic ingestion runtime: ${msg}\n`);
    process.exit(1);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function runCli(
  argv: string[],
  factory: (seller: SellerSlug) => EconomicIngestionRuntime = createRuntime,
): Promise<{ output: CliOutput; exitCode: number }> {
  const args = parseArgs(argv);

  // Validate seller
  if (!VALID_SELLER_SLUGS.has(args.seller)) {
    rejectUnknownSeller(args.seller);
  }

  // Emit warning when seller defaults
  if (!argv.slice(2).some((a) => a.startsWith("--seller"))) {
    process.stderr.write(
      "[warn] No --seller specified, defaulting to 'source' (Plasticov). " +
        "Use --seller=source or --seller=target to be explicit.\n",
    );
  }

  const runtime = factory(args.seller);
  let output: CliOutput;
  let exitCode = 0;

  try {
    switch (args.command) {
      case "ingest":
        output = await handleIngest(args, runtime);
        break;
      case "status":
        output = await handleStatus(args, runtime);
        break;
      case "coverage":
        output = handleCoverage(args, runtime);
        break;
      case "reconcile":
        output = handleReconcile(args, runtime);
        break;
      case "missing":
        output = handleMissing(args, runtime);
        break;
      case "inspect-evidence":
        output = handleInspectEvidence(args, runtime);
        break;
      default:
        output = errOutput(args, `Unknown command: ${String(args.command)}`);
    }
  } catch (err) {
    output = errOutput(args, err instanceof Error ? err.message : String(err));
  } finally {
    runtime.close();
  }

  if (output.status === "error") {
    exitCode = 1;
  }

  return { output, exitCode };
}

async function main(): Promise<void> {
  const { output, exitCode } = await runCli(process.argv);
  emit(output, parseArgs(process.argv).json);
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
