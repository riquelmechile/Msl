## Exploration: expand-specialist-catalog

### Current State

The system has a **daemon scheduler** (`packages/agent/src/workers/daemonScheduler.ts`) that runs 4 specialist daemons on a 15-minute polling cycle. The daemons are investigation-only: they read operational evidence (from both the OperationalReadModel SQLite store and Cortex graph nodes), detect business signals, and enqueue CEO proposals via the AgentMessageBus — all with `noMutationExecuted: true`.

The current daemon catalog:

| Lane ID | Handler File | Focus |
|---------|-------------|-------|
| `market-catalog` | `marketCatalogDaemon.ts` | Listing quality, pricing, relist candidates |
| `operations-manager` | `operationsManagerDaemon.ts` | Claims, questions, orders, reputation |
| `cost-supplier` | `costSupplierDaemon.ts` | Margin analysis, cost tracking, restock signals |
| `creative-commercial` | `creativeCommercialDaemon.ts` | Conversion analysis, creative candidates, stagnant stock |

### Architecture Overview

**Daemon Handler Pattern:**
- Type: `DaemonHandler = (input: { claim, reader, cortex, bus, sellerIds }) => Promise<DaemonResult>`
- Pattern: read snapshots from `reader.searchSnapshots()` (ORM) → fallback to `cortex.queryByMetadata()` → detect signals → group findings by severity → enqueue CEO proposals via `bus.enqueue()` with dedupe keys
- Findings: `{ kind: "opportunity"|"alert"|"info", severity: "info"|"warning"|"critical", summary, evidenceIds }`
- Dedupe key format: `{lane-id}-{severity-tier}-{hourly-bucket}` (e.g. `market-catalog-critical-2026-07-08T14`)

**Lane Registration:**
1. `packages/agent/src/conversation/lanes.ts` — `LaneId` union type, `LaneContract` object per lane
2. `packages/agent/src/workers/daemonScheduler.ts` — `daemonHandlerMap: Partial<Record<LaneId, DaemonHandler>>`
3. `packages/agent/src/conversation/companyAgents.ts` — `laneDepartments` mapping (to `"executive"|"operations"|"commercial"`)
4. `packages/agent/src/index.ts` — public exports for each daemon
5. `packages/agent/src/workers/daemonTypes.ts` — `DaemonHandler`, `DaemonResult`, `DaemonFinding` types

**Process Management (PM2):**
- `ecosystem.config.cjs` — `msl-agent-daemons` process runs `scripts/start-agent-daemons.mjs`
- Daemon process shares the Cortex SQLite DB via `MSL_CORTEX_SQLITE_PATH`
- Separate from `msl-worker-ingestion` (background ingestion, 6-hour cycle)

**Data Sources — Already Ingredient:**

| Data Kind | Ingested By | Storage | Used By Daemons |
|-----------|-------------|---------|-----------------|
| `listing_snapshot` | background ingestion | Cortex + ORM | All daemons |
| `visit_snapshot` | background ingestion | Cortex | market-catalog, cost-supplier, creative-commercial |
| `order_snapshot` | background ingestion | Cortex | creative-commercial, operations-manager |
| `claim_snapshot` | background ingestion | Cortex + ORM | operations-manager |
| `question_snapshot` | background ingestion | Cortex + ORM | operations-manager |
| `reputation_snapshot` | background ingestion | Cortex + ORM | operations-manager |
| `product-ads-insights` | background ingestion | ORM only | (not yet used by any daemon) |
| `cost_snapshot` | (manually/indirectly) | Cortex | cost-supplier |
| `pricing_snapshot` | background ingestion | Cortex | cost-supplier |

### Affected Areas

- `packages/agent/src/conversation/lanes.ts` — needs 3 new `LaneId` values + `LaneContract` objects
- `packages/agent/src/workers/daemonTypes.ts` — likely no changes (handler types are generic)
- `packages/agent/src/workers/daemonScheduler.ts` — needs 3 new entries in `daemonHandlerMap`
- `packages/agent/src/conversation/companyAgents.ts` — needs 3 new `laneDepartments` entries
- `packages/agent/src/conversation/backgroundIngestion.ts` — potential additional ingestion for supplier/inventory data
- `packages/agent/src/index.ts` — export 3 new daemon handlers
- `packages/agent/tests/workers/` — 3 new daemon test files
- `ecosystem.config.cjs` — no changes needed (scheduler handles all lanes)

### Available Data Sources

**1. Product Ads Monitoring:**
- **Already ingested**: `product-ads-insights` snapshot exists in the ORM via `processSellerProductAds()` in background ingestion
- **ML API**: `MlcApiClient.getProductAdsInsights()` — calls `/advertising/{site}/advertisers/{id}/product_ads/campaigns/search` and `ads/search`
- **Data shape**: `MlcProductAdsInsights` — includes `campaigns[]`, `ads[]`, `dateFrom`, `dateTo`, `performanceMetric: "roas"`
- **Ingestion frequency**: every 24 hours (long TTL)
- **Gap**: Current ingestion only writes to ORM, not to Cortex graph. The daemon handler reads from both ORM and Cortex, but `product-ads-insights` is only in ORM.
- **MCP tools already exist**: `read_product_ads_insights` and `prepare_product_ads_action` (preparation-only, write gated)

**2. Creative / Social Content Optimization:**
- **ML APIs already implemented in client**:
  - `diagnoseImage()` — POST `/moderations/pictures/diagnostic` (image quality validation)
  - `uploadImage()` — POST `/pictures/items/upload` (upload and smartcrop)
  - `associateImageToItem()` — link uploaded image to listing
  - `getModerationStatus()` — check listing moderation status
- **No existing ingestion** for creative data into Cortex or ORM
- **No existing snapshot kinds** for creative assets, image diagnostics, or social content

**3. Supplier Management / Inventory Sync:**
- **Supplier Mirror system exists**: `packages/memory/src/supplierMirrorStore.ts` + `packages/mercadolibre/src/supplierSource.ts`
- **SupplierSourceAdapter** interface: `collect(input) => { items, stockObservations, evidence }`
- **MercadoLibre Supplier Source Adapter**: wraps `getListings | getItem` for a target seller
- **No daemon-level ingestion** for supplier mirror data into Cortex
- **Multi-Origin Stock API** documented by ML: warehouse management, user-product stock queries, stock per location
- **Existing MCP tools**: `sync_product` (preparation), `msl_read_sync_product_status`, `msl_approve_sync_product_proposal`, `msl_execute_sync_product`

### Approaches

**1. Product Ads Monitoring Daemon** — `product-ads-monitor` lane
- Query `product-ads-insights` from ORM (already ingested every 24h)
- Detect: campaigns with low ROAS/ACOS, campaigns near budget cap, underperforming ads, paused campaigns needing review
- Propose: budget adjustments, pause underperforming campaigns, increase budget for well-performing ones
- Pros: Data already flowing, no new ingestion needed
- Cons: Only ingested once per 24h, not in Cortex (ORM-only), no historical trend data yet
- Effort: Low-Medium (~200-300 LOC)

**2. Creative / Social Content Optimization Daemon** — `creative-assets` lane
- Read listing snapshots for image count, moderation status
- Detect: listings with single images, listings with failed moderation, listings with no images (if applicable), listings with high visits but poor creative
- Propose: image optimization candidates, creative refresh for stagnant high-visit listings
- Pros: Uses existing listing data; image APIs already implemented
- Cons: No dedicated creative/assets snapshot kind exists yet; raw image analysis not feasible without ML vision API
- Effort: Medium (~300-400 LOC + potential ORM snapshot kind)

**3. Supplier Management / Inventory Sync Daemon** — `supplier-manager` lane
- Read supplier mirror evidence, listing snapshots, cost data
- Detect: low stock across supplier accounts, items needing cross-account sync, supplier price changes, out-of-sync catalogs
- Propose: sync recommendations, restock signals from supplier perspective
- Pros: Supplier Mirror system already exists with adapter pattern
- Cons: No ingestion of supplier data into Cortex yet; depends on `supplierMirrorStore` which is separate from ORM/Cortex; needs coordination with existing `costSupplierDaemon` to avoid overlap
- Effort: Medium-High (~400-500 LOC + potential new data pipeline)

### Recommendation

**Start with Product Ads Monitoring** — it has the most data already flowing (ORM snapshots every 24h), the most straightforward detection logic, and directly extends the existing pattern without new data pipelines. Creative assets and supplier management require new ingestion paths that increase complexity and risk.

The recommended order:
1. **Phase 1**: `product-ads-monitor` daemon — leverages existing `product-ads-insights` ORM data
2. **Phase 2**: `creative-assets` daemon — adds an image/creative snapshot kind to ORM, then reads it
3. **Phase 3**: `supplier-manager` daemon — bridges the Supplier Mirror system into the daemon pattern, potentially after a data pipeline to surface supplier evidence in ORM/Cortex

### Risks

- **Product Ads data only in ORM, not Cortex**: All existing daemons use Cortex as a fallback when ORM has no data. The product-ads-insights kind is ORM-only. This is fine for now but means the daemon is coupled to ORM availability.
- **Creative data has no ingestion pipeline yet**: Images are uploaded/validated via API but no snapshots are persisted. Need to decide: create a lightweight `creative_snapshot` ORM kind or query ML API on each cycle?
- **Supplier Manager overlaps with Cost Supplier**: The `cost-supplier` lane already detects restock signals and margin issues. The Supplier Manager daemon must scope itself to *supplier relationship management* (cross-account sync, price parity, catalog mirror) to avoid duplication.
- **No existing snapshot kind constants for these domains**: Need to add entries to `KIND_FRESHNESS_TTL` and `KIND_DEFAULT_MAX_PAGES` in background ingestion.
- **16 lane IDs limit**: The `LaneId` union type already has 7 values (ceo + 4 daemon + owned-ecommerce). Adding 3 more pushes it to 10, which is fine.
- **No dedicated test fixtures for new daemons**: Each daemon test currently manually seeds data into in-memory SQLite. New daemons will follow the same pattern but need new seed helpers for their specific data kinds.

### Ready for Proposal

Yes. The architecture is mature, the pattern is well-established (4 existing daemons with identical structure), and the Product Ads data is already flowing. The exploration reveals clear incremental steps.

Recommendation: proceed with a proposal covering all 3, scoping Phase 1 (Product Ads) with concrete detail and Phases 2-3 as follow-up changes.
