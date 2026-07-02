## Exploration: Extend operational ingestion to claims, questions, and other MercadoLibre business data

### Current State

The `operational-read-model-ingestion` change delivered a SQLite-backed operational read model in `@msl/memory` with:
- `operational_snapshots` table — PK `(seller_id, item_id, kind TEXT)`, stores `evidence_id`, `data_json`, freshness/completeness/confidence metadata
- `ingestion_checkpoints` table — PK `(seller_id, kind)`, resumes partial cycles
- `BackgroundIngestionConfig` with optional `operationalStore?: OperationalReadModelWriter` for dual-write
- Dual-write in `processSellerListings`: operational store upsert per listing before Cortex `getOrCreateNode`; checkpoint after loop

Currently ONLY `kind: "listing"` snapshots are ingested. The 6-hour cycle processes: listings → visits → orders → quality → relist → seasonal → pruning → alerts → DeepSeek insights.

`MlcApiClient` (the safe-read client used by ingestion) has: `getListings`, `getItem`, `getOrders`, `getMessages`, `getReputation`, `searchClaims?`, `getClaimDetail?`, `getItemVisits?`, `getItemPerformance?`, and 30+ other optional methods. `searchClaims` is fully typed, normalized, and tested. `getQuestions` exists only on the legacy `MlClient`, NOT on `MlcApiClient`.

Domain layer defines `MlClaim` (claim.ts), `MlMessage` (message.ts), `MlOrder` (order.ts), and `SellerReputation` (reputation.ts). `BusinessSignalKind` includes `"claim"`, `"order"`, `"message"`, `"reputation"`.

`CacheFreshness` treats claims as `"critical"` risk (5-minute max age), same as orders.

Background ingestion is wired via `startBackgroundIngestion` in `packages/bot/src/index.ts` with 6-hour interval, two seller IDs (Plasticov + Maustian), and optional DeepSeek API key.

### Affected Areas

- `packages/memory/src/operationalReadModel.ts` — schema already supports multiple `kind` values; no schema change needed. The `item_id` column is used as generic entity ID (works for claim_id, question_id, order_id as entity identifiers)
- `packages/agent/src/conversation/backgroundIngestion.ts` — needs new `processSellerClaims` and `processSellerQuestions` functions following the same dual-write pattern as `processSellerListings`; needs wiring in the main `run()` loop
- `packages/mercadolibre/src/index.ts` — `searchClaims` already exists on `MlcApiClient` (line 3459, optional); `getQuestions` does NOT exist on `MlcApiClient` and would need to be added (the `normalizeQuestions` function and `MlClient.getQuestions` exist but target the legacy `MlClient` interface)
- `packages/domain/src/cacheFreshness.ts` — `BusinessSignalKind` already includes `"claim"`, `"order"`, `"message"`, `"reputation"`; fresh/stale evaluation already handles critical risk for claims (5-min max age). No domain change needed.
- `packages/bot/src/index.ts` — ingestion already wired with `startBackgroundIngestion`; extension is transparent to the bot wiring

### Approaches

1. **Claims-first: add `processSellerClaims` only** — Ingest claims via `searchClaims` (already available on `MlcApiClient`), store with `kind: "claim"`, checkpoint per `(seller_id, "claim")`. Add to the main ingestion loop between orders and quality checks.
   - Pros: Highest business value (disputes, reputation risk, refunds); `searchClaims` is already fully typed, normalized, and tested; zero new MercadoLibre client work; low risk; minimal PR size (~200-300 lines)
   - Cons: Only covers claims; questions need separate work
   - Effort: Low

2. **Claims + Questions: add both `processSellerClaims` and `processSellerQuestions`** — Same as above, PLUS add `getQuestions` to `MlcApiClient` using the existing `normalizeQuestions` function and wire it into the ingestion loop.
   - Pros: Complete "customer-facing operations" coverage (disputes + inquiries); both are the most actionable for CEO lane context
   - Cons: Requires adding `getQuestions` to `MlcApiClient` (safe-read client) — this is ~50 lines of method + type registration but crosses the mercadolibre package boundary; pushes PR size toward 400-600 lines
   - Effort: Medium

3. **Full expansion: claims, questions, orders, messages, reputation** — Add all five entity types to ingestion.
   - Pros: Complete business context for CEO
   - Cons: PR size well beyond review budget (>1000 lines); API call count per cycle increases significantly; orders and messages are partially ingested into Cortex already; risk of rate limiting
   - Effort: High

### Recommendation

**Approach 2: Claims + Questions in a single slice.**

Both are "priority customer-facing" entities that a CEO needs to monitor: disputes (claims) and unanswered buyer questions directly impact seller reputation, cash flow, and MercadoLibre ranking. The implementation is straightforward:

1. **Claims**: `searchClaims` is already available on `MlcApiClient` with full normalization. Add `processSellerClaims` that calls `searchClaims`, upserts each claim as `kind: "claim"` with `evidence_id: orm:claim:{sellerId}:{claimId}:{capturedAt}`, and saves a checkpoint `(seller_id, "claim")`.

2. **Questions**: Add `getQuestions` to `MlcApiClient` by exposing the existing `normalizeQuestions` function + `/questions/search` endpoint. Add `processSellerQuestions` that calls it, upserts each question as `kind: "question"`, and saves a checkpoint `(seller_id, "question")`.

Both follow the EXACT same pattern proven by `processSellerListings`: API call → loop entity → upsert snapshot → checkpoint. The schema needs zero changes — `kind TEXT` already supports arbitrary values, and the `item_id` column serves as a generic entity ID.

Orders, messages, and reputation should be deferred to follow-up changes to keep this PR reviewable. Orders are already partially ingested into Cortex; messages and reputation change infrequently and add less urgency.

Expected PR size: ~400-550 changed lines (claims processor ~150L, questions processor ~150L, MlcApiClient `getQuestions` ~50L, tests ~200L). Within the 800-line review budget.

### Risks

- **API rate limits**: Minimal. `searchClaims` and `getQuestions` are each one API call per seller per cycle. The existing per-listing visit calls (200+ per cycle) are the dominant load. Backoff + jitter already handles 429/5xx.
- **Entity ID collision**: The `item_id` column stores listing IDs today. For claims and questions, it would store `claim_id` / `question_id`. PK is `(seller_id, item_id, kind)` — so `kind: "claim"` rows won't collide with `kind: "listing"` rows, even if by coincidence an ID matches. This is safe.
- **Scope creep**: Claims and questions pull in significant data. Limit ingestion to summary fields (status, type, date) — not full claim detail/messages or full question text. The normalized summaries are already compact.
- **Checkpoint granularity**: Claims API supports pagination and status filters. First slice should fetch ALL claims (no status filter) to keep it simple. Pagination follow-up can be deferred.

### Ready for Proposal

Yes — propose a change `operational-claims-questions-ingestion` that:
1. Adds `getQuestions` to `MlcApiClient` using existing `normalizeQuestions` + `/questions/search` endpoint
2. Adds `processSellerClaims(config, sellerId, sellerName)` with dual-write to operational store
3. Adds `processSellerQuestions(config, sellerId, sellerName)` with dual-write to operational store
4. Wires both into the ingestion `run()` loop between orders and quality phases
5. Keeps orders, messages, and reputation OUT of scope for this slice
