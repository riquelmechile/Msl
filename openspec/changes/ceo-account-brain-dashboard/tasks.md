# Tasks: CEO Account Brain Dashboard

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 550–600 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (service + types + tests) → PR 2 (tools + integration + docs + verify) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | AccountBrainService + types + 14 service tests | PR 1 | base = feature branch; independently testable via `npm test` |
| 2 | Tool factories + tool tests + agent loop registration + barrel exports + docs + full verify | PR 2 | base = PR 1 branch; no PR 1 diff leaks |

## Phase 1: Service Foundation

- [x] 1.1 Create `packages/agent/src/conversation/accountBrainService.ts` with `AccountBrainService` class — constructor injecting 5 optional stores (`AccountAssetStore`, `AgentWorkSessionStore`, `WorkforceCostCacheLedgerStore`, `CeoInboxStore`, `GraphEngine`), `getAccountBrainStatus(sellerId, options?)` and `compareAccountAssets(input)` methods, seller isolation on every store query, graceful degradation returning `"unavailable"` per field, `noMutationExecuted: true`
- [x] 1.2 Define `AccountBrainStatus`, `AccountBrainStatusInput`, `CompareAccountAssetsInput`, `AccountAssetComparison` types inline in the service file; include `requiresApproval: true` and confidence fields on comparison output
- [x] 1.3 Implement scoring algorithm in `compareAccountAssets`: weighted multi-factor (capability match 0.25, health 0.20, risk-inverted 0.20, profit goal 0.20, opportunity fit 0.10, cost load 0.05) with goal-driven weight adjustment; score delta <5 → low confidence + `collect_more_evidence`
- [x] 1.4 Create `packages/agent/src/conversation/accountBrainService.test.ts` with ≥14 Vitest tests using in-memory SQLite: full account data with capabilities, missing account returns `missing_account_asset`, Plasticov data isolated from Maustian, global memory marked `"global"`, health snapshot used for status, critical risks surface in recommendedFocus, high-confidence opportunities surface in recommendedFocus, work sessions aggregated into status, cost/cache per seller, pending approvals per seller, compare ranks two accounts, missing capabilities lower score, critical risk lowers score, goal-driven weighting (`grow_reputation`, `maximize_profit`)

## Phase 2: Tool Definitions

- [ ] 2.1 Create `packages/agent/src/conversation/tools/accountBrainTools.ts` with `createGetAccountBrainStatusTool(service?)` and `createCompareAccountAssetsTool(service?)` factory functions following `agentWorkStatusTool.ts` pattern (`ToolDefinition` with `execute` returning `Record<string, unknown>`); undefined service returns `"unavailable"` + `noMutationExecuted: true`
- [ ] 2.2 Create `packages/agent/src/conversation/tools/accountBrainTools.test.ts` with ≥6 Vitest tests: both tools return `noMutationExecuted: true`, no DeepSeek calls, no MercadoLibre writes, unavailable path when service is undefined, seller isolation in tool output

## Phase 3: Integration & Wiring

- [ ] 3.1 Add `export * from "./accountBrainTools.js"` to `packages/agent/src/conversation/tools/index.ts`
- [ ] 3.2 Export `AccountBrainService` class, `createGetAccountBrainStatusTool`, `createCompareAccountAssetsTool`, and types from `packages/agent/src/index.ts`
- [ ] 3.3 Add `accountBrainService?: AccountBrainService` property to `AgentLoopConfig` in `packages/agent/src/conversation/agentLoop.ts`
- [ ] 3.4 Register `get_account_brain_status` and `compare_account_assets` conditionally in `createAgentLoop` using existing pattern: `config.accountBrainService && toolMap.set("tool_name", createTool(config.accountBrainService))`
- [ ] 3.5 Create `docs/architecture/ceo-account-brain-dashboard.md` with architecture overview: service diagram, store dependencies, scoring algorithm, and seller isolation guarantees

## Phase 4: Final Verification

- [ ] 4.1 Run `npm run format:check && npm run typecheck && npm run lint && npm test`
- [ ] 4.2 Run `npm run build && npm run test:e2e && npm run check:production-secrets`
