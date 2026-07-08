# Proposal: Cost Supplier Proactive Intelligence

## Intent

costSupplierDaemon currently detects margin, below-cost, and restock signals via rule-only logic. It lacks AI enrichment (like creative-assets and operations-manager daemons have). Add a `CostSupplierDeepSeekAdvisor` that analyzes margin/cost findings, detects cost anomalies, pricing patterns, and priority actions — enriching CEO proposals with actionable intelligence.

## Scope

### In Scope
- Create `CostSupplierDeepSeekAdvisor` class (following CatalogDeepSeekAdvisor pattern)
- Wire advisor through daemonTypes → daemonScheduler → createAgentLoop
- Pass `costSupplierAdvisor` into costSupplierDaemon handler, add AI enrichment block
- Enrich CEO proposal payloads with `aiEnrichment` for critical and warning signals
- Export advisor from index.ts

### Out of Scope
- New daemon signals beyond current rule checks
- Changes to market-catalog, operations-manager, or other daemons
- UI or dashboard changes

## Capabilities

### Modified Capabilities
- `specialist-daemons`: costSupplierDaemon requirement updated to include AI enrichment via CostSupplierDeepSeekAdvisor
- `daemon-scheduler`: scheduler config updated to accept and pass a new advisor type

## Approach

Mirror the proven advisor pattern: `OperationsDeepSeekAdvisor` / `CatalogDeepSeekAdvisor` → new `CostSupplierDeepSeekAdvisor` with a `analyze()` method that takes actionable cost/margin findings and returns enrichment findings via DeepSeek reasoning. Wire through the existing dependency injection chain: `daemonTypes.ts` (type) → `daemonScheduler.ts` (config + passing) → `createAgentLoop` (instantiation + return) → `costSupplierDaemon.ts` (usage + payload enrichment).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/costSupplierDeepSeekAdvisor.ts` | New | Advisor class with types |
| `packages/agent/src/workers/daemonTypes.ts` | Modify | Add costSupplierAdvisor type |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Wire new advisor |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Instantiate and return advisor |
| `packages/agent/src/workers/costSupplierDaemon.ts` | Modify | AI enrichment block |
| `packages/agent/src/index.ts` | Modify | Export new advisor |
| `openspec/changes/cost-supplier-proactive-intelligence/` | New | SDD artifacts |
| `openspec/specs/specialist-daemons/spec.md` | Modify | Delta spec update |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| DeepSeek API cost for enrichment | Low | Advisor follows same cost-capped pattern, only runs on critical/warning findings |
| Advisor failure breaks daemon | Low | Enrichment wrapped in try/catch; falls back to rule-only |

## Rollback Plan

Revert code changes to the 6 files. The SDD change folder archives for audit trail.

## Dependencies

- Existing `DeepSeekReasoningGateway` and `WorkforceCostCacheLedgerStore`
- Existing advisor pattern in `CatalogDeepSeekAdvisor`, `OperationsDeepSeekAdvisor`

## Success Criteria

- [ ] costSupplierDaemon enriches critical/warning proposals with `aiEnrichment` payload
- [ ] createAgentLoop returns `costSupplierDeepSeekAdvisor` alongside existing advisors
- [ ] Existing tests pass without regression
