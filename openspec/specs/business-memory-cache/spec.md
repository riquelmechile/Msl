# Business Memory Cache Specification

## Purpose

Define local-first business memory for seller data, learned judgment, and freshness-aware synchronization.

## Requirements

### Requirement: Local-First Business Memory

The system MUST persist seller business context locally, including listings, sales, interactions, pricing, reputation signals, and learned preferences.

#### Scenario: Agent answers from memory

- GIVEN relevant local data is fresh enough for the question
- WHEN the seller asks for analysis
- THEN the system MUST use local memory before requesting remote data

#### Scenario: Sensitive data sync

- GIVEN data is not required outside the local environment
- WHEN synchronization is considered
- THEN the system MUST keep it local unless selective sync is explicitly needed

### Requirement: Freshness by Business Risk

The system MUST refresh data according to business risk, cost, and volatility, with near-real-time handling for critical signals.

#### Scenario: Critical signal changes

- GIVEN an order, claim, cancellation, stock, or reputation signal may affect business risk
- WHEN the signal becomes stale
- THEN the system MUST prioritize refresh without wasteful polling

#### Scenario: Low-risk data is requested

- GIVEN cached low-risk historical data is available
- WHEN the seller requests a summary
- THEN the system SHOULD avoid unnecessary remote refresh

### Requirement: Read Snapshot Metadata

The system MUST represent read-tool snapshots with enough metadata for downstream business reasoning: source, observed freshness, confidence, and whether the result is complete or partial.

#### Scenario: Fresh snapshot is returned

- GIVEN a read tool receives authorized seller data
- WHEN it normalizes the business snapshot
- THEN the snapshot MUST include source, freshness, and confidence metadata
- AND consumers MUST be able to determine whether the data is fresh enough for analysis

#### Scenario: Snapshot is stale or incomplete

- GIVEN read evidence is stale, missing, or incomplete
- WHEN the snapshot is returned
- THEN the metadata MUST expose the stale or partial state
- AND the system SHOULD avoid presenting it as fully reliable

### Requirement: Small Fresh-Enough Snapshot Contract

The system MUST support small, fresh-enough snapshots for listings, orders, messages, and reputation so read tools can answer immediate business questions without adding durable persistence in this slice.

#### Scenario: Snapshot is sufficient for immediate read

- GIVEN a requested snapshot has acceptable freshness for its business risk
- WHEN the agent needs read-only business context
- THEN the system MAY use that snapshot without forcing a remote refresh

#### Scenario: Snapshot cannot satisfy freshness

- GIVEN a requested snapshot is not fresh enough for the business risk
- WHEN the agent needs read-only business context
- THEN the system MUST mark the snapshot as insufficient or refresh-required
- AND it MUST NOT claim high confidence from stale data

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

### Requirement: Evidence ID Traceability

The system MUST attach evidence IDs to lane outputs and CEO proposals so recommendations can be audited back to local snapshots or Cortex nodes.

#### Scenario: Lane cites evidence

- GIVEN a lane produces a recommendation
- WHEN it returns output to the CEO lane
- THEN it MUST include evidence IDs, freshness state, and completeness state

#### Scenario: Volatile evidence changes

- GIVEN volatile business evidence changes during refresh
- WHEN prompts are assembled for DeepSeek
- THEN volatile evidence MUST remain outside immutable cache prefixes

### Requirement: Cache Is Not Durable Memory

The system MUST treat DeepSeek prompt caching as a cost optimization only; durable facts, evidence, approvals, rejections, and outcomes MUST be stored in local persistence or Cortex as appropriate.

#### Scenario: Cached prompt reused

- GIVEN a stable lane prefix receives cache hits
- WHEN the lane reasons again
- THEN the cache MAY reduce cost
- AND the system MUST NOT infer that the cache preserved business state

#### Scenario: Cache is cold

- GIVEN cache hit tokens are low or zero
- WHEN the lane runs
- THEN the recommendation MUST remain correct using persisted evidence

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
