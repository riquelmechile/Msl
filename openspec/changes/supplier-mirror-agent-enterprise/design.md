# Design: Supplier Mirror Agent Enterprise

## Technical Approach

Add Supplier Mirror as a dedicated background service plus CEO-orchestrated tools, not as an extension of the current Plasticov→Maustian sync engine. The service owns ingestion, evidence, policies, monitoring, idempotent mutation planning, and ledger records. The CEO lane remains the only user-facing interface; supplier lanes/tools provide bounded evidence and proposals.

`SupplierMirrorService ─→ adapters ─→ supplierMirrorStore ─→ monitor/planner ─→ ML tools`
`CEO lane ─→ supplier tools/evidence ─→ Cortex lessons + cost/cache ledger`

## Architecture Decisions

| Area | Choice | Alternatives considered | Rationale |
|------|--------|-------------------------|-----------|
| Runtime | New `packages/workers/src/supplierMirror/*` service wired from workers/bot runtime | Reuse `ProductSyncEngine` | Existing sync is direction-guarded by `assertPlasticovToMaustianDirection`; Supplier Mirror needs symmetric targets. |
| Store | New `packages/memory/src/supplierMirrorStore.ts` on better-sqlite3 | Overload `operational_snapshots` | Existing snapshots are generic and latest-only; mirror needs mappings, policies, observations, ledgers, and audit history. |
| Sources | Adapter registry with ML API/MCP first, scraper fallback, XKP enrichment, WhatsApp manual/future | Scraper-first | Specs require ML stock authority and isolated fallback evidence. |
| UX | CEO tools only; supplier agents hidden | User selects workers | Existing CEO-only workforce contract already hides `delegate_to_subagent`/evidence tools from UX. |

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/domain/src/supplierMirror.ts` | Create | Types for suppliers, evidence, policies, observations, ledger actions, pricing policies. |
| `packages/domain/src/preparedAction.ts` | Modify | Add supplier mirror action kinds for publish proposal, price proposal, pause listing. |
| `packages/memory/src/supplierMirrorStore.ts` | Create | SQLite migrations and repository methods. |
| `packages/memory/src/index.ts` | Modify | Export store factory/types. |
| `packages/mercadolibre/src/supplierSource.ts` | Create | ML supplier read adapter using supported API client reads plus evidence IDs. |
| `packages/mercadolibre/src/scraperFallback.ts` | Create | Isolated low-concurrency scraper evidence adapter; no mutation APIs exported. |
| `packages/workers/src/supplierMirror/*` | Create | Registry, ingestion, scheduler, monitor, verification, planner, rate limiter. |
| `packages/agent/src/conversation/supplierMirrorTools.ts` | Create | CEO-safe tools: read evidence, propose policy, record decision, request mirror action. |
| `packages/agent/src/conversation/lanes.ts` | Modify | Add supplier-mirror lane contract with stable prefix and no-mutation boundary. |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Register CEO-visible Supplier Mirror tools and inject supplier context/cost evidence. |

## Data Model / Store

Tables: `suppliers(id, name, enabled, primary_source, metadata_json, created_at, updated_at)`, `supplier_items(supplier_id, supplier_item_id, ml_item_id, title, sku, category_id, price, currency, snapshot_json, source, confidence, freshness, evidence_id, captured_at)`, `stock_observations(id, supplier_id, supplier_item_id, source, authority, quantity, status, confidence, evidence_id, captured_at)`, `item_mappings(supplier_id, supplier_item_id, target_seller_id, target_item_id, state, approved_at, evidence_ids_json)`, `target_policies(scope_type, scope_id, supplier_id, target_seller_ids_json, low_stock_threshold, auto_pause_allowed, pricing_policy_id)`, `sync_ledger(id, action_type, idempotency_key, status, reason, supplier_id, supplier_item_id, target_seller_id, target_item_id, evidence_ids_json, before_json, after_json, created_at)`, `notification_preferences(scope_type, scope_id, preference_json)`, `learned_fallback_policies(id, policy_type, scope_json, decision_json, confidence, evidence_ids_json, status)`.

## Source Adapters

`SupplierSourceAdapter.collect()` returns normalized items plus evidence. `MercadoLibreSupplierSourceAdapter` is authoritative for stock and should be checked against current ML MCP/docs during implementation. `MercadoLibreScraperFallbackAdapter` only emits low/medium confidence evidence with selector/raw-hash metadata. `XkpEnrichmentAdapter` enriches photos/specs/category, never stock authority. `WhatsAppManualAdapter` starts as manual import placeholder.

## Scheduling / Flows

Stock monitor runs every ~10 minutes with jitter and per-supplier/account rate limits. Weekly/full refresh re-ingests catalog, XKP enrichment, mappings, and price baselines. Confirmed stock break flow: observe possible break → short re-read via ML API, then fallback if needed → require threshold/confidence → if policy allows, call `change_item_status`/`updateItem` pause with idempotency key → ledger → CEO notice. Inconclusive evidence ledgers skip/alert only.

Pricing policies support `multiplier`, `fixed_uplift_clp`, and `learned`. Supplier price changes create CEO proposals; user answers record `learned_fallback_policies` and Cortex `record_agent_lesson`. DeepSeek uses stable lane prefixes, refreshable evidence blocks, V4 Flash for extraction/classification, V4 Pro only for hard policy conflicts, and existing workforce cost/cache ledger counters.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Store migrations, policy resolution, confidence, idempotency keys | Vitest with in-memory SQLite. |
| Integration | Adapter normalization, monitor pause/skip, CEO tool wiring | Mock ML/XKP/scraper clients; assert ledger/audit. |
| E2E | CEO-only conversation for policy/alert approval | Existing Playwright route when supported. |

## Migration / Rollout

No destructive migration. Ship disabled by default, seed Jinpeng/XKP supplier, enable read-only ingestion, then monitoring, then approved pause, then publishing/price proposals.

## PR / Work-Unit Forecast

High 800-line risk. Recommend chained PRs: domain/store; source adapters; scheduler/monitor; CEO tools/orchestration; pricing/Cortex/cost; integration tests/docs.

## Open Questions

- [ ] Confirm first autonomous pause confidence threshold per supplier.
- [ ] Confirm default low-stock threshold: 2 or 3 units by category/account.
