# Delta for Business Memory Cache

## MODIFIED Requirements

### Requirement: Operational Business Read Model

The system MUST maintain a local SQLite operational read model for listings, claims, questions, orders, messages, reputation, and `product-ads-insights` snapshots, separate from Cortex durable learning, backed by `@msl/memory` with deterministic evidence IDs, freshness/completeness/confidence metadata, and per-kind ingestion checkpoints.
(Previously: operational read model covered listings, claims, questions, orders, messages, and reputation only.)

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

The system MUST persist operational snapshots of any entity kind (listing, claim, question, order, message, reputation, `product-ads-insights`) in `@msl/memory` via `better-sqlite3` with columns: `seller_id`, `item_id`, `kind`, `data` (JSON), `source`, `captured_at`, `freshness`, `completeness`, `confidence`, `evidence_id` (deterministic format `orm:{kind}:{sellerId}:{itemId}:{capturedAt}`; for reputation, `itemId` SHALL be the snapshot period; for `product-ads-insights`, `itemId` SHALL identify the seller-level date range). The store MUST use WAL mode and accept an injected `Database.Database` handle. Reads MUST be local-first when `fresh + complete + non-low confidence`.
(Previously: persisted operational kinds excluded `product-ads-insights`.)

#### Scenario: Fresh operational snapshot served from local store

- GIVEN a snapshot with freshness="fresh", completeness="complete", confidence≥0.7 for any kind
- WHEN a lane reads operational evidence
- THEN the system MUST return the local snapshot with evidence_id and NOT call ML APIs

#### Scenario: Stale or partial snapshot triggers refresh-needed

- GIVEN a snapshot with freshness≠"fresh" or completeness≠"complete"
- WHEN a lane reads operational evidence
- THEN the system MUST mark it refresh-required and MUST NOT claim current ML truth

### Requirement: Ingestion Checkpoints

The system MUST persist ingestion checkpoints per `seller_id` and `kind` so background sync resumes from the last `captured_at` without re-ingesting the full catalog or repeatedly replaying seller-level snapshot kinds such as `product-ads-insights`. For seller-level Product Ads snapshots, the date range identity SHALL live in the snapshot `item_id`, not in the checkpoint key.
(Previously: checkpoints did not explicitly cover Product Ads seller snapshots.)

#### Scenario: Checkpoint resume after partial ingestion
- GIVEN a checkpoint exists for seller "Plasticov", kind "listing"
- WHEN background ingestion runs
- THEN it MUST start queries after the checkpoint timestamp
- AND it MUST update the checkpoint on successful batch completion

#### Scenario: Product Ads checkpoint after persistence
- GIVEN a seller-level `product-ads-insights` snapshot is persisted successfully
- WHEN the ingestion cycle completes that kind
- THEN the system MUST update the `product-ads-insights` checkpoint for that seller

### Requirement: Multi-Kind Operational Ingestion

The system MUST ingest claims, questions, orders, messages, reputation, and `product-ads-insights` snapshots by kind. Processors SHALL follow the `processSellerListings` pattern per kind. Product Ads ingestion MUST be safe-read only, preserve `noMutationExecuted`, persist ROAS-oriented metadata, and treat disabled/no-permission Product Ads states as graceful no-data.
(Previously: ingestion covered five non-listing entity kinds and did not persist Product Ads insights.)

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
