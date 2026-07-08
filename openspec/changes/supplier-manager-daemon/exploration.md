# Exploration: supplier-manager-daemon

**Status**: success  
**Date**: 2026-07-08  
**Explorer**: sdd-explore sub-agent  

---

## Current State

The system has a **Supplier Mirror** subsystem built across three packages:

1. **`@msl/domain`** (`packages/domain/src/supplierMirror.ts`) — Types for suppliers, items, stock observations, mappings, policies, ledger, notifications, learned policies. Rich data model spanning registry (`SupplierRegistryEntry`), item snapshots (`SupplierItemSnapshot`), stock observations (`SupplierStockObservation`), target mappings (`SupplierTargetMapping`), pricing policies (`SupplierPricingPolicy`), and a full sync ledger + notification system.

2. **`@msl/memory`** (`packages/memory/src/supplierMirrorStore.ts`) — SQLite-backed store with tables: `suppliers`, `supplier_items`, `stock_observations`, `item_mappings`, `target_policies`, `sync_ledger`, `notification_preferences`, `supplier_mirror_notification_events`, `learned_fallback_policies`. Fully indexed.

3. **`@msl/workers`** (`packages/workers/src/supplierMirror/index.ts`) — Worker that polls supplier adapters at 10-min intervals. Includes stock-break monitor (automatic listing pausing on verified stock-outs). Adapter registry pattern. Currently only `jinpeng` bootstrap exists (`jinpengBootstrap.ts`).

The **sync_product pipeline** (MCP layer) uses `ApprovalQueueRepository` (in-memory or SQLite) to store prepare-only proposals for Plasticov→Maustian cross-account sync. The flow is: `sync_product` → `approve_sync_product_proposal` → `read_sync_product_execution_readiness` → `execute_sync_product`.

**Existing daemon infrastructure** (`daemonScheduler.ts`) dispatches 6 daemons by laneId. Daemons receive `reader`, `cortex`, `bus`, `sellerIds`. **Neither the supplier mirror store nor the approval queue repository** is currently injected into the daemon handler context.

The **costSupplierDaemon** lives in `packages/agent/src/workers/costSupplierDaemon.ts` and detects margin thresholds, selling-below-cost, and restock signals via Cortex + reader snapshots. It does NOT touch supplier mirror mappings, sync proposals, or supplier price comparisons.

---

## Affected Areas

| Path | Impact |
|------|--------|
| `packages/agent/src/workers/supplierManagerDaemon.ts` | **NEW** — the daemon handler itself |
| `packages/agent/src/workers/daemonScheduler.ts` | Register new handler in `daemonHandlerMap` + inject new dependencies |
| `packages/agent/src/workers/daemonTypes.ts` | Extend `DaemonHandler` input type to include `supplierMirrorStore` and/or `approvalRepository` |
| `packages/agent/src/conversation/lanes.ts` | Add `supplier-manager` lane contract |
| `packages/agent/src/conversation/companyAgents.ts` | Map new lane to department |
| `packages/agent/src/index.ts` | Export new daemon |
| `packages/memory/src/operationalReadModel.ts` | Possibly add supplier mirror reader interface if daemon needs ORM-level access |
| `packages/agent/src/workers/costSupplierDaemon.ts` | **No changes needed** — clear boundary already exists |

---

## Available Data

### Supplier Mirror Store (direct SQLite access needed)
- `suppliers` — registered suppliers (currently just `jinpeng`)
- `supplier_items` — SKU, price, category, title, ML item ID, full snapshot JSON
- `stock_observations` — per-item quantity, status, authority level, confidence
- `item_mappings` — which supplier items map to which seller+listing, with policy refs
- `target_policies` — low-stock thresholds, auto-pause flags, pricing policies
- `sync_ledger` — history of all sync actions (publish proposals, price changes, pauses)
- `notification_events` — history of stock-break confirmations, deferred pauses
- `learned_fallback_policies` — inferred fallback behaviors

### Cortex Graph Engine (already available to daemons)
- `listing_snapshot` — price, stock, status, category per item per seller
- `visit_snapshot` — total visits, visit details per item per seller
- `cost_snapshot` — unit costs (ingested by costSupplierDaemon extraction)
- `pricing_snapshot` — commission rates, shipping costs
- `order_snapshot` — aggregated order metrics per seller

### Operational Read Model (ORM) — already available to daemons
- `listing_snapshot` — full listing data (pictures, attributes, variations)
- `creative-snapshot` — creative quality data
- `product-ads-insights` — ads performance
- `pricing` — price-to-win competition data

### Approval Queue Repository (NOT currently available to daemons)
- Sync product proposals (pending, approved, rejected, expired)
- No "list all pending" method currently — only `findAction(actionId)` lookup

### MercadoLibre Multi-Origin Stock API (NOT yet consumed)
- `GET /user-products/{id}/stock` — per-location stock
- `PUT /user-products/{id}/stock/type/seller_warehouse` — update stock per warehouse
- Requires `warehouse_management` + `multiwarehouse` tags on seller account

---

## Overlap Boundary (vs costSupplierDaemon)

| Signal | costSupplierDaemon | supplier-manager-daemon |
|--------|-------------------|------------------------|
| Margin below threshold | ✅ Detects (critical/warning) | ❌ OUT — margin is cost+price analysis |
| Selling below cost | ✅ Detects | ❌ OUT |
| Restock opportunity | ✅ Detects (stock=0 + rising visits) | ❌ OUT — restock is operational |
| **Supplier price change** | ❌ NOT detected | ✅ IN — changes in supplier mirror item price |
| **Cross-account stock discrepancy** | ❌ NOT detected | ✅ IN — supplier has stock on Plasticov but not Maustian |
| **Pending sync proposals** | ❌ NOT detected | ✅ IN — pending sync_product proposals needing attention |
| **Supplier mirror gaps** | ❌ NOT detected | ✅ IN — items in supplier mirror not yet published to ML |
| **Low stock across all accounts** | Only per-seller | ✅ IN — same product low across both accounts |
| **Purchase price changes** | ❌ NOT detected (only sales margin) | ✅ IN — supplier item price changes affecting catalog margins |

**Clear boundary**: costSupplierDaemon = **margin analysis + restock signals** (sales-side financials). supplier-manager-daemon = **supplier relationship + cross-account sync + catalog mirror + purchase price tracking** (supply-side). No overlap.

---

## Signal Candidates (Feasible)

### Signal 1: Cross-Account Stock Discrepancy
- **Data**: Supplier `stock_observations` + `item_mappings` to target seller listings + listing snapshots from Cortex
- **Detection**: Same supplier item has mappings to both Plasticov and Maustian, but stock differs significantly (e.g., Maustian shows 0 stock while Plasticov shows 15+)
- **Action**: Enqueue CEO proposal to check sync or initiate sync_product
- **Feasibility**: HIGH — all data already available via supplierMirrorStore + cortex

### Signal 2: Pending Sync Proposals Needing Attention
- **Data**: ApprovalQueueRepository (sync_product proposals with status `pending`)
- **Detection**: Proposals approaching expiry (>X hours old, still not approved/rejected)
- **Action**: Remind CEO via proposal
- **Feasibility**: MEDIUM — requires injecting `ApprovalQueueRepository` into daemon; no "list pending" method exists, would need query by type or a new method

### Signal 3: Supplier Price Change Affecting Catalog Margin
- **Data**: Compare historical `supplier_items.price` over time (via existing snapshots)
- **Detection**: Supplier item price changed >X% since last observation, affecting items mapped to active listings
- **Action**: Enqueue CEO proposal with estimated margin impact
- **Feasibility**: HIGH — supplier_items table tracks price changes via upsert, can compare

### Signal 4: Supplier Mirror Items Not Published to Any Seller
- **Data**: `supplier_items` where `ml_item_id` is null AND no `item_mappings` exist
- **Detection**: Items visible in supplier catalog but not published to Plasticov or Maustian
- **Action**: Suggest CEO evaluate for publication
- **Feasibility**: HIGH — straightforward query on store

### Signal 5: Stock Observations Below Policy Threshold (Combined)
- **Data**: `stock_observations` + `target_policies` + `item_mappings`
- **Detection**: Supplier stock for key items below `low_stock_threshold`, affecting all mapped seller listings
- **Action**: Alert CEO with summary of affected listings
- **Feasibility**: HIGH — existing `runSupplierMirrorStockBreakMonitor` already does similar detection but only auto-pauses; daemon would surface to CEO instead

### Signal 6: Sync Ledger Health
- **Data**: `sync_ledger` records with status `deferred` or `failed`
- **Detection**: Accumulation of failed/deferred sync actions
- **Action**: Surface to CEO for investigation
- **Feasibility**: HIGH — ledger is already stored

---

## Architecture Impact

### New Files

| File | Description | Est. LOC |
|------|-------------|----------|
| `packages/agent/src/workers/supplierManagerDaemon.ts` | Daemon handler: signals 1-6 detection + CEO proposals | ~300-400 LOC |

### Modified Files

| File | Change | Est. LOC |
|------|--------|----------|
| `packages/agent/src/workers/daemonTypes.ts` | Extend `DaemonHandler` input: add `supplierMirrorStore` and/or `approvalRepository` | ~10 LOC |
| `packages/agent/src/workers/daemonScheduler.ts` | Import + register handler; inject new dependencies | ~15 LOC |
| `packages/agent/src/conversation/lanes.ts` | Add `supplier-manager` lane to `LaneId` + `LANE_CONTRACTS` | ~30 LOC |
| `packages/agent/src/conversation/companyAgents.ts` | Map new lane to department | ~5 LOC |
| `packages/agent/src/index.ts` | Export new daemon type | ~5 LOC |

### Ingestion Needs

- **No new ingestion pipeline** needed — supplier mirror data is already ingested by its worker (10-min intervals)
- The daemon needs **direct access to the `SupplierMirrorStore`** (SQLite) since the ORM doesn't mirror supplier data
- For sync proposal signals: need **access to `ApprovalQueueRepository`** or add a "list pending" method to it
- Multi-Origin Stock API ingestion is **deferred** — not needed for phase 1 (no seller currently uses multi-warehouse)

### Total Effort Estimate

- **~365-465 LOC** across new + modified files
- **Effort: Medium** — moderate complexity, data is available, pattern is well-established (6 existing daemons)
- Biggest unknown: injecting `SupplierMirrorStore` and `ApprovalQueueRepository` into the daemon pipeline without tight coupling

---

## Risks

1. **Dependency injection coupling**: Currently daemons receive `reader`, `cortex`, `bus`, `sellerIds`. Adding `supplierMirrorStore` means the daemon scheduler needs access to the SQLite store. If the store is created inside `agentLoop.ts` (for agent tools), the scheduler needs a reference too.

2. **Approval queue repository access**: The sync_product proposals live in `@msl/tools` (ApprovalQueueRepository). No "list pending" method exists. Adding one means changing `@msl/tools` or exposing the repository differently.

3. **Cortex vs SQLite data staleness**: Supplier mirror data lives in SQLite, not Cortex. The daemon currently queries Cortex for listing info. Joining supplier data with Cortex listing snapshots across two stores introduces consistency considerations.

4. **Signal noise**: Some signals (e.g., unfilled mirror items) could fire repeatedly. Need deduplication or state tracking (sync_ledger already provides this for some cases).

5. **Rate limits on sync_product creation**: If the daemon auto-initiates sync_product proposals, it must respect ML API rate limits and the per-item idempotency enforced by the MCP tool.

---

## Ready for Proposal

**Yes**. The exploration is complete. Recommended next step is to run the **propose** phase to define scope + approach.

### Key decisions needed during proposal:
1. **Data access strategy**: Should `supplierMirrorStore` be injected directly into daemon handler, or should a new reader interface be created? (Recommend: inject `SupplierMirrorStore` directly — it's already testable with SQLite)
2. **Approval queue visibility**: Should we add a "list pending sync proposals" method to ApprovalQueueRepository, or skip Signal 2 for phase 1? (Recommend: phase 1 skip — focus on Signals 1, 3, 4, 5 which are HIGH feasibility)
3. **Phase 1 signal scope**: Recommend starting with 3 signals (cross-account stock discrepancy, supplier price change, unfilled mirror items) and adding ledger health + pending syncs in phase 2
4. **Multi-Origin Stock API**: Defer — not needed until a seller with `warehouse_management` tag is onboarded

---

## Skill Resolution
**none** — no skills were used during exploration.
