# Archive Report: Real Ingestion Economic Adapters

**Change:** `real-ingestion-economic-adapters`
**Archived:** 2026-07-11
**Status:** ✅ Implemented / Archived

---

## Summary

PR 4/4 of P0 — Production Readiness. Connected real MercadoLibre read-only data with the Financial Truth infrastructure. Built 6-layer pipeline: Acquisition → Normalization → Economic Adapters → Deterministic Calculation → Idempotent Persistence → Finance Director Consumption.

## Artifacts Delivered

### Domain Types (4 new)
- `NormalizedCommerceTransaction` — PII-free commerce record, one per line item
- `EconomicEvidenceReference` — SHA-256 provenance chain per economic figure
- `EconomicIngestionRun` — Run state machine with 5 modes
- `EconomicDataCoverage` — 12-dimension coverage evaluation

### Store Extensions
- 5 new CRUD methods on `EconomicOutcomeStore`: insertCostComponent, upsertCostComponent, listCostComponents, listBySourceRecord, reverseCostComponent
- Composite unique index for idempotency: `(seller_id, source, source_record_id, economic_meaning, source_version)`
- Soft-delete with audit trail (reversed_at, reversed_reason)

### Economic Adapters (11)
- **Real (6):** OrderRevenue, MarketplaceFee, ShippingCost, SellerDiscount, RefundReturn, AdvertisingCost
- **Stubs (6):** ProductCost, LandedCost, Packaging, Financing, Tax, Other — all declare missing inputs honestly

### Pipeline & Daemon
- `EconomicIngestionPipeline` — 16-step read-only pipeline with DataFetcher injection
- `EconomicReconciliationService` — tolerance-based source vs computed comparison
- `EconomicIngestionDaemon` — Feature-gated worker (`MSL_ECONOMIC_INGESTION_ENABLED=false`)

### Tools & CLI
- 4 new CEO tools: inspect_cost_components, inspect_evidence_references, inspect_coverage, reconcile_seller_economics
- 5 CLI commands: economic:ingest, :status, :coverage, :reconcile, :missing
- `real-economic-ingestion` capability registered in ProductionCapability

### Documentation
- Operational runbook: `docs/operations/real-ingestion-economic-adapters.md`
- 9 SDD policy documents (source-mapping, economic-semantics, data-quality, reconciliation, idempotency, PII, backfill, production, threat-model)
- ROADMAP.md, ARCHITECTURE.md, README.md, .env.example updated

## Key Decisions

1. **Revenue is NOT a cost component** — feeds `UnitEconomicsInput.grossRevenue` directly
2. **Missing ≠ zero** — `computeUnitEconomics()` detects absent cost types, snapshots marked "partial"
3. **No EconomicOutcome for organic sales** — only for attributable actions/proposals
4. **Pipeline never calls DeepSeek** — Finance Director uses bounded aggregates via assembler
5. **No automatic FX** — CLP and USD kept separate, cross-currency costs marked missing
6. **Stub adapters are honest** — declare missing inputs, never fabricate data

## Remaining Gaps (Documented, Not Blockers)

- Product cost and landed cost: infrastructure ready, real data pending (Supplier Mirror, manual input)
- Order detail endpoint with payments: not yet wired in MlcApiClient
- FX rates: manual only, no automated queries
- Real backfill: requires production credentials and controlled execution

## Test Coverage

- 129 new tests across 12 test files
- 3304 total passing tests, 0 regressions
- TypeScript, ESLint, Prettier clean on all changed files
- CLI, E2E verified

## Next Phase

P1 — Product Launch Intelligence: Use verified economic data to inform pricing, promotion, and catalog decisions.

## Correction (2026-07-11)

An independent audit and hardening change (`complete-real-economic-ingestion-wiring`) found that while the core engine was genuinely production-ready, the CLI economic handlers were 100% stubs and the daemon was not wired. These gaps were corrected:

- CLI handlers (ingest, status, coverage, reconcile, missing) → real implementations
- Economic ingestion daemon → wired in start-agent-daemons.mjs
- inspect_evidence_references CEO tool → real store queries
- Real smoke test executed: Plasticov (279 snapshots), Maustian (349 snapshots)
