# Operational Lane Evidence Specification

## Purpose

Provide per-lane operational evidence for CEO/specialist conversations by mapping lane contracts to business signals and formatting operational DB snapshots into LLM-readable context strings.

## Requirements

### Requirement: Lane-to-Signal Evidence Mapping

The system MUST maintain a hardcoded mapping from `LaneContract.requiredEvidenceKinds` to `BusinessSignalKind[]`. `OperationalEvidenceProvider.getEvidenceForLane(laneId, sellerId)` SHALL query `OperationalReadModelReader.findEvidence` per signal kind and return formatted context with evidence IDs and `captured_at` timestamps.

#### Scenario: Cost lane evidence retrieval

- GIVEN lane "cost" requires listing and order signal kinds
- WHEN `getEvidenceForLane("cost", sellerId)` is called
- THEN it MUST return formatted context for listing and order evidence with IDs and timestamps

#### Scenario: Unknown lane requested

- GIVEN a lane ID with no mapping entry
- WHEN `getEvidenceForLane` is called
- THEN it MUST return empty context without error

### Requirement: Operational Context Formatting

The system MUST format each evidence item as a compact line for LLM prompt injection, including evidence ID, signal kind, and `captured_at` timestamp. Each line SHALL be ≤ 80 chars.

#### Scenario: Evidence formatted for prompt injection

- GIVEN listing evidence with ID "evt-42" and captured_at "2026-07-02T10:00:00Z"
- WHEN formatted
- THEN output MUST include both the ID and captured_at value

#### Scenario: Multiple evidence items

- GIVEN three evidence items for a lane
- WHEN formatted for prompt use
- THEN each item MUST appear on its own line with its ID and timestamp
