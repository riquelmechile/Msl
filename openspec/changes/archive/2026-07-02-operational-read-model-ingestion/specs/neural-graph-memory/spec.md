# Delta for neural-graph-memory

## ADDED Requirements

### Requirement: No Operational Snapshots in Cortex

Cortex MUST NOT store listing snapshots, catalog data, or ingestion checkpoints. Operational facts MUST live in the `@msl/memory` SQLite operational read model only. The ingestion pipeline MUST dual-write: operational snapshots to the read model, distilled signals to Cortex.

#### Scenario: Ingestion writes listing to operational store only
- GIVEN background ingestion processes a MercadoLibre listing
- WHEN the listing snapshot is captured
- THEN the full snapshot MUST be persisted to the operational read model
- AND only distilled signals (learned category preference, pricing pattern) MAY reach Cortex

#### Scenario: Cortex queried for catalog evidence
- GIVEN a lane queries Cortex for full catalog data
- WHEN Cortex traversal runs
- THEN it MUST return learned judgment and distilled lessons only
- AND MUST NOT return listing snapshots or catalog pages

## MODIFIED Requirements

### Requirement: Cortex and Read Model Boundary

Cortex MUST store durable learned judgment, relationships, and distilled lessons; it MUST NOT persist listing snapshots, catalog data, or ingestion checkpoints. Operational evidence MUST reside in the `@msl/memory` SQLite read model. Full catalog reads (freshness, completeness, pagination) MUST route to the operational read model, never Cortex.

(Previously: Required separation but did not explicitly prohibit Cortex from storing listing/catalog operational snapshots.)

#### Scenario: Full catalog needed
- GIVEN a lane needs complete catalog or freshness metadata
- WHEN it requests evidence
- THEN it MUST read from the operational read model, not Cortex graph traversal

#### Scenario: Learned judgment needed
- GIVEN the CEO lane needs seller preference or prior decision context
- WHEN it requests reasoning context
- THEN it MAY use Cortex lessons and activated concepts
