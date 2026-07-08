# Design: Supplier Manager Daemon

## Technical Approach

Extend `DaemonHandler` input + `DaemonSchedulerConfig` with an optional `supplierMirrorStore?: SupplierMirrorStore`. The new daemon reads SQLite mirror data (supplier items, stock observations, item mappings, sync ledger), cross-references Cortex listing snapshots per mapped seller, and enqueues grouped CEO proposals with `noMutationExecuted: true`. Follows the established productAdsMonitorDaemon pattern: fetch → detect → dedupe → enqueue per severity tier.

## Architecture Decisions

### Decision: Store injection

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Inject via `DaemonHandler` input extension | Minimal change; optional field, zero breakage | **Chosen** |
| Inject via `DaemonSchedulerConfig` only, daemon receives from closure | No—closures break testability and violate the `DaemonHandler` contract pattern |

**Rationale**: The existing contract passes everything explicitly via the handler input object. Adding an optional field keeps all daemons compatible—they simply ignore the extra key. Tests can pass a mock store directly.

### Decision: Optional store, graceful degrade

**Choice**: Store is `SupplierMirrorStore | undefined` in both `DaemonHandler` input and `DaemonSchedulerConfig`. If absent, the daemon returns `{ findings: [], proposalEnqueued: false, messageIds: [] }`.

**Alternatives considered**: Required store (would break existing callers). Runtime check with error throw (violates graceful degrade spec). **Chosen**: optional + early return.

### Decision: SQLite sync reads (no ORM for mirror data)

**Choice**: Call `SupplierMirrorStore` methods directly (all are async but synchronous under the hood—SQLite with WAL). No `reader.searchSnapshots()` for mirror data.

**Rationale**: SupplierMirrorStore IS the authoritative source for supplier data. Cross-referencing Cortex uses `cortex.queryByMetadata()` as in productAdsMonitorDaemon.

## Data Flow

```
SupplierMirrorStore (SQLite)        Cortex (GraphEngine)
  │ listEnabledSuppliers()           │ queryByMetadata({ type: "listing_snapshot" })
  │ listSupplierItemSnapshots()      │
  │ listStockObservations()          ▼
  │ listTargetMappings()        ┌──────────┐
  │ getLedgerByIdempotencyKey() │  Daemon  │
  ▼                             │  Handler │
supplier_items[]                └────┬─────┘
stock_observations[]                 │ DaemonFinding[]
item_mappings[]                      ▼
                               bus.enqueue({ receiverAgentId: "ceo" })
                               bus.resolve(claim.messageId, result)
```

### Signal Detection Flow (per enabled supplier)

1. `listSupplierItemSnapshots(supplierId)` — get all items
2. For each item:
   - **Stock gap**: `listTargetMappings(supplierId, itemId)` → for each mapping, `cortex.queryByMetadata({ type:"listing_snapshot", itemId: mapping.targetItemId })` → compare stock quantities across sellers → signal if one seller has stock > 0 and another has 0
   - **Price change**: `item.price` (current) vs `getLedgerByIdempotencyKey(lastPriceKey)` stored prior → signal on >5% delta
   - **Unfilled mirror**: `!item.mlItemId && mappings.length === 0` → signal
3. Dedupe each signal via `getLedgerByIdempotencyKey(key)` before enqueuing

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/workers/supplierManagerDaemon.ts` | Create | Daemon handler: 3-signal detection, dedupe, CEO enqueue (~300 LOC) |
| `packages/agent/src/workers/daemonTypes.ts` | Modify | Add `supplierMirrorStore?: SupplierMirrorStore` to `DaemonHandler` input |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | (1) Add `supplierMirrorStore` to `DaemonSchedulerConfig`, (2) Pass it to handler call, (3) Add `"supplier-manager": supplierManagerDaemon` to handler map |
| `packages/agent/src/conversation/lanes.ts` | Modify | Add `"supplier-manager"` to `LaneId` union; add `SUPPLIER_MANAGER_LANE` contract |
| `packages/agent/src/conversation/companyAgents.ts` | Modify | Map `"supplier-manager"` → `"operations"` in `laneDepartments` |
| `packages/agent/src/index.ts` | Modify | Export `supplierManagerDaemon` |

## Interfaces / Contracts

### Extended DaemonHandler input

```typescript
export type DaemonHandler = (input: {
  claim: AgentMessage;
  reader: OperationalReadModelReader;
  cortex: GraphEngine;
  bus: AgentMessageBusStore;
  sellerIds: string[];
  supplierMirrorStore?: SupplierMirrorStore;  // NEW
}) => Promise<DaemonResult>;
```

### Extended DaemonSchedulerConfig

```typescript
export type DaemonSchedulerConfig = {
  // ... existing fields ...
  supplierMirrorStore?: SupplierMirrorStore;  // NEW
};
```

### Store methods used by daemon

| Method | Purpose |
|--------|---------|
| `listEnabledSuppliers()` | Iterate suppliers to scan |
| `listSupplierItemSnapshots(supplierId)` | Get all items for a supplier |
| `listStockObservations(supplierId, itemId)` | Get stock history per item |
| `listTargetMappings(supplierId, itemId)` | Get mapped sellers/targets |
| `getLedgerByIdempotencyKey(key)` | Dedupe check |
| `appendLedger(record)` | Record detection as processed |

### Idempotency Key Format

```
{signal_kind}_{supplierId}_{supplierItemId}_{hourKey}
```
Example: `stock-gap_plasticov_PLAST001_2026-07-08T14`

### Proposal Payload Shape (to CEO)

```typescript
{
  type: "proposal",
  summary: string,
  findings: DaemonFinding[],   // per-detection
  recommendedAction: string,
  capturedAt: string,
  noMutationExecuted: true
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Each signal in isolation | Mock `SupplierMirrorStore` (object literal), seed items/stock/mappings; call `investigate()` directly; assert findings shape and dedupe behavior |
| Unit | Graceful degrade | Pass `undefined` as store; assert empty findings, no error |
| Unit | Dedupe logic | Seed ledger with existing idempotency key; assert signal skipped |
| Integration | Full daemon via scheduler | Follow `daemonIntegration.test.ts` pattern: create SqliteSupplierMirrorStore with seed data, enqueue task message, start scheduler, await cycle, assert CEO proposals |

### Mock store pattern

```typescript
const mockStore: SupplierMirrorStore = {
  listEnabledSuppliers: async () => [{ id: "su-1", name: "Test", enabled: true, ... }],
  listSupplierItemSnapshots: async (sid) => [{ supplierId: sid, supplierItemId: "ITM-1", ... }],
  listTargetMappings: async (sid, iid) => [{ targetSellerId: "seller-a", targetItemId: "MLC-1", ... }],
  listStockObservations: async (sid, iid) => [{ quantity: 0, supplierItemId: iid, ... }],
  getLedgerByIdempotencyKey: async () => null,
  appendLedger: async (r) => r,
  // ... stubs for unused methods
};
```

## Migration / Rollout

No migration required. The new field is optional—existing scheduler call sites in tests continue to work unchanged. The `supplier-manager` lane only activates when a message is enqueued for it.

## Open Questions

- [ ] Should the price-change threshold (currently 5%) be configurable via `DaemonSchedulerConfig`? Keep it hardcoded for MVP per spec.
- [ ] Do we want a standalone `listAllTargetMappings()` method on the store to avoid N+1 queries? Current `listTargetMappings(supplierId, itemId)` is per-item—acceptable for MVP supplier catalog sizes.
