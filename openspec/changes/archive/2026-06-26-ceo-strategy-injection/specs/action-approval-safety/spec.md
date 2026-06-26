# Delta for Action Approval Safety

## ADDED Requirements

### Requirement: Strategy-Based Action Validation

The system MUST validate every `AgentProposal` against active strategies via `strategyValidator(proposal, strategies): GuardResult` before presenting it to the seller. Proposals violating an active strategy constraint MUST be blocked with a Spanish explanation referencing the specific violated rule.

#### Scenario: Proposal violates margin strategy

- GIVEN an active strategy requires "margen ≥ 50% en electrónica"
- WHEN the agent proposes a price with margin 35% on an electrónica listing
- THEN `strategyValidator` MUST return `passed: false` with reason citing the margin strategy

#### Scenario: Proposal violates category exclusion

- GIVEN an active strategy excludes the "juguetes" category
- WHEN the agent proposes any action targeting a "juguetes" listing
- THEN `strategyValidator` MUST block the proposal regardless of action type

#### Scenario: Proposal complies with all strategies

- GIVEN active strategies cover margin and category focus
- WHEN the agent proposes an action that satisfies all constraints
- THEN `strategyValidator` MUST return `passed: true`

#### Scenario: No active strategies

- GIVEN no active strategies exist in the database
- WHEN a proposal is validated
- THEN `strategyValidator` MUST return `passed: true` without delay or overhead

#### Scenario: Blocked proposal explained in Spanish

- GIVEN a proposal is blocked by strategy validation
- WHEN the rejection is returned to the seller
- THEN it MUST include a natural Spanish explanation identifying which strategy rule was violated
