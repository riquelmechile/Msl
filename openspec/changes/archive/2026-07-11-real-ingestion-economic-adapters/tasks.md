# Tasks: Real Ingestion Economic Adapters

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,200–1,600 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1: Domain types → PR2: Store + Adapters → PR3: Pipeline + Daemon → PR4: Tools + Readiness |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Domain types + store CRUD | PR 1 | Base: main. Pure types first, then storage layer. Tests. |
| 2 | Normalization + all adapters | PR 2 | Base: PR 1. Pure functions, heavy test coverage. |
| 3 | Pipeline + daemon + CLI | PR 3 | Base: PR 2. Orchestration, feature gate, wire-up. |
| 4 | Tools + readiness + docs | PR 4 | Base: PR 3. Finance Director integration, archive. |

## Phase 1: Domain Types (Foundation)

- [x] 1.1 Create `packages/domain/src/normalizedCommerceTransaction.ts` — `NormalizedCommerceTransaction` type (transactionId, sellerId, orderId, itemId, quantity, unitPrice: Money, grossRevenue: Money, currency, orderStatus, sourceVersion, etc.) per `normalized-commerce-transaction` spec.
- [x] 1.2 Create `packages/domain/src/economicEvidenceReference.ts` — `EconomicEvidenceReference` type (evidenceId, sellerId, sourceSystem, sourceEntityType, sourceRecordId, checksum, confidence, verification) per `economic-evidence-reference` spec.
- [x] 1.3 Create `packages/domain/src/economicIngestionRun.ts` — `EconomicIngestionRun` type (runId, sellerId, mode, status, checkpoint, counts) per `economic-ingestion-run` spec.
- [x] 1.4 Create `packages/domain/src/economicDataCoverage.ts` — `EconomicDataCoverage` type (sellerId, coverage dimensions, status, confidence) per `data-quality-and-coverage` spec.
- [x] 1.5 Modify `packages/domain/src/index.ts` — add `export *` for all four new modules.

## Phase 2: Cost Component Store (Storage)

- [x] 2.1 Extend `packages/memory/src/economicOutcomeStore.ts` migration — add columns `source_version TEXT`, `economic_meaning TEXT`, `superseded_at INTEGER`, `reversed_at INTEGER`, `reversed_reason TEXT` to `economic_cost_components`. Add composite unique index on `(seller_id, source, source_record_id, economic_meaning, source_version)`.
- [x] 2.2 Add `insertCostComponent()` — idempotent insert, dedup key: `sellerId + source + sourceRecordId + economicMeaning + sourceVersion`. Duplicate = no-op, return existing. Same key + newer version → supersede.
- [x] 2.3 Add `upsertCostComponent()` — supersede prior version (`superseded_at = now`), insert new row.
- [x] 2.4 Add `listCostComponents(sellerId, opts?)` — seller‑scoped, exclude `reversed_at IS NOT NULL` by default. Support `includeReversed`, `type` filter, `limit`.
- [x] 2.5 Add `listBySourceRecord(sellerId, sourceRecordId)` — all component versions for a source entity.
- [x] 2.6 Add `reverseCostComponent(id, reason)` — set `reversed_at = now`, `reversed_reason`, never hard‑delete. Update `EconomicOutcomeStore` type and `createSqliteEconomicOutcomeStore`.
- [x] 2.7 Write store unit tests — in‑memory SQLite, cover idempotency, supersede, reverse, seller isolation.

## Phase 3: Normalization

- [x] 3.1 Create `packages/agent/src/economics/normalization.ts` — `normalizeOrders(mlOrders, mlItems, mlPayments): NormalizedCommerceTransaction[]`. Handle: multi‑item (one per line‑item), multi‑pack, cancelled orders, PII stripping (no buyer names/emails/phones), partial payment, quantity > 1. Use `Money` domain type.
- [x] 3.2 Write normalization unit tests — multi‑item, cancelled, PII, CLP/USD amounts, edge cases from spec.

## Phase 4: Economic Adapters (Core Logic)

- [x] 4.1 Create `packages/agent/src/economics/adapters/orderRevenue.ts` — `(tx: NormalizedCommerceTransaction) → RevenueResult | null`. Paid orders → `grossRevenue`; cancelled → null. Revenue is NOT a cost component — feeds directly into UnitEconomicsInput.
- [x] 4.2 Create `packages/agent/src/economics/adapters/marketplaceFee.ts` — `(tx, feeData) → EconomicCostComponent[]`. Real `sale_fee_amount` → `marketplace_fee`; missing → empty, flag in output.
- [x] 4.3 Create `packages/agent/src/economics/adapters/shippingCost.ts` — seller‑paid shipping only. Buyer‑paid, cancelled → no component.
- [x] 4.4 Create `packages/agent/src/economics/adapters/sellerDiscount.ts` — seller‑funded portion only. ML‑funded → empty.
- [x] 4.5 Create `packages/agent/src/economics/adapters/refundReturn.ts` — refund/return per real semantics, linked to item. Revenue stays gross; refund is separate cost.
- [x] 4.6 Create `packages/agent/src/economics/adapters/advertisingCost.ts` — real ad cost per order/campaign. Campaign‑level → `source:derived` with allocation docs.
- [x] 4.7 Create 6 stub adapters — `productCost.ts`, `landedCost.ts`, `packaging.ts`, `financing.ts`, `tax.ts`, `other.ts` — all return empty arrays; declare `missingInputs`.
- [x] 4.8 Create `packages/agent/src/economics/adapters/index.ts` — barrel export for all adapters and data types.
- [x] 4.9 Write adapter unit tests — per‑adapter test files with ML mock data, edge cases from `economic-adapters` spec.

## Phase 5: Ingestion Pipeline (Orchestration)

- [ ] 5.1 Create `EconomicIngestionPipeline.ts` — 16‑stage flow: resolve seller → verify read‑readiness → acquire lock → recover checkpoint → fetch orders/items/payments/shipments/claims/ads → normalize → strip PII → build evidence refs → run adapters → evaluate missing inputs → compute snapshot → persist → reconcile → advance checkpoint → emit metrics → release lock. Seller‑scoped.
- [ ] 5.2 Create `EconomicReconciliationService.ts` — compare source totals vs computed: `balanced | balanced‑with‑tolerance | incomplete | mismatched | disputed`. Store reconciliation records.
- [ ] 5.3 Create `EconomicIngestionRun.ts` — run state machine: `pending → fetching → normalizing → adapting → computing → persisting → completed | failed`. Reuses operational checkpoint pattern.
- [ ] 5.4 Write pipeline integration tests — mock `MlcApiClient`, end‑to‑end: orders → adapters → snapshot → store query.

## Phase 6: Worker/Daemon

- [ ] 6.1 Create `packages/agent/src/workers/economicIngestionDaemon.ts` — `DaemonHandler`. Reads `MSL_ECONOMIC_INGESTION_ENABLED`; no‑ops if `false`. Checkpoint‑based, seller‑scoped. Abort signal, dry‑run, resume.
- [ ] 6.2 Register in `packages/agent/src/workers/daemonScheduler.ts` — add `economic-ingestion` lane to `daemonHandlerMap`, `SESSION_LANE_IDS`, `enqueueDaemonTick`. Default: off unless env flag.
- [ ] 6.3 Export from `packages/agent/src/index.ts`.
- [ ] 6.4 Write daemon unit tests — feature‑gate off, on, abort mid‑run, checkpoint resume.

## Phase 7: Finance Director Tools

- [x] 7.1 Add tools to `packages/agent/src/conversation/tools/economicTools.ts` — `inspect_cost_components`, `inspect_evidence_references`, `inspect_coverage`, `reconcile_seller_economics`. Follow existing `create*Tool(store?)` pattern.
- [x] 7.2 Wire real data — ensure tools consume `EconomicOutcomeStore` methods (cost components, snapshots). Empty result with guidance when no ingestion data exists.
- [x] 7.3 Write tool tests — mock store, verify output shape and `noExternalMutationExecuted`.

## Phase 8: Readiness & Health

- [x] 8.1 Add `"real-economic-ingestion"` to `ProductionCapability` union in `packages/domain/src/productionReadiness.ts`.
- [x] 8.2 Register `MSL_ECONOMIC_INGESTION_ENABLED` in `packages/agent/src/readiness/productionConfig.ts` — sensitivity `public`, capability `real-economic-ingestion`, `alwaysOptional: true`, default missing → disabled.
- [x] 8.3 Add checker logic in `FeatureGateReadinessChecker` — verify feature flag honored, gate status.
- [x] 8.4 Add runtime health event for ingestion run status in `systemHealthDaemon.ts`.

## Phase 9: CLI

- [x] 9.1 Add npm scripts in root `package.json` — `economic:ingest`, `economic:status`, `economic:coverage`, `economic:reconcile`, `economic:missing`.
- [x] 9.2 Create `packages/agent/src/cli/economicCli.ts` — handler for each command, JSON output via `--json`, support `--seller`, `--dry-run`, `--max-pages`.
- [x] 9.3 Write CLI tests — dry‑run produces valid JSON, feature‑flag off returns status.

## Phase 10: Documentation & Archive

- [x] 10.1 Create `docs/operations/real-ingestion-economic-adapters.md` — operational runbook: commands, env vars, troubleshooting.
- [x] 10.2 Update `ARCHITECTURE.md` — add ingestion pipeline layer to data‑flow diagram.
- [x] 10.3 Update `.env.example` — add `MSL_ECONOMIC_INGESTION_ENABLED=false`.
- [x] 10.4 Archive SDD — move `openspec/changes/real-ingestion-economic-adapters/` to `openspec/changes/archive/` after verification.
