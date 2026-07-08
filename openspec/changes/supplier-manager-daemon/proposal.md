# Proposal: Supplier Manager Daemon

## Intent

Detect supply-chain signals from the Supplier Mirror subsystem (cross-account stock gaps, supplier price shifts, unfilled mirror items) and surface them as CEO proposals. No existing daemon accesses `SupplierMirrorStore` — the data is ingested but never monitored.

## Scope

### In Scope
- New `supplierManagerDaemon` handler reading `SupplierMirrorStore` + Cortex snapshots
- 3 MVP signals: cross-account stock discrepancy, supplier price change, unfilled mirror items
- Extend `DaemonHandler` input + `DaemonSchedulerConfig` to inject `SupplierMirrorStore`
- Lane registration (`supplier-manager`), department mapping, daemon handler map, barrel export
- Deduplication via `sync_ledger` idempotency keys per detection cycle

### Out of Scope
- `ApprovalQueueRepository` injection (Signal 2: pending sync proposals — Phase 2)
- Multi-Origin Stock API ingestion
- Auto-initiated `sync_product` proposals (proposal-only — `noMutationExecuted: true`)
- Any change to `costSupplierDaemon`

## Capabilities

### New Capabilities
- `supplier-manager-daemon`: Supplier-mirror daemon that detects stock discrepancies, price changes, and unfilled mirror items; enqueues CEO proposals only.

### Modified Capabilities
- `daemon-scheduler`: `DaemonHandler` input and `DaemonSchedulerConfig` gain optional `supplierMirrorStore`; handler map adds `supplier-manager` lane.
- `specialist-daemons`: Specification extended with `supplierManagerDaemon` requirements (3 signals, no-mutation boundary, idempotency dedupe).

## Approach

Inject `SupplierMirrorStore` (SQLite) directly into the daemon via an extension to `DaemonHandler` input and `DaemonSchedulerConfig`. The daemon reads mirror data (supplier stock, item prices, mappings), cross-references Cortex listing snapshots, and enqueues CEO proposals via the message bus. Follows the established daemon pattern: `DaemonHandler` signature → `DaemonResult` → bus enqueue.

**Department**: `operations` (supply-chain health, consistent with `cost-supplier`).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/workers/supplierManagerDaemon.ts` | New | Daemon handler (~300 LOC) |
| `packages/agent/src/workers/daemonTypes.ts` | Modified | Add `supplierMirrorStore` to handler input |
| `packages/agent/src/workers/daemonScheduler.ts` | Modified | Inject store, register handler |
| `packages/agent/src/conversation/lanes.ts` | Modified | Add `supplier-manager` lane |
| `packages/agent/src/conversation/companyAgents.ts` | Modified | Map lane to `operations` |
| `packages/agent/src/index.ts` | Modified | Export daemon |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SQLite-Cortex data staleness mismatch | Low | Mirror worker polls at 10-min; daemon at 15-min — acceptable window |
| Signal noise (same detection fires repeatedly) | Med | Dedupe via `sync_ledger` idempotency keys; compare timestamps |
| Daemon scheduler needs `SupplierMirrorStore` before init | Low | Make field optional; daemon skips if store absent (graceful degrade) |

## Rollback Plan

Remove lane from handler map + `LaneId` union. Daemon scheduler skips unmapped lanes — zero side effects. No data mutations to revert.

## Dependencies

- `SupplierMirrorStore` instance (already created in `agentLoop.ts` for tools)
- No new packages or external APIs

## Success Criteria

- [ ] Daemon detects stock discrepancy (item with stock on Plasticov, zero on Maustian) and enqueues CEO proposal
- [ ] Daemon detects supplier price change >5% on mapped item and enqueues CEO proposal
- [ ] Daemon detects mirror item with no `ml_item_id` or mappings and enqueues CEO proposal
- [ ] Daemon returns empty findings with no errors when store is absent
- [ ] Existing daemons (costSupplier, marketCatalog, etc.) continue uninterrupted
