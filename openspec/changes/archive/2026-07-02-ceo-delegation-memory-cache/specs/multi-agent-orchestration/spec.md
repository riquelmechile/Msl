# Delta for multi-agent-orchestration

## ADDED Requirements

### Requirement: Cache-Resident Specialist Lanes

The system MUST define CEO, Cost/Supplier, Market/Catalog, and Creative/Commercial lanes with stable lane prefixes, bounded responsibilities, and proposal-only outputs.

#### Scenario: CEO coordinates lanes

- GIVEN the seller approves bounded investigation
- WHEN specialist lanes complete their analysis
- THEN the CEO lane MUST synthesize one recommendation with risks, missing inputs, and evidence IDs

#### Scenario: Lane boundary exceeded

- GIVEN a lane needs an action outside its responsibility
- WHEN it prepares output
- THEN it MUST return a boundary warning instead of executing or expanding scope

### Requirement: DeepSeek Lane Cache Measurement

The system MUST measure `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` per lane and MUST NOT hardcode whether provider cache isolation is API-key, account, or user scoped.

#### Scenario: Isolation strategy benchmarked

- GIVEN lane cache measurements are collected
- WHEN cache isolation differs by provider account, user, or API key
- THEN the system MUST compare lane hit rates without assuming the isolation mechanism

#### Scenario: Prefix proves unstable

- GIVEN a lane prefix causes repeated cache misses
- WHEN telemetry is evaluated
- THEN the system SHOULD revise prefix composition without changing durable memory semantics

### Requirement: Immutable Prefix Hygiene

Stable lane prefixes MUST contain durable role policy and boundaries only; volatile evidence, catalog snapshots, costs, and outcomes MUST remain outside immutable prefixes.

#### Scenario: Evidence is volatile

- GIVEN stock, cost, or market evidence changes frequently
- WHEN lane prompts are assembled
- THEN that evidence MUST be placed in refreshable context, not immutable prefix text

#### Scenario: Policy changes

- GIVEN safety policy or lane responsibility changes
- WHEN stable prefixes are regenerated
- THEN the system MUST accept the cache miss and preserve correctness
