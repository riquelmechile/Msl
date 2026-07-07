# Design: Specialist Daemon Scheduler

## Technical Approach

Interval-based poll-dispatch loop (`setInterval` per `startBackgroundIngestion` pattern)
that wakes company agents autonomously via the message bus. Scheduler claims pending
messages per lane agent, dispatches to matching daemon, resolves or fails. Four daemons
read operational evidence from Cortex + OperationalReadModel and enqueue CEO proposals
with `noMutationExecuted: true`. Quality/relist logic evicted from background ingestion.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Interval-based (`setInterval`) | Simpler, matches existing pattern; no event emitter plumbing | **Interval-based** |
| Event-driven (`EventEmitter`) | Tighter coupling, harder to debug backpressure | Rejected |
| Daemon map: `Record<LaneId, DaemonHandler>` | Static mapping, one handler per lane; unknown lanes skip silently | **Static map** |
| Daemon adds `OperationsManager` lane | Adds `"operations-manager"` to `LaneId`, `laneDepartments`, lane contract, and tool enum | Required by spec |
| Evidence: ORM `listSnapshots` + Cortex `queryByMetadata` | Daemons query both stores; no new API calls | **Dual-store read** |
| Error: try/catch → `fail()` on bus | Per-daemon isolation; failed message re-enters pending (up to 3 attempts); scheduler continues | **Fail-continue** |
| Testing: mock `AgentMessageBusStore` + real SQLite | Bus mock covers claim/resolve/fail; SQLite covers operational store + Cortex queries | **Hybrid mock** |

## Data Flow

```
┌──────────────────┐     claimNext("market-catalog")     ┌──────────────────┐
│ DaemonScheduler  │ ──────────────────────────────────> │ AgentMessageBus  │
│   setInterval    │ <────────────────────────────────── │  (SQLite)        │
│   15min          │     AgentMessage (or empty)        └──────────────────┘
└───────┬──────────┘
        │ dispatch
        ▼
┌──────────────────┐     listSnapshots / queryByMetadata   ┌──────────────────┐
│ marketCatalog    │ ────────────────────────────────────> │ OperationalRead  │
│ Daemon           │ <──────────────────────────────────── │ Model + Cortex   │
│                  │     findings                          │                  │
└───────┬──────────┘                                      └──────────────────┘
        │ enqueue(proposal to "ceo")
        ▼
┌──────────────────┐
│ AgentMessageBus  │  → CEO claims on next cycle
└──────────────────┘
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/workers/daemonTypes.ts` | Create | `DaemonConfig`, `DaemonResult`, `Finding`, `DaemonHandler` types |
| `packages/agent/src/workers/daemonScheduler.ts` | Create | `startDaemonScheduler()` — interval loop, lane→daemon map, error isolation |
| `packages/agent/src/workers/marketCatalogDaemon.ts` | Create | Quality/low-visit/above-market/relist detection from Cortex nodes |
| `packages/agent/src/workers/operationsManagerDaemon.ts` | Create | Open claims, unanswered questions, delayed orders, reputation alerts |
| `packages/agent/src/workers/costSupplierDaemon.ts` | Create | Margin viability, restock signals from pricing + listing snapshots |
| `packages/agent/src/workers/creativeCommercialDaemon.ts` | Create | High-visit/low-conversion, stagnant stock detection |
| `packages/agent/src/conversation/lanes.ts` | Modify | Add `"operations-manager"` to `LaneId`, new `OPERATIONS_MANAGER_LANE` contract |
| `packages/agent/src/conversation/companyAgents.ts` | Modify | Add `"operations-manager": "operations"` to `laneDepartments` |
| `packages/agent/src/conversation/tools.ts` | Modify | Add `"operations-manager"` to create-agent tool enum |
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modify | Remove `runQualityChecks()` + `runRelistChecks()` invocations from worker loop (functions remain, unused) |
| `packages/agent/src/index.ts` | Modify | Export `startDaemonScheduler` + worker types |

## Interfaces / Contracts

```ts
type DaemonHandler = (input: {
  claim: AgentMessage;
  reader: OperationalReadModelReader;
  cortex: GraphEngine;
  bus: AgentMessageBusStore;
  sellerIds: string[];
}) => Promise<DaemonResult>;

interface DaemonResult {
  findings: DaemonFinding[];
  proposalEnqueued: boolean;
  messageIds: string[];
}

interface DaemonFinding {
  severity: "info" | "warning" | "critical";
  summary: string;
  evidenceIds: string[];
}
```

Scheduler config:
```ts
type DaemonSchedulerConfig = {
  bus: AgentMessageBusStore;
  reader: OperationalReadModelReader;
  cortex: GraphEngine;
  sellerIds: string[];
  intervalMs?: number; // default 15 minutes
};
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Daemon handler logic | In-memory SQLite, pre-seeded snapshots + Cortex nodes, mock bus |
| Unit | Scheduler lifecycle | `vi.useFakeTimers()`, mock `claimNext` returns, verify resolve/fail |
| Integration | Full cycle: scheduler → daemon → bus | Real SQLite, pre-seeded data, verify CEO proposal enqueued |
| Type | `LaneId` exhaustiveness | `npm run typecheck` catches unhandled new lane in all switch/map sites |

## Rollout / Eviction

1. Ship daemons + scheduler behind feature flag (interval=0 → disabled)
2. Deploy, enable scheduler, validate CEO proposals
3. Then evict `runQualityChecks()`/`runRelistChecks()` from background ingestion worker loop
4. No schema migration required — daemons read existing tables

## Open Questions

- [ ] Confirm seller derivation: daemons receive `sellerIds[]` in config; is per-message seller override needed in `payloadJson`?
