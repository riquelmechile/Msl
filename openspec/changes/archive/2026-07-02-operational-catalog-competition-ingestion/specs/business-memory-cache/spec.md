# Delta for Business Memory Cache

## MODIFIED Requirements

### Requirement: Operational Business Read Model

The system MUST maintain a local SQLite operational read model for listings, claims, questions, orders, messages, reputation, `product-ads-insights`, and `pricing` snapshots, separate from Cortex durable learning, backed by `@msl/memory` with deterministic evidence IDs, freshness/completeness/confidence metadata, and per-kind ingestion checkpoints.
(Previously: operational read model covered listings, claims, questions, orders, messages, reputation, and `product-ads-insights` snapshots only.)

#### Scenario: Fresh-enough local snapshot used across entity kinds
- GIVEN a fresh-enough local snapshot exists for any entity kind
- WHEN a specialist lane analyzes business context
- THEN it MUST use the local read model before remote reads
- AND it MUST cite stable evidence IDs per kind

#### Scenario: Snapshot missing or stale
- GIVEN required evidence is missing, stale, or partial for any kind
- WHEN a proposal depends on that evidence
- THEN the output MUST mark freshness limits and avoid high-confidence claims

### Requirement: SQLite Operational Snapshot Persistence

The system MUST persist operational snapshots of any entity kind (listing, claim, question, order, message, reputation, `product-ads-insights`, `pricing`) in `@msl/memory` via `better-sqlite3` with columns: `seller_id`, `item_id`, `kind`, `data` (JSON), `source`, `captured_at`, `freshness`, `completeness`, `confidence`, `evidence_id`. Evidence IDs MUST be deterministic as `orm:{kind}:{sellerId}:{itemId}:{capturedAt}`; for reputation, `itemId` SHALL be the snapshot period; for `product-ads-insights`, `itemId` SHALL identify the seller-level date range. Reads MUST be local-first when `fresh + complete + non-low confidence`.
(Previously: persisted operational kinds excluded `pricing`.)

#### Scenario: Fresh operational snapshot served from local store
- GIVEN a snapshot with freshness="fresh", completeness="complete", confidence≥0.7 for any kind
- WHEN a lane reads operational evidence
- THEN the system MUST return the local snapshot with evidence_id and NOT call ML APIs

#### Scenario: Stale or partial snapshot triggers refresh-needed
- GIVEN a snapshot with freshness≠"fresh" or completeness≠"complete"
- WHEN a lane reads operational evidence
- THEN the system MUST mark it refresh-required and MUST NOT claim current ML truth

### Requirement: Ingestion Checkpoints

The system MUST persist ingestion checkpoints per `seller_id` and `kind` so background sync records the last successful per-kind batch without re-ingesting the full catalog or repeatedly replaying seller-level snapshot kinds such as `product-ads-insights`. `pricing` ingestion MUST use its own checkpoint as a cadence marker, while deterministic bounded item rotation prevents repeatedly reading only the first catalog items.
(Previously: checkpoints did not mention `pricing` price-to-win ingestion.)

#### Scenario: Checkpoint resume after partial ingestion
- GIVEN a checkpoint exists for seller "Plasticov", kind "listing"
- WHEN background ingestion runs
- THEN it MUST start queries after the checkpoint timestamp
- AND it MUST update the checkpoint on successful batch completion

#### Scenario: Product Ads checkpoint after persistence
- GIVEN a seller-level `product-ads-insights` snapshot is persisted successfully
- WHEN the ingestion cycle completes that kind
- THEN the system MUST update the `product-ads-insights` checkpoint for that seller

#### Scenario: Pricing checkpoint and rate guard
- GIVEN `pricing` ingestion already processed a bounded item batch
- WHEN the next background cycle runs
- THEN it MUST use the `pricing` checkpoint to record cadence
- AND it MUST use deterministic bounded rotation instead of replaying the full catalog or always reading the same first items

### Requirement: Multi-Kind Operational Ingestion

The system MUST ingest claims, questions, orders, messages, reputation, `product-ads-insights`, and `pricing` snapshots by kind. Processors SHALL follow the `processSellerListings` pattern per kind. `pricing` ingestion MUST be safe-read only, call existing price-to-win reads with a bounded per-cycle item cap, persist catalog competition fields when available, preserve `noMutationExecuted`, and treat unsupported, unauthorized, non-catalog, or no-data items as graceful skips.
(Previously: ingestion kinds excluded `pricing` catalog competition snapshots.)

#### Scenario: All operational entity types ingested
- GIVEN a seller with data across supported operational kinds
- WHEN background ingestion runs a full cycle
- THEN all available kinds MUST be ingested with correct summary fields
- AND the store MUST contain independent snapshots per kind

#### Scenario: Product Ads unavailable
- GIVEN Product Ads is disabled or unauthorized for a seller
- WHEN Product Ads ingestion runs
- THEN the cycle MUST skip that seller snapshot as no-data without failing
- AND it MUST NOT execute mutations

#### Scenario: Bounded price-to-win ingestion
- GIVEN a seller has more catalog items than the configured `pricing` cap
- WHEN `pricing` ingestion runs
- THEN it MUST read at most the configured item cap
- AND persist successful price-to-win results as `pricing` snapshots

#### Scenario: Unsupported catalog competition skipped safely
- GIVEN an item is unsupported, unauthorized, non-catalog, or returns no price-to-win data
- WHEN `pricing` ingestion reads that item
- THEN the cycle MUST skip or mark partial evidence without failing
- AND it MUST NOT mutate prices or generate AI images
