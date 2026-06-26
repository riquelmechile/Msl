# honey-pot-operations Specification

## Purpose

Generate decoy listing proposals, enforce CEO authorization gate, track probe results, and apply Hebbian learning from confirmed competitor interactions.

## Requirements

### Requirement: Decoy Listing Proposal

The system SHALL generate honey-pot decoy proposals when a ProbeAlert exists AND active CEO strategy authorizes probing. `HoneyPotProposer.suggest()` MUST produce a `PreparedAction` of kind `honey-pot-deploy` with: target category, bait listing description, expected competitor behavior, risk assessment.

#### Scenario: Decoy proposed after alert

- GIVEN ProbeAlert for "electrónica" category exists
- WHEN CEO strategy authorizes probing in "electrónica"
- THEN `HoneyPotProposer.suggest()` MUST return a `PreparedAction` with kind `honey-pot-deploy`

#### Scenario: No proposal without alert

- GIVEN no ProbeAlert exists
- WHEN `HoneyPotProposer.suggest()` is called
- THEN it MUST NOT generate a proposal

### Requirement: CEO Approval Gate

The system MUST NOT execute any honey-pot operation unless `honeyPotGuardrail` confirms: (a) active CEO strategy authorizes probing, (b) seller explicitly confirms with "dale". Denied operations MUST return a Spanish TOS warning.

#### Scenario: Operation blocked without strategy

- GIVEN no active CEO strategy authorizes honey-pot operations
- WHEN a `honey-pot-deploy` action is attempted
- THEN `honeyPotGuardrail` MUST block with Spanish TOS warning

#### Scenario: Operation approved with strategy and dale

- GIVEN active CEO strategy authorizes probing in the target category
- WHEN seller confirms "dale" on the decoy proposal
- THEN `honeyPotGuardrail` MUST pass and operation MUST execute

### Requirement: Probe Result Tracking

The system MUST persist `probe_operations` table rows with: `id`, `action_id`, `target_category`, `bait_description`, `competitor_reaction` (string | null), `learning_outcome`, `created_at`, `resolved_at`. `trackProbeResult(actionId)` MUST update after competitor interaction.

#### Scenario: Probe operation recorded on execution

- GIVEN a `honey-pot-deploy` action is approved and executed
- WHEN the action completes
- THEN a `probe_operations` row MUST be inserted with `competitor_reaction = null`

#### Scenario: Competitor interaction recorded

- GIVEN an active probe operation with null reaction
- WHEN competitor interacts with the decoy listing
- THEN `trackProbeResult()` MUST update `competitor_reaction` and set `resolved_at`

### Requirement: Hebbian Probe Learning

The system MUST apply Hebbian learning from confirmed probe outcomes: reinforce (+0.1) when competitor behavior confirms patterns, penalize (-0.1) when decoy produces no reaction within 7 days. Learning MUST be scoped to `probe: true` tagged nodes.

#### Scenario: Confirmed competitor pattern reinforced

- GIVEN decoy listing triggers expected competitor pricing query
- WHEN outcome is confirmed
- THEN probe-pattern edge weights MUST increase by +0.1

#### Scenario: No reaction penalized

- GIVEN decoy listing generates zero competitor activity for 7 days
- WHEN learning is applied
- THEN probe-pattern edge weights MUST decrease by -0.1
