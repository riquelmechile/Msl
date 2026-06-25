# Delta for business-memory-cache

## ADDED Requirements

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
