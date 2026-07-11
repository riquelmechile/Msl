#!/usr/bin/env node
import { assessProductionReadiness } from "./ProductionReadinessService.js";

const args = process.argv.slice(2);
const useJson = args.includes("--json");
const strict = args.includes("--strict");

const report = assessProductionReadiness({
  runtimeMode: process.env.MSL_RUNTIME_MODE || "development",
  sellers: {
    plasticov: process.env.MERCADOLIBRE_SOURCE_SELLER_ID || "plasticov",
    maustian: process.env.MERCADOLIBRE_TARGET_SELLER_ID || "maustian",
  },
  env: process.env,
});

if (useJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const lines: string[] = [];

  lines.push("");
  lines.push(`📋 Production Readiness Report`);
  lines.push(`   Overall: ${report.overallStatus.toUpperCase()}`);
  lines.push(`   Runtime: ${report.runtimeMode}`);
  lines.push(`   Date: ${report.generatedAt}`);
  lines.push("");
  lines.push(`   Blockers (${report.blockers.length}):`);
  for (const b of report.blockers) {
    lines.push(`   ❌ [${b.capability}] ${b.safeMessage}`);
  }
  lines.push("");
  lines.push(`   Warnings (${report.warnings.length}):`);
  for (const w of report.warnings) {
    lines.push(`   ⚠️  [${w.capability}] ${w.safeMessage}`);
  }
  lines.push("");
  lines.push(`   Ready: ${report.readyCapabilities.join(", ") || "(none)"}`);
  lines.push(`   Disabled: ${report.disabledCapabilities.join(", ") || "(none)"}`);
  if (report.remediationPlan.length > 0) {
    lines.push("");
    lines.push("   Remediation:");
    for (const r of report.remediationPlan) lines.push(`   → ${r}`);
  }
  lines.push("");

  process.stdout.write(`${lines.join("\n")}\n`);
}

const exitCode =
  report.overallStatus === "blocked"
    ? 1
    : strict && report.overallStatus === "degraded"
      ? 1
      : 0;
process.exit(exitCode);
