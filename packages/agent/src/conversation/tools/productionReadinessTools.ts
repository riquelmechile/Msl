import type { ToolDefinition } from "./types.js";
import { safeString } from "./types.js";
import { assessProductionReadiness } from "../../readiness/ProductionReadinessService.js";

/**
 * Create the inspect_production_readiness CEO tool.
 *
 * Read-only tool that returns a sanitized production readiness report.
 * No HTTP calls, no business mutations, no real credentials exposed.
 */
export function createInspectProductionReadinessTool(
  env: Record<string, string | undefined> = process.env,
): ToolDefinition {
  return {
    name: "inspect_production_readiness",
    description:
      "Inspect MSL production readiness. Returns a sanitized readiness report with " +
      "capabilities, seller status, blockers, and remediation. " +
      "Read-only — no external mutations are executed. " +
      "Report is generated from environment variables, filesystem paths, and configuration — " +
      "NO HTTP calls are made, NO credentials are leaked.",
    parameters: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          description:
            "Optional capability filter. If provided, returns only the status for that capability. " +
            "Examples: deepseek-reasoning, mercadolibre-read-plasticov, creative-studio, telegram-ceo.",
        },
        sellerId: {
          type: "string",
          description:
            "Optional seller filter. If provided, returns only the report for that seller. " +
            "Values: plasticov, maustian.",
        },
      },
      required: [],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const report = assessProductionReadiness({
        runtimeMode: env.MSL_RUNTIME_MODE || "development",
        sellers: {
          plasticov: env.MERCADOLIBRE_SOURCE_SELLER_ID || "plasticov",
          maustian: env.MERCADOLIBRE_TARGET_SELLER_ID || "maustian",
        },
        env,
      });

      const capabilityFilter = safeString(args.capability) || undefined;
      const sellerFilter = safeString(args.sellerId) || undefined;

      // Filter by seller
      let sellerReports = report.sellerReports;
      if (sellerFilter) {
        sellerReports = sellerReports.filter((s) => s.sellerId === sellerFilter);
      }

      // Filter by capability
      if (capabilityFilter) {
        const capStatus = report.capabilities[capabilityFilter as keyof typeof report.capabilities];
        const capBlockers = report.blockers.filter((b) => b.capability === capabilityFilter);
        const capWarnings = report.warnings.filter((w) => w.capability === capabilityFilter);

        return {
          capability: capabilityFilter,
          status: capStatus ?? "not-applicable",
          blockers: capBlockers.map((b) => ({
            checkId: b.checkId,
            safeMessage: b.safeMessage,
            remediation: b.remediation,
            severity: b.severity,
          })),
          warnings: capWarnings.map((w) => ({
            checkId: w.checkId,
            safeMessage: w.safeMessage,
            remediation: w.remediation,
            severity: w.severity,
          })),
          noExternalMutationExecuted: true,
        };
      }

      // Full report (sanitized)
      return {
        overallStatus: report.overallStatus,
        runtimeMode: report.runtimeMode,
        generatedAt: report.generatedAt,
        readyCapabilities: report.readyCapabilities,
        disabledCapabilities: report.disabledCapabilities,
        blockers: report.blockers.map((b) => ({
          checkId: b.checkId,
          capability: b.capability,
          safeMessage: b.safeMessage,
          remediation: b.remediation,
          severity: b.severity,
          sellerId: b.sellerId,
        })),
        warnings: report.warnings.map((w) => ({
          checkId: w.checkId,
          capability: w.capability,
          safeMessage: w.safeMessage,
          remediation: w.remediation,
          severity: w.severity,
          sellerId: w.sellerId,
        })),
        sellerReports: sellerReports.map((s) => ({
          sellerId: s.sellerId,
          accountName: s.accountName,
          overallStatus: s.overallStatus,
          oauthBinding: s.oauthBinding
            ? {
                configured: s.oauthBinding.configured,
                hasClientId: s.oauthBinding.hasClientId,
                hasClientSecret: s.oauthBinding.hasClientSecret,
                hasRedirectUri: s.oauthBinding.hasRedirectUri,
                isPlaceholder: s.oauthBinding.isPlaceholder,
              }
            : null,
          encryptionReadiness: {
            keyPresent: s.encryptionReadiness.keyPresent,
            isInsecureDevFallback: s.encryptionReadiness.isInsecureDevFallback,
          },
        })),
        remediationPlan: report.remediationPlan,
        noExternalMutationExecuted: true,
      };
    },
  };
}
