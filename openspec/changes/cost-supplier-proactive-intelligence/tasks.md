# Tasks: Cost Supplier Proactive Intelligence

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~220 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | single-pr |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

## Phase 1: Advisor Creation

- [x] 1.1 Create `packages/agent/src/conversation/costSupplierDeepSeekAdvisor.ts` — class + types + analyze()

## Phase 2: Wiring

- [x] 2.1 Add `costSupplierAdvisor` to DaemonHandler type in `daemonTypes.ts`
- [x] 2.2 Add to DaemonSchedulerConfig + pass to handler in `daemonScheduler.ts`
- [x] 2.3 Instantiate and return from createAgentLoop in `agentLoop.ts`
- [x] 2.4 Enrich costSupplierDaemon with advisor call + aiEnrichment payload

## Phase 3: Export & Tests

- [x] 3.1 Export from `packages/agent/src/index.ts`
- [x] 3.2 Run tests, verify no regression
- [x] 3.3 Write verify report
