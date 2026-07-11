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
  };
};

export type ReadinessCheckerFunction = (ctx: ReadinessContext) => ReadinessCheckResult[];
