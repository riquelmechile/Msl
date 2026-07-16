import type { ReadinessCheckResult } from "@msl/domain";

// Re-exports from @msl/domain for internal readiness usage
export {
  type ReadinessStatus,
  type ReadinessSeverity,
  type ProductionCapability,
  type ConfigSensitivity,
  type ConfigValidation,
  type ReadinessCheckResult,
  type ProductionReadinessReport,
  type SellerReadinessReport,
  type OAuthReadiness,
  type EncryptionReadiness,
  type RuntimeGatePolicy,
  createReadinessCheckResult,
  createProductionReadinessReport,
  createSellerReadinessReport,
  severityForStatus,
  worstStatus,
} from "@msl/domain";

// ── Internal service types ──────────────────────────────────────────

export type ReadinessContext = {
  runtimeMode: string;
  env: Record<string, string | undefined>;
  sellers: {
    plasticov: string;
    maustian: string;
  };
  /** Feature flags derived from env */
  features: {
    creativeStudioEnabled: boolean;
    supplierMirrorEnabled: boolean;
    companyAgentAdminEnabled: boolean;
    /** Whether database integrity checks run during readiness. */
    databaseIntegrityEnabled: boolean;
    /** Whether WAL health checks run during readiness. */
    walHealthEnabled: boolean;
    /** Whether the product launch pipeline is enabled. Default: true. */
    productLaunchEnabled: boolean;
  };
};

export type ReadinessCheckerFunction = (ctx: ReadinessContext) => ReadinessCheckResult[];
