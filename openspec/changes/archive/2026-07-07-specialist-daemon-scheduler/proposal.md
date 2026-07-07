# Proposal: Specialist Daemon Scheduler

## Intent

MSL agents don't wake up autonomously. A single background ingestion worker does everything. Specialist agents (market-catalog, cost-supplier, creative-commercial, operations) need scheduled daemons that poll `agent_message_bus`, investigate operational evidence, and propose to the CEO — `noMutationExecuted: true`.

## Scope

### In Scope
- `AgentDaemonScheduler` — interval loop: reads pending per-agent messages, claims, dispatches to daemon
- `marketCatalogDaemon` — absorbs `runQualityChecks()`/`runRelistChecks()` from background ingestion; low-visit, off-market pricing, Plasticov↔Maustian gaps, listing scores
- `operationsManagerDaemon` — new claims, unanswered questions, critical messages, delayed orders, reputation risks
- `costSupplierDaemon` — margin viability, cost/supplier deltas, restock signals
- `creativeCommercialDaemon` — high-visit/low-conversion, stagnant stock, creative candidates
- `noMutationExecuted: true` — investigate + enqueue proposal, never publish

### Out of Scope
- Deep evidence extensions (PR 3), consensus reviews (PR 5), process separation (PR 7)
- Modifying background ingestion (daemons absorb quality/relist, nothing else changes)

## Capabilities

### New Capabilities
- `daemon-scheduler`: poll-dispatch loop with lifecycle, agent-to-daemon routing, per-agent interval
- `specialist-daemons`: four investigation workers reading operational evidence, enqueuing CEO proposals

### Modified Capabilities
- `agent-message-bus`: no schema change. Daemons use existing `claimNext`/`enqueue`/`resolve`/`fail`.
- `multi-agent-orchestration`: daemon lifecycle, scheduler coordination, agents-waking-up

## Approach

1. **Scheduler** (`daemonScheduler.ts`): `startDaemonScheduler()` — maps `listCompanyAgents()` to daemon handlers. On tick: `claimNext` per agent, route by `messageType`, dispatch. On result: `resolve` or `fail`.
2. **Daemons** (4 files under `daemons/`): each exports `investigate(claim): Promise<DaemonResult>`. Queries `OperationalReadModelReader` + `GraphEngine`. Enqueues proposal to `receiverAgentId: "ceo"`.
3. **Eviction**: quality/relist functions removed from `backgroundIngestion.ts`; absorbed by `marketCatalogDaemon`.
4. **Engine**: no new API calls. All reads from existing `listSnapshots`, `findEvidence`, Cortex `queryByMetadata`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `conversation/daemonScheduler.ts` | New | Scheduler loop |
| `conversation/daemons/{marketCatalog,operationsManager,costSupplier,creativeCommercial}.ts` | New | 4 daemon workers |
| `conversation/backgroundIngestion.ts` | Modified | Remove quality/relist phases |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 4 daemons → code volume challenge under 800-line budget | Medium | Shared `DaemonResult` type + evidence helper. Each daemon ~120-180 lines. |
| Daemon/ingestion overlap on same data | Low | Daemons read-only; ingestion writes. No contention. |
| Message bus saturation from rapid daemon proposals | Low | Dedupe keys prevent duplicate proposals; interval-gated dispatch |

## Rollback Plan

- Remove `daemonScheduler.ts` + `daemons/` directory
- Revert quality/relist removal in background ingestion
- No schema migration to undo

## Dependencies

All exist: `agentMessageBusStore`, `OperationalReadModelReader`, `GraphEngine`, `listCompanyAgents`. No new packages.

## Success Criteria

- [ ] Scheduler wakes daemons, reads pending per-agent, dispatches correctly
- [ ] Each daemon queries operational evidence, enqueues CEO proposal with `noMutationExecuted: true`
- [ ] `runQualityChecks()`/`runRelistChecks()` absorbed by marketCatalogDaemon
- [ ] Daemon lifecycle: start/stop, configurable intervals
- [ ] `npm test && npm run typecheck` passes
