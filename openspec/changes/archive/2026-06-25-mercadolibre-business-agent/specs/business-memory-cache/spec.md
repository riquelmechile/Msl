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
