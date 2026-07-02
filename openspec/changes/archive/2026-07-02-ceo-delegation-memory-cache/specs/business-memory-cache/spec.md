# Delta for business-memory-cache

## ADDED Requirements

### Requirement: Operational Business Read Model

The system MUST maintain a local operational read model for full catalog and business snapshots, separate from Cortex durable learning.

#### Scenario: Full catalog snapshot used locally

- GIVEN a fresh-enough local catalog snapshot exists
- WHEN a specialist lane analyzes stock, rotation, claims, or reputation
- THEN it MUST use the local read model before remote reads
- AND it MUST cite stable evidence IDs

#### Scenario: Snapshot missing or stale

- GIVEN required evidence is missing, stale, or partial
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
