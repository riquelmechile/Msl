# Proposal: Operational Full-Context Ingestion

## Intent

Extend the operational read model from listings-only to all 5 MercadoLibre business entity types — claims, questions, orders, messages, reputation — so the CEO/Socio agent has complete historical context for Darwinian learning. The agent learns from real outcomes (resolved claims, answered questions, order patterns, reputation trends), not just current snapshots. The existing `kind TEXT` schema already supports arbitrary values; this change widens the ingestion scope without schema migration.

## Scope

### In Scope
- 5 entity types: claims, questions, orders, messages, reputation
- Summary-level fields per entity (not full detail trees)
- Full pagination with configurable per-kind page limit (default 100, configurable to 1)
- Dual-write orders to Cortex + operational DB (preserve existing Cortex path)
- Per-kind freshness defaults and checkpoint resume per `(seller_id, kind)`
- Add `getQuestions` safe-read to `MlcApiClient`

### Out of Scope
- ML mutations, customer responses, production actions
- Full detail trees (claim messages, order line items, full conversation threads)
- Cortex edge-weight feeding during ingestion (ingestion = storage, learning = separate step)
- Removal of existing Cortex order path

## Capabilities

### New Capabilities
None

### Modified Capabilities
- `business-memory-cache`: extend operational snapshot scope from listings-only to claims, questions, orders, messages, and reputation with summary-field schemas, per-kind freshness, and configurable pagination limits.
- `ml-questions-answer`: add safe-read `getQuestions` to `MlcApiClient` using existing `normalizeQuestions` + `/questions/search` endpoint.

## Approach

Extend the proven ingestion pattern: API call → paginate entities → upsert snapshot → checkpoint. Each entity type gets its own processor following `processSellerListings` structure, wired into the background ingestion loop.

**Entity summary fields:**

| Kind | Key Fields |
|------|-----------|
| `claim` | id, type, stage, status, date, resolution |
| `question` | id, text, answer_text, status, date, outcome (sale/problem) |
| `order` | id, status, date, total, buyer_id |
| `message` | id, role, date, snippet (500 chars), status |
| `reputation` | level, color, power_seller_status, transactions (completed/cancelled/delayed), claims_rate, metrics_period — one snapshot per cycle for trend analysis |

**Darwinian contract**: Data lands in SQLite. Cortex queries it later via existing `get_business_context` tool. No edge-weight logic in ingestion. Clean storage/learning separation.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modified | 5 processor functions + `run()` loop wiring |
| `packages/mercadolibre/src/index.ts` | Modified | `getQuestions` on `MlcApiClient` (~50 lines) |
| `packages/memory/src/operationalReadModel.ts` | Unchanged | Schema already generic; no DDL needed |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| API rate limits (5× entity calls) | Medium | Configurable per-kind page limit; backoff+jitter handles 429/5xx |
| Scope creep (full detail trees) | Low | Summary fields only; detail deferred |
| Orders dual-write inconsistency | Low | Independent upserts; no cross-store transaction needed |
| Reputation polling waste | Low | Once-per-cycle sampling; freshness reflects cycle cadence |

## Rollback Plan

Remove new processor functions from `run()` loop. Checkpoint rows remain harmless (future cycles skip unregistered kinds). No schema migration to revert.

## Dependencies

- Existing `MlcApiClient` methods: `searchClaims`, `getOrders`, `getMessages`, `getReputation` (already typed)
- Existing `operationalReadModel` schema (already supports arbitrary `kind`)
- Existing `normalizeQuestions` in MercadoLibre package (already tested)

## Success Criteria

- [ ] All 5 entity types ingested and stored with correct `kind` values
- [ ] Checkpoints resume per `(seller_id, kind)` without data loss
- [ ] CEO can cite operational evidence via existing `get_business_context` tool
- [ ] Reputation trend data (≥2 snapshots) visible per seller across cycles
- [ ] Full pagination stores all entities with zero lost pages
- [ ] Configurable page limit guards against runaway cycles
