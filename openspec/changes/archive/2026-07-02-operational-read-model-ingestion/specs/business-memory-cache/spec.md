# Delta for business-memory-cache

## ADDED Requirements

### Requirement: SQLite Operational Snapshot Persistence

The system MUST persist listing/catalog snapshots in `@msl/memory` via `better-sqlite3` with columns: `seller_id`, `item_id`, `kind`, `data` (JSON), `source`, `captured_at`, `freshness`, `completeness`, `confidence`, `evidence_id` (deterministic format `orm:{kind}:{sellerId}:{itemId}:{capturedAt}`). The store MUST use WAL mode and accept an injected `Database.Database` handle. Reads MUST be local-first when `fresh + complete + non-low confidence`.

#### Scenario: Fresh listing served from local store
- GIVEN a snapshot with freshness="fresh", completeness="complete", confidence≥0.7
- WHEN a lane reads listing evidence
- THEN the system MUST return the local snapshot with evidence_id and NOT call ML APIs

#### Scenario: Stale or partial snapshot triggers refresh-needed
- GIVEN a snapshot with freshness≠"fresh" or completeness≠"complete"
- WHEN a lane reads listing evidence
- THEN the system MUST mark it refresh-required and MUST NOT claim current ML truth

### Requirement: Ingestion Checkpoints

The system MUST persist ingestion checkpoints per `seller_id`, `kind`, and filter status so background sync resumes from the last `captured_at` without re-ingesting the full catalog.

#### Scenario: Checkpoint resume after partial ingestion
- GIVEN a checkpoint exists for seller "Plasticov", kind "listing"
- WHEN background ingestion runs
- THEN it MUST start queries after the checkpoint timestamp
- AND it MUST update the checkpoint on successful batch completion

### Requirement: Cache-Efficient Summary Aggregates

The system MUST produce compact summary aggregates (count, min, max, top-N by recency) shaped for DeepSeek immutable prefix caching. Volatile evidence (individual item data, current prices) MUST reside outside cacheable prefixes.

#### Scenario: Stable prefix includes summary only
- GIVEN a lane policy prefix is cacheable
- WHEN prompts are assembled
- THEN summary aggregates MAY sit in cacheable blocks
- AND per-item listing data MUST remain in refreshable context

## MODIFIED Requirements

### Requirement: Operational Business Read Model

The system MUST maintain a local SQLite operational read model for catalog/listings snapshots, separate from Cortex durable learning, backed by `@msl/memory` with deterministic evidence IDs, freshness/completeness/confidence metadata, and ingestion checkpoints.
(Previously: Required a local read model without specifying SQLite persistence or deterministic evidence IDs.)

#### Scenario: Full catalog snapshot used locally
- GIVEN a fresh-enough local catalog snapshot exists
- WHEN a specialist lane analyzes stock, rotation, claims, or reputation
- THEN it MUST use the local read model before remote reads
- AND it MUST cite stable evidence IDs

#### Scenario: Snapshot missing or stale
- GIVEN required evidence is missing, stale, or partial
- WHEN a proposal depends on that evidence
- THEN the output MUST mark freshness limits and avoid high-confidence claims
