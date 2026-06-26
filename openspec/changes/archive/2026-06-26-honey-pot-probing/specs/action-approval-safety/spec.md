# Delta for action-approval-safety

## ADDED Requirements

### Requirement: Honey-Pot Operation Guardrail

The system MUST apply a `honeyPotGuardrail` with default-deny posture to all `WriteActionKind` entries `honey-pot-deploy` and `probe-analysis`. The guardrail SHALL block execution unless: (a) an active CEO strategy of type `probe` authorizes the target category, AND (b) the seller explicitly confirms with "dale". Blocked operations MUST return a Spanish explanation with TOS warning.

#### Scenario: Blocked without authorizing strategy

- GIVEN a `honey-pot-deploy` action targets "electrónica"
- WHEN `honeyPotGuardrail` evaluates
- THEN it MUST block with Spanish explanation citing missing CEO authorization
- AND MUST include TOS warning about fake listing risks

#### Scenario: Blocked without seller dale

- GIVEN active probe strategy authorizes "electrónica"
- WHEN seller has not confirmed "dale" for the specific operation
- THEN `honeyPotGuardrail` MUST block and prompt for explicit confirmation

#### Scenario: Approved with strategy and dale

- GIVEN active probe strategy authorizes "electrónica"
- WHEN seller confirms "dale" on the honey-pot proposal
- THEN `honeyPotGuardrail` MUST pass and allow execution

#### Scenario: probe-analysis requires same gate

- GIVEN a `probe-analysis` action is proposed
- WHEN `honeyPotGuardrail` evaluates
- THEN it MUST apply the same strategy + dale requirement as honey-pot-deploy

#### Scenario: Non-honey-pot actions unaffected

- GIVEN a regular `price-change` or `stock-update` action
- WHEN `honeyPotGuardrail` evaluates
- THEN it MUST pass through without blocking
