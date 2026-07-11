// ── Readiness status ─────────────────────────────────────────────────

export type ReadinessStatus = "ready" | "degraded" | "blocked" | "not-applicable";
export type ReadinessSeverity = "info" | "warning" | "critical";

// ── Production capabilities ──────────────────────────────────────────

export type ProductionCapability =
  | "deepseek-reasoning"
  | "telegram-ceo"
  | "mercadolibre-read-plasticov"
  | "mercadolibre-read-maustian"
  | "mercadolibre-write-plasticov"
  | "mercadolibre-write-maustian"
  | "operational-ingestion"
  | "economic-truth"
  | "economic-learning"
  | "creative-studio"
  | "supplier-mirror"
  | "owned-ecommerce"
  | "mcp-server"
  | "web-chat"
  | "background-workers"
  | "daemon-scheduler";

// ── Config metadata ──────────────────────────────────────────────────

export type ConfigSensitivity = "public" | "conditional" | "secret" | "critical-secret";
export type ConfigValidation = "filled" | "missing" | "placeholder" | "malformed" | "next-public-exposed";

// ── Readiness check result ───────────────────────────────────────────

export type ReadinessCheckResult = {
  checkId: string;
  capability: ProductionCapability;
  sellerId?: string;
  status: ReadinessStatus;
  severity: ReadinessSeverity;
  reasonCode: string;
  safeMessage: string;
  remediation: string;
  checkedAt: string; // ISO-8601
  metadata: Record<string, string>;
  /** Indicates this check executes zero external mutations. Always true. */
  noMutationExecuted: true;
};

// ── OAuth readiness ──────────────────────────────────────────────────

export type OAuthReadiness = {
  configured: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasRedirectUri: boolean;
  tokenStorePath?: string;
  isPlaceholder: boolean;
};

// ── Encryption readiness ─────────────────────────────────────────────

export type EncryptionReadiness = {
  keyPresent: boolean;
  isPlaceholder: boolean;
  isInsecureDevFallback: boolean;
};

// ── Seller readiness report ──────────────────────────────────────────

export type SellerReadinessReport = {
  sellerId: string;
  accountName: string;
  overallStatus: ReadinessStatus;
  capabilities: Record<string, ReadinessStatus>;
  oauthBinding: OAuthReadiness | null;
  encryptionReadiness: EncryptionReadiness;
  checks: ReadinessCheckResult[];
};

// ── Production readiness report ──────────────────────────────────────

export type ProductionReadinessReport = {
  reportId: string;
  runtimeMode: string;
  overallStatus: ReadinessStatus;
  generatedAt: string; // ISO-8601
  commitSha?: string;
  capabilities: Record<ProductionCapability, ReadinessStatus>;
  sellerReports: SellerReadinessReport[];
  blockers: ReadinessCheckResult[];
  warnings: ReadinessCheckResult[];
  readyCapabilities: ProductionCapability[];
  disabledCapabilities: ProductionCapability[];
  remediationPlan: string[];
  /** Indicates this report was generated without external mutations. Always true. */
  noMutationExecuted: true;
};

// ── Runtime gates ────────────────────────────────────────────────────

export type RuntimeGatePolicy = {
  runtimeMode: string;
};

// ── Factory functions ────────────────────────────────────────────────

export function createReadinessCheckResult(
  overrides: Partial<ReadinessCheckResult> & Pick<ReadinessCheckResult, "checkId" | "capability" | "status">,
): ReadinessCheckResult {
  return {
    safeMessage: "",
    remediation: "",
    checkedAt: new Date().toISOString(),
    metadata: {},
    severity: severityForStatus(overrides.status),
    reasonCode: overrides.reasonCode ?? overrides.checkId,
    noMutationExecuted: true,
    ...overrides,
  };
}

export function createProductionReadinessReport(
  overrides: Partial<ProductionReadinessReport> & Pick<ProductionReadinessReport, "runtimeMode">,
): ProductionReadinessReport {
  return {
    reportId: `readiness-${Date.now().toString(36)}`,
    overallStatus: "not-applicable",
    generatedAt: new Date().toISOString(),
    capabilities: {} as Record<ProductionCapability, ReadinessStatus>,
    sellerReports: [],
    blockers: [],
    warnings: [],
    readyCapabilities: [],
    disabledCapabilities: [],
    remediationPlan: [],
    noMutationExecuted: true,
    ...overrides,
  };
}

export function createSellerReadinessReport(
  overrides: Partial<SellerReadinessReport> & Pick<SellerReadinessReport, "sellerId" | "accountName">,
): SellerReadinessReport {
  return {
    overallStatus: "not-applicable",
    capabilities: {},
    oauthBinding: null,
    encryptionReadiness: { keyPresent: false, isPlaceholder: false, isInsecureDevFallback: false },
    checks: [],
    ...overrides,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

export function severityForStatus(status: ReadinessStatus): ReadinessSeverity {
  if (status === "blocked") return "critical";
  if (status === "degraded") return "warning";
  return "info";
}

export function worstStatus(a: ReadinessStatus, b: ReadinessStatus): ReadinessStatus {
  const rank: Record<ReadinessStatus, number> = {
    "not-applicable": 0,
    ready: 1,
    degraded: 2,
    blocked: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}
