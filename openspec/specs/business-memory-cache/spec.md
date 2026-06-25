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
