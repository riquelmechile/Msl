# Delta for conversational-business-agent

## ADDED Requirements

### Requirement: CEO Specialist-Lane Conversation

The system MUST present the Telegram agent as a CEO/Socio lane that can coordinate bounded specialist investigations and return one combined, evidence-backed proposal.

#### Scenario: Combined specialist proposal

- GIVEN the seller approves investigation with "dale"
- WHEN the CEO lane gathers Cost/Supplier, Market/Catalog, and Creative/Commercial outputs
- THEN it MUST return one Spanish proposal with recommendation, rationale, risks, and evidence IDs
- AND it MUST state that no external mutation was executed

#### Scenario: Investigation remains bounded

- GIVEN a delegated investigation has a stated scope
- WHEN a lane needs work outside that scope
- THEN the CEO lane MUST ask the seller for a new approval before continuing

### Requirement: Missing Cost Clarification

The system MUST ask for missing product cost, supplier, or margin inputs before making profitability claims.

#### Scenario: Cost data missing

- GIVEN local evidence lacks reliable cost or supplier constraints
- WHEN the seller asks whether an opportunity is profitable
- THEN the CEO lane MUST ask for the missing inputs
- AND it MUST NOT present profit as confirmed

#### Scenario: Cost data available

- GIVEN fresh-enough cost and supplier evidence exists
- WHEN the CEO lane prepares the proposal
- THEN it MAY include margin viability with cited evidence IDs

### Requirement: DeepSeek Cache Telemetry in Conversation

The system MUST report per-lane DeepSeek cache telemetry as optimization evidence, using `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` when provider telemetry is available.

#### Scenario: Telemetry available

- GIVEN DeepSeek returns cache hit and miss token counts
- WHEN the CEO lane records a turn
- THEN telemetry MUST be associated with the lane that produced the output

#### Scenario: Telemetry unavailable

- GIVEN the provider omits cache counters
- WHEN the turn completes
- THEN the system MUST degrade without treating cache state as memory
