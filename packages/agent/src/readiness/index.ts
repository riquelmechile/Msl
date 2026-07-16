// Barrel — readiness module
export { assessProductionReadiness } from "./ProductionReadinessService.js";
export type { AssessReadinessInput } from "./ProductionReadinessService.js";

export { checkEnvironmentReadiness } from "./EnvironmentReadinessChecker.js";
export { checkSellerAccountReadiness } from "./SellerAccountReadinessChecker.js";
export { checkDatabaseReadiness } from "./DatabaseReadinessChecker.js";
export { checkProviderReadiness } from "./ProviderReadinessChecker.js";
export { checkRuntimeReadiness } from "./RuntimeReadinessChecker.js";
export { checkFeatureGateReadiness } from "./FeatureGateReadinessChecker.js";
export { checkSecurityReadiness } from "./SecurityReadinessChecker.js";

export {
  assertMercadoLibreWriteDisabled,
  MercadoLibreWriteBlockedError,
  assertProductionCapabilityReady,
  assertSellerCapabilityReady,
} from "./runtimeGates.js";

export { sanitizeSecret, sanitizeEnv } from "./secretSanitizer.js";

export {
  PRODUCTION_CONFIG_INVENTORY,
  getConfigByName,
  getConfigForCapability,
  getAllCapabilities,
} from "./productionConfig.js";
export type { EnvVarDescriptor, ValidationResult } from "./productionConfig.js";

export type { ReadinessContext, ReadinessCheckerFunction } from "./types.js";
