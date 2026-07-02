# Delta for business-memory-cache

## ADDED Requirements

### Requirement: Multi-Kind Operational Ingestion

The system MUST ingest claims, questions, orders, messages, and reputation snapshots by kind. Processors SHALL follow the `processSellerListings` pattern per kind. Summary fields:

| Kind | Fields |
|------|--------|
| claim | id, type, stage, status, date, resolution |
| question | id, text, answer_text, status, date, outcome |
| order | id, status, date, total, buyer_id |
| message | id, role, date, snippet (≤500 chars), status |
| reputation | level, color, power_seller_status, transactions, claims_rate, metrics_period — one snapshot per cycle |

#### Scenario: All five entity types ingested

- GIVEN a seller with data across all five entity kinds
- WHEN background ingestion runs a full cycle
- THEN all five kinds MUST be ingested with correct summary fields
- AND the store MUST contain independent snapshots per kind

#### Scenario: Unknown kind is skipped

- GIVEN an API returns an entity with an unrecognized kind
- WHEN the ingestion processor encounters it
- THEN it MUST skip that entity and log the unknown kind without failing the cycle

### Requirement: Per-Kind Ingestion Tuning

The system MUST apply per-kind freshness defaults and per-kind configurable page limits (default 100, configurable to 1) to guard rate exhaustion. Reputation SHALL accumulate ≥2 snapshots per seller across cycles for trend analysis.

#### Scenario: Per-kind freshness and pagination applied

- GIVEN configuration sets page limit 50 for orders and 1 for reputation
- WHEN background ingestion runs
- THEN orders SHALL page up to 50 items per request
- AND reputation SHALL ingest at most 1 snapshot per cycle

#### Scenario: Reputation trend accumulates

- GIVEN reputation snapshots from ≥2 cycles for the same seller
- WHEN a lane or CEO queries reputation context
- THEN the system MUST return ≥2 timestamped snapshots

#### Scenario: Page limit guards rate budget

- GIVEN five entity kinds plus existing listing ingestion
- WHEN page limit is reduced to 1
- THEN the cycle SHALL complete without exhausting rate budget

## MODIFIED Requirements

### Requirement: Operational Business Read Model

The system MUST maintain a local SQLite operational read model for listings, claims, questions, orders, messages, and reputation snapshots, separate from Cortex durable learning, backed by `@msl/memory` with deterministic evidence IDs, freshness/completeness/confidence metadata, and per-kind ingestion checkpoints.
(Previously: catalog/listings only; expanded to all five entity kinds.)

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

The system MUST persist operational snapshots of any entity kind (listing, claim, question, order, message, reputation) in `@msl/memory` via `better-sqlite3` with columns: `seller_id`, `item_id`, `kind`, `data` (JSON), `source`, `captured_at`, `freshness`, `completeness`, `confidence`, `evidence_id` (deterministic format `orm:{kind}:{sellerId}:{itemId}:{capturedAt}`; for reputation, `itemId` SHALL be the snapshot period). The store MUST use WAL mode and accept an injected `Database.Database` handle. Reads MUST be local-first when `fresh + complete + non-low confidence`.
(Previously: listing/catalog only; expanded to all entity kinds with reputation period semantics.)

#### Scenario: Fresh operational snapshot served from local store

- GIVEN a snapshot with freshness="fresh", completeness="complete", confidence≥0.7 for any kind
- WHEN a lane reads operational evidence
- THEN the system MUST return the local snapshot with evidence_id and NOT call ML APIs

#### Scenario: Stale or partial snapshot triggers refresh-needed

- GIVEN a snapshot with freshness≠"fresh" or completeness≠"complete"
- WHEN a lane reads operational evidence
- THEN the system MUST mark it refresh-required and MUST NOT claim current ML truth
