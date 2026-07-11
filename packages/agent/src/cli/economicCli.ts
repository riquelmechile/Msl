#!/usr/bin/env npx tsx

/**
 * Economic CLI — ingests, reconciles, and reports on economic data.
 *
 * Commands:
 *   ingest     Run the economic ingestion pipeline
 *   status     Show last run status
 *   coverage   Show data coverage report
 *   reconcile  Run reconciliation
 *   missing    List missing inputs
 *
 * Flags (per-command):
 *   --seller     Seller ID (default: "plasticov")
 *   --dry-run    Dry-run mode (ingest only)
 *   --max-pages  Max pages to fetch (ingest only)
 *   --no-persist Skip persistence (ingest only)
 *   --json       Output as JSON
 */

// ── Types ──────────────────────────────────────────────────────────────────

type CliArgs = {
  command: "ingest" | "status" | "coverage" | "reconcile" | "missing";
  sellerId: string;
  dryRun: boolean;
  maxPages: number;
  noPersist: boolean;
  json: boolean;
};

type CliOutput = {
  status: "ok" | "error";
  command: string;
  sellerId: string;
  timestamp: string;
  result?: Record<string, unknown>;
  error?: string;
};

// ── Argument parsing ───────────────────────────────────────────────────────

function parseArgs(raw: string[]): CliArgs {
  const args = raw.slice(2);
  const command = args[0] as CliArgs["command"] | undefined;

  if (!command || !["ingest", "status", "coverage", "reconcile", "missing"].includes(command)) {
    const msg = `Usage: npx tsx economicCli.ts <ingest|status|coverage|reconcile|missing> [--seller=<id>] [--json]`;
    process.stderr.write(msg + "\n");
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
        // Check if next arg is a value (not a flag)
        if (i + 1 < args.length && !args[i + 1]!.startsWith("--")) {
          flags[key] = args[i + 1]!;
          i++;
        } else {
          flags[key] = "true";
        }
      }
    }
  }

  return {
    command,
    sellerId: flags.seller ?? "plasticov",
    dryRun: flags["dry-run"] === "true" || flags["dry-run"] === "",
    maxPages: parseInt(flags["max-pages"] ?? "5", 10),
    noPersist: flags["no-persist"] === "true" || flags["no-persist"] === "",
    json: flags.json === "true" || flags.json === "",
  };
}

// ── Output helpers ─────────────────────────────────────────────────────────

function okOutput(args: CliArgs, result: Record<string, unknown>): CliOutput {
  return {
    status: "ok",
    command: args.command,
    sellerId: args.sellerId,
    timestamp: new Date().toISOString(),
    result,
  };
}

function errOutput(args: CliArgs, error: string): CliOutput {
  return {
    status: "error",
    command: args.command,
    sellerId: args.sellerId,
    timestamp: new Date().toISOString(),
    error,
  };
}

function emit(output: CliOutput, useJson: boolean): void {
  if (useJson) {
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  } else {
    const emoji = output.status === "ok" ? "✅" : "❌";
    process.stdout.write(`${emoji} ${output.command} for ${output.sellerId}\n`);
    if (output.status === "error") {
      process.stdout.write(`   Error: ${output.error}\n`);
    } else if (output.result) {
      for (const [key, value] of Object.entries(output.result)) {
        process.stdout.write(`   ${key}: ${JSON.stringify(value)}\n`);
      }
    }
  }
}

// ── Command handlers (stubs) ───────────────────────────────────────────────

function handleIngest(args: CliArgs): CliOutput {
  // Stub implementation — real implementation would call runEconomicIngestion
  const result: Record<string, unknown> = {
    runId: `run-stub-${Date.now()}`,
    mode: args.dryRun ? "dry-run" : "incremental",
    sellerId: args.sellerId,
    maxPages: args.maxPages,
    noPersist: args.noPersist,
    message: "Ingestion pipeline stub. Real implementation requires EconomicOutcomeStore and DataFetcher.",
  };

  return okOutput(args, result);
}

function handleStatus(args: CliArgs): CliOutput {
  const result: Record<string, unknown> = {
    lastRun: null,
    totalRuns: 0,
    message: "Status stub. Real implementation queries the store for last EconomicIngestionRun.",
  };

  return okOutput(args, result);
}

function handleCoverage(args: CliArgs): CliOutput {
  const dimensions: Record<string, string> = {};
  for (const dim of [
    "revenue",
    "marketplace_fee",
    "shipping",
    "seller_discount",
    "refund_return",
    "advertising",
    "product_cost",
    "landed_cost",
  ]) {
    dimensions[dim] = "unverifiable";
  }

  const result: Record<string, unknown> = {
    overallStatus: "partial",
    confidence: 0.5,
    dimensions,
    message: "Coverage stub. Real implementation analyzes EconomicCostComponent coverage.",
  };

  return okOutput(args, result);
}

function handleReconcile(args: CliArgs): CliOutput {
  const result: Record<string, unknown> = {
    status: "incomplete",
    details: "Reconciliation stub. Real implementation compares source totals vs computed snapshots.",
  };

  return okOutput(args, result);
}

function handleMissing(args: CliArgs): CliOutput {
  const missing = [
    "product_cost",
    "landed_cost",
    "financing",
    "tax",
    "packaging",
  ];

  const result: Record<string, unknown> = {
    missingInputs: missing,
    count: missing.length,
    message: "Missing inputs stub. Shows declared missing CostComponentType values.",
  };

  return okOutput(args, result);
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv);

  let output: CliOutput;
  try {
    switch (args.command) {
      case "ingest":
        output = handleIngest(args);
        break;
      case "status":
        output = handleStatus(args);
        break;
      case "coverage":
        output = handleCoverage(args);
        break;
      case "reconcile":
        output = handleReconcile(args);
        break;
      case "missing":
        output = handleMissing(args);
        break;
      default:
        output = errOutput(args, `Unknown command: ${String(args.command)}`);
    }
  } catch (err) {
    output = errOutput(args, err instanceof Error ? err.message : String(err));
  }

  emit(output, args.json);
}

main();
