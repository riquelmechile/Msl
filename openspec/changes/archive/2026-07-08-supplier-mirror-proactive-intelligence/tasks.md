# Tasks: Proactive AI Enrichment for Stock-Gap Signals

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 200–250 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-forecast |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | All 4 phases | PR 1 (single) | ~200 lines — well under budget; tests included |

## Phase 1: Foundation

- [x] 1.1 Add `advisor?: SupplierMirrorDeepSeekAdvisor` to `DaemonHandler` input type in `daemonTypes.ts`

## Phase 2: Scheduler Wiring

- [x] 2.1 Add `advisor?: SupplierMirrorDeepSeekAdvisor` to `DaemonSchedulerConfig` in `daemonScheduler.ts`
- [x] 2.2 Pass `config.advisor` to handler input in `startDaemonScheduler()`

## Phase 3: Core Enrichment

- [x] 3.1 Import `SupplierMirrorDeepSeekAdvisor` type and destructure `advisor` from handler input in `supplierManagerDaemon.ts`
- [x] 3.2 Inject `advisor.analyze()` call after stock-gap idempotency check (`if (!existing)`) with try/catch isolation
- [x] 3.3 Build `aiEnrichment` payload from advisor response; append to CEO proposal `payloadJson` in `bus.enqueue()`

## Phase 4: Testing

- [x] 4.1 Test advisor available → stock-gap proposal includes `aiEnrichment` (mock advisor)
- [x] 4.2 Test advisor failure → rule-only proposal without `aiEnrichment`
- [x] 4.3 Test advisor absent → rule-only proposal behaves as before
- [x] 4.4 Run existing daemon tests (`tests/workers/supplierManagerDaemon.test.ts`) and verify they still pass
