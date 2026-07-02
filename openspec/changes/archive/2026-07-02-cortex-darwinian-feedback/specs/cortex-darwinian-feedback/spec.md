# cortex-darwinian-feedback Specification

Spreading-activation outcome propagation through activated Cortex constellations. After each approved or rejected turn, Escribano traverses the constellation and adjusts all participating edges together using existing Hebbian primitives. Includes rejection-signal detection and persistent outcome-node recording.

## Requirements

### Requirement: Rejection Turn Outcome

The system MUST detect seller rejection in Spanish and return `"rejected"` as a TurnOutcome. Detection SHALL use word-boundary-anchored Spanish negation patterns (`no`, `cancelá`, `rechazo`, `no quiero`) following a pending proposal. Detection MUST NOT trigger on partial matches or unrelated negation.

#### Scenario: Seller rejects pending proposal

- GIVEN a pending proposal was presented and seller replies "no"
- WHEN `resolveTurnOutcome` evaluates the message
- THEN result MUST be `"rejected"`

#### Scenario: False positive avoided

- GIVEN no pending proposal
- WHEN user message contains "no" in unrelated context
- THEN outcome MUST NOT be `"rejected"`

#### Scenario: Neutral and blocked outcomes unchanged

- GIVEN turn has no proposal outcome or is blocked by guardrail
- WHEN outcome resolves
- THEN result MUST remain `"none"` or `"blocked"` respectively

### Requirement: Constellation-Wide Outcome Propagation

The system MUST traverse the activated Cortex constellation via `GraphEngine.traverse()` after outcome resolution and propagate the outcome to ALL edges in the activated set. `"approved"` SHALL call `reinforceEdge` on every edge. `"rejected"` SHALL call `penalizeEdge` on every edge. Propagation MUST use existing primitives at their current deltas.

#### Scenario: Approval reinforces all constellation edges

- GIVEN activated constellation contains edges A→B (0.5), B→C (0.6)
- WHEN outcome is `"approved"`
- THEN both edges MUST be reinforced (+0.10 to 0.6, 0.7)

#### Scenario: Rejection penalizes all constellation edges

- GIVEN activated constellation contains edges X→Y (0.7), Y→Z (0.5)
- WHEN outcome is `"rejected"`
- THEN both edges MUST be penalized (−0.15 to 0.55, 0.35)

#### Scenario: Empty constellation

- GIVEN activated constellation has zero edges
- WHEN outcome propagation runs
- THEN no `reinforceEdge` or `penalizeEdge` calls SHALL occur

### Requirement: Persistent Outcome-Node Recording

The system MUST persist a `proposal_outcome` concept node for every turn with `"approved"` or `"rejected"` outcome. Recording SHALL occur even when the activated constellation is empty. Metadata SHALL include `outcome`, `sellerId`, and `timestamp`.

#### Scenario: Outcome recorded with empty constellation

- GIVEN outcome is `"rejected"` and constellation is empty
- WHEN Escribano records the turn
- THEN a `proposal_outcome` node MUST be written with `{outcome: "rejected", sellerId, timestamp}`

#### Scenario: Outcome recorded alongside edge propagation

- GIVEN outcome is `"approved"` and constellation has edges
- WHEN Escribano records the turn
- THEN a `proposal_outcome` node MUST be written
- AND edge propagation MUST also execute

#### Scenario: Non-outcome turns skipped

- GIVEN outcome is `"none"`
- WHEN Escribano records the turn
- THEN no `proposal_outcome` node SHALL be created
