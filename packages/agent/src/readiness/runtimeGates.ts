import type {
  ProductionCapability,
  ProductionReadinessReport,
  RuntimeGatePolicy,
} from "./types.js";
export { assertMercadoLibreWriteDisabled, MercadoLibreWriteBlockedError } from "@msl/mercadolibre";

// ── Production Capability Gates ────────────────────────────────────

/**
 * Assert that a production capability is ready before allowing operations.
 *
 * In development/test mode, this is a no-op to preserve mocks and local flows.
 * In production mode:
 *   - `blocked`  → throws (process must not continue)
 *   - `degraded` → logs WARN and allows the process to start
 *   - `ready` / `not-applicable` → no action
 *
 * @throws {Error} if the capability is blocked in production mode
 */
export function assertProductionCapabilityReady(
  capability: ProductionCapability,
  sellerId: string | undefined,
  report: ProductionReadinessReport,
  policy: RuntimeGatePolicy,
): void {
  if (policy.runtimeMode !== "production") {
    // Dev/test preserves mocks — no blocking
    return;
  }

  const capStatus = report.capabilities[capability];
  if (capStatus === "blocked") {
    const blockers = report.blockers.filter((b) => b.capability === capability);
    const messages = blockers.map((b) => b.safeMessage).join("; ");
    throw new Error(
      `Production capability "${capability}" is blocked: ${messages || "No details available."}`,
    );
  }

  if (capStatus === "degraded") {
    const warnings = report.warnings.filter(
      (w) => w.capability === capability && w.status === "degraded",
    );
    const messages = warnings.map((w) => w.safeMessage).join("; ");
    console.warn(
      `Production capability "${capability}" is degraded: ${messages || "No details available."}`,
    );
    // Degraded capabilities do NOT block the process.
    return;
  }
}

/**
 * Assert that a seller-specific capability is ready.
 * Same behavior as assertProductionCapabilityReady but scoped to a seller.
 *
 * @throws {Error} if the capability is blocked in production mode
 */
export function assertSellerCapabilityReady(
  capability: ProductionCapability,
  sellerId: string,
  report: ProductionReadinessReport,
  policy: RuntimeGatePolicy,
): void {
  if (policy.runtimeMode !== "production") return;

  // Check seller report
  const sellerReport = report.sellerReports.find((s) => s.sellerId === sellerId);
  if (!sellerReport) {
    throw new Error(`No readiness report found for seller "${sellerId}".`);
  }

  const capStatus = sellerReport.capabilities[capability];
  if (capStatus === "blocked") {
    const sellerBlockers = sellerReport.checks.filter(
      (c) => c.capability === capability && c.status === "blocked",
    );
    const messages = sellerBlockers.map((b) => b.safeMessage).join("; ");
    throw new Error(
      `Seller "${sellerId}" capability "${capability}" is blocked: ${messages || "No details available."}`,
    );
  }

  if (capStatus === "degraded") {
    const sellerWarnings = sellerReport.checks.filter(
      (c) => c.capability === capability && c.status === "degraded",
    );
    const messages = sellerWarnings.map((w) => w.safeMessage).join("; ");
    console.warn(
      `Seller "${sellerId}" capability "${capability}" is degraded: ${messages || "No details available."}`,
    );
    // Degraded capabilities do NOT block the process.
    return;
  }
}
