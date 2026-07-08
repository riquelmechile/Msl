# Tasks: Supplier Manager Daemon

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

| Field | Value |
|-------|-------|
| Estimated changed lines | ~596 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 |
| Delivery strategy | auto-forecast |
| Chain strategy | stacked-to-main (cached) |

### Suggested Work Units

| Unit | Goal | Likely PR | Base | Notes |
|------|------|-----------|------|-------|
| 1 | Foundation types + lane + daemon scaffold + scheduler wiring + barrel export | PR 1 | `main` | ~80 LOC; compiles standalone |
| 2 | Full daemon handler (3 signals + dedupe + CEO enqueue) + test suite | PR 2 | `main` | ~540 LOC; includes all tests |

## Phase 1: Foundation

- [x] 1.1 `daemonTypes.ts` — Add `supplierMirrorStore?: SupplierMirrorStore` to `DaemonHandler` input
- [x] 1.2 `lanes.ts` — Add `"supplier-manager"` to `LaneId` union; create `SUPPLIER_MANAGER_LANE` contract (operations, supply-chain health)
- [x] 1.3 `lanes.ts` — Register `SUPPLIER_MANAGER_LANE` in `LANE_CONTRACTS`, export contract
- [x] 1.4 `companyAgents.ts` — Map `"supplier-manager" → "operations"` in `laneDepartments`
- [x] 1.5 `supplierManagerDaemon.ts` — Create scaffold: export `DaemonHandler`, early return empty findings when store absent
- [x] 1.6 `daemonScheduler.ts` — Add `supplierMirrorStore` to `DaemonSchedulerConfig`; pass to handler dispatch; add `"supplier-manager": supplierManagerDaemon` to handler map
- [x] 1.7 `index.ts` — Export `supplierManagerDaemon`

## Phase 2: Core Implementation

- [x] 2.1 `supplierManagerDaemon.ts` — Implement stock discrepancy detection: iterate suppliers → items → mappings → Cortex listing snapshots → critical finding when one seller has stock>0 and another=0
- [x] 2.2 `supplierManagerDaemon.ts` — Implement price change detection: compare `item.price` vs ledger prior via `getLedgerByIdempotencyKey` → warning finding on >5% delta; skip on single observation
- [x] 2.3 `supplierManagerDaemon.ts` — Implement unfilled mirror detection: warning finding when `!item.mlItemId && mappings.length === 0`
- [x] 2.4 `supplierManagerDaemon.ts` — Implement idempotency dedupe: key `{kind}_{supplierId}_{itemId}_{hourKey}`, check via `getLedgerByIdempotencyKey`, record via `appendLedger`
- [x] 2.5 `supplierManagerDaemon.ts` — Implement CEO proposal enqueue: payload with `{ type:"proposal", summary, findings, recommendedAction, capturedAt, noMutationExecuted: true }`, grouped by severity tier

## Phase 3: Testing

- [x] 3.1 `supplierManagerDaemon.test.ts` — Test stock discrepancy: stock>0 vs =0 → critical finding with both seller IDs; all stock>0 → no finding
- [x] 3.2 `supplierManagerDaemon.test.ts` — Test price change: >5% delta → warning with old/new price; ≤5% → no finding; single observation → no finding
- [x] 3.3 `supplierManagerDaemon.test.ts` — Test unfilled mirror: no mlItemId + no mappings → warning; mlItemId set → no finding
- [x] 3.4 `supplierManagerDaemon.test.ts` — Test graceful degrade: undefined store → empty findings, `proposalEnqueued: false`, no error
- [x] 3.5 `supplierManagerDaemon.test.ts` — Test dedupe: ledger key exists → skipped; no match → enqueued + ledger appended
- [x] 3.6 `supplierManagerDaemon.test.ts` — Test partial Cortex: one seller missing listing snapshot → other sellers unaffected
