# Tasks: Specialist Daemon Scheduler

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1070 |
| 800-line budget risk | Low |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (~545 lines): Foundation + marketCatalogDaemon + eviction → PR 2 (~525 lines): 3 remaining daemons + exports + tests |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Types, scheduler, lane plumbing, marketCatalog daemon, bg eviction | PR 1 | Base: main; standalone deliverable with tests |
| 2 | ops/cost/creative daemons, exports, integration tests | PR 2 | Depends on PR 1; final wiring |

## Phase 1: Shared Types + Scheduler + Lane Plumbing

- [x] 1.1 Create `packages/agent/src/workers/daemonTypes.ts` — `DaemonConfig`, `DaemonHandler`, `DaemonResult`, `DaemonFinding` per design interfaces (§Interfaces/Contracts)
- [x] 1.2 Create `packages/agent/src/workers/daemonScheduler.ts` — `startDaemonScheduler(config)`: poll loop via `setInterval`, `LaneId→handler` static map, claim-dispatch-resolve/fail lifecycle, try/catch error isolation per daemon-scheduler spec
- [x] 1.3 Add `"operations-manager"` to `LaneId` in `packages/agent/src/conversation/lanes.ts`; add `OPERATIONS_MANAGER_LANE` contract (proposal-only, boundaries) to `LANE_CONTRACTS`
- [x] 1.4 Add `"operations-manager": "operations"` to `laneDepartments` in `companyAgents.ts`
- [x] 1.5 Add `"operations-manager"` to `delegate_to_subagent` `laneId` enum in `tools.ts`

## Phase 2: marketCatalogDaemon

- [x] 2.1 Create `packages/agent/src/workers/marketCatalogDaemon.ts` — export `investigate(claim): Promise<DaemonResult>`
- [x] 2.2 Read evidence: `reader.listSnapshots(tenantId, { type: "listing_snapshot" })` + `cortex.queryByMetadata({ type: "pricing_snapshot" })` + visit snapshots
- [x] 2.3 Detect: low-visit active (< threshold) → "warning"; price > median+buffer → "warning"; paused with salesCount>0 → "info" relist candidate (absorbs `runQualityChecks`/`runRelistChecks` detection from bg ingestion)
- [x] 2.4 Enqueue: `bus.enqueue({ senderAgentId: "market-catalog", receiverAgentId: "ceo", payloadJson: { type:"proposal", summary, findings } })` — `noMutationExecuted: true`

## Phase 3: operationsManager + costSupplier + creativeCommercial Daemons

Read evidence: all daemons receive `OperationalReadModelReader` + `GraphEngine` via closure. Each detects severity-graded signals as per specialist-daemons spec.

- [x] 3.1 Create `operationsManagerDaemon.ts` — read `claim_snapshot`, `question_snapshot`, `message_snapshot`, `order_snapshot`; detect: open claim→"critical", unanswered question>deadline→"warning", delayed shipment beyond SLA→"critical"
- [x] 3.2 Create `costSupplierDaemon.ts` — read listing snapshots + Cortex cost/supplier nodes; detect: margin < targetThreshold→"critical", stock < watermark + rising visits→"info" restock
- [x] 3.3 Create `creativeCommercialDaemon.ts` — read `visit_snapshot` + order nodes; detect: visits>threshold ∧ orders/visits < threshold→"warning", active no sales > window→"info"
- [x] 3.4 All: `senderAgentId: laneId`, `receiverAgentId: "ceo"`, dedupe key per finding, `noMutationExecuted: true`

## Phase 4: Integration — Eviction, Wiring, Exports

- [x] 4.1 Remove `void runQualityChecks` and `void runRelistChecks` lines from `backgroundIngestion.ts` (functions remain unused; quality/relist absorbed by marketCatalogDaemon)
- [x] 4.2 Register all 4 daemons in scheduler handler map in `daemonScheduler.ts` (3 remaining for PR 2)
- [x] 4.3 Export `startDaemonScheduler` + daemon types from `packages/agent/src/index.ts`
- [x] 4.4 Confirm `npm run typecheck` passes (LaneId exhaustiveness in handler map, switch/if sites)

## Phase 5: Tests

Test approach: hybrid — mock `AgentMessageBusStore` for claim/resolve/fail cycle; real SQLite (`:memory:`) with pre-seeded operational snapshots + Cortex nodes for daemon evidence reads. `vi.useFakeTimers()` for scheduler interval tests.

- [x] 5.1 Scheduler: lifecycle, polling cycle, error isolation (continues on daemon throw)
- [x] 5.2 marketCatalogDaemon: seed listing/pricing/visit nodes; assert finding shape, severity, proposal enqueued with correct sender/receiver
- [x] 5.3 operationsManagerDaemon: seed claims, questions, orders; verify per-scenario severity
- [x] 5.4 costSupplierDaemon: seed pricing+stock nodes; assert margin calc, restock signal
- [x] 5.5 creativeCommercialDaemon: seed visit/order nodes; assert conversion ratio math, stagnant flag
- [x] 5.6 Integration: scheduler→marketCatalogDaemon→bus enqueue cycle with shared SQLite
- [x] 5.7 Gate: `npm test && npm run typecheck` — **661 tests pass, typecheck clean**
