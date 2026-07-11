import type { ProductionCapability, ProductionReadinessReport, RuntimeGatePolicy } from "./types.js";

/**
 * Assert that a production capability is ready before allowing operations.
 *
 * In development/test mode, this is a no-op to preserve mocks and local flows.
 * In production mode, this throws if the capability is blocked.
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
}

/**
 * Assert that a seller-specific capability is ready.
 * Same behavior as assertProductionCapabilityReady but scoped to a seller.
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
}
