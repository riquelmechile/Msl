# Tasks: Production Readiness Control Plane

## Phase 1 — Domain Types
- [x] 1.1 Create `packages/domain/src/productionReadiness.ts` with all types
- [x] 1.2 Export from `packages/domain/src/index.ts`
- [x] 1.3 Create `packages/domain/src/productionReadiness.test.ts` with factory tests

## Phase 2 — Configuration Inventory
- [x] 2.1 Create `packages/agent/src/readiness/productionConfig.ts` with config matrix
- [x] 2.2 Build map from process.env to capabilities with sensitivity
- [x] 2.3 Create `packages/agent/src/readiness/productionConfig.test.ts`

## Phase 3 — Readiness Checkers
- [x] 3.1 Create `packages/agent/src/readiness/EnvironmentReadinessChecker.ts`
- [x] 3.2 Create `packages/agent/src/readiness/SellerAccountReadinessChecker.ts`
- [x] 3.3 Create `packages/agent/src/readiness/DatabaseReadinessChecker.ts`
- [x] 3.4 Create `packages/agent/src/readiness/ProviderReadinessChecker.ts`
- [x] 3.5 Create `packages/agent/src/readiness/RuntimeReadinessChecker.ts`
- [x] 3.6 Create `packages/agent/src/readiness/FeatureGateReadinessChecker.ts`
- [x] 3.7 Create `packages/agent/src/readiness/SecurityReadinessChecker.ts`
- [x] 3.8 Create `packages/agent/src/readiness/ProductionReadinessService.ts` (orchestrator)
- [x] 3.9 Create tests for all checkers

## Phase 4 — Fail-Closed Gates
- [x] 4.1 Create `packages/agent/src/readiness/runtimeGates.ts`
- [x] 4.2 Tests: dev preserves mocks, prod blocks blocked, approval gate remains

## Phase 5 — CLI
- [x] 5.1 Create `packages/agent/src/readiness/cli.ts`
- [x] 5.2 Add `"production:readiness": "..." at package.json root
- [x] 5.3 Tests: human output, --json, --strict, exit codes, redaction

## Phase 6 — CEO Tool
- [x] 6.1 Create `inspect_production_readiness` tool
- [x] 6.2 Register in MCP tools
- [x] 6.3 Tests: full report, filtered, noExternalMutationExecuted: true

## Phase 7 — Secret Sanitizer
- [x] 7.1 Create `packages/agent/src/readiness/secretSanitizer.ts`
- [x] 7.2 Tests: API keys, tokens, secrets, NEXT_PUBLIC detection
