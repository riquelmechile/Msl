# Delta for Conversational Business Agent

## ADDED Requirements

### Requirement: get_account_brain_status Tool

The agent loop MUST register `get_account_brain_status` as an internal read-only workforce tool. It SHALL aggregate existing stores per seller and return `AccountBrainStatus` with health, risks, opportunities, agent activity, costs, pending approvals, and cortex presence.

#### Scenario: Tool registered and available

- GIVEN the agent loop initializes
- WHEN tools are registered
- THEN `get_account_brain_status` MUST appear in the LLM tool list alongside `get_agent_work_status`

#### Scenario: Tool query returns per-account status

- GIVEN CEO asks "cómo está Plasticov?"
- WHEN agent invokes `get_account_brain_status({ sellerId: "plasticov" })`
- THEN returns health, risks, agent activity, costs, pending approvals scoped to Plasticov
- AND `noMutationExecuted: true`

#### Scenario: Missing account handled gracefully

- GIVEN CEO asks about unknown account
- WHEN agent invokes tool
- THEN returns `missing_account_asset` status — conversation continues without error

#### Scenario: Store unavailability degrades gracefully

- GIVEN a dependent store is not configured
- WHEN agent invokes tool
- THEN affected fields report `"unavailable"` — agent SHALL NOT crash or throw

### Requirement: compare_account_assets Tool

The agent loop MUST register `compare_account_assets` as an internal read-only workforce tool. It SHALL compare candidate accounts side-by-side and return `AccountAssetComparison` with recommendation, ranking, and `requiresApproval: true`.

#### Scenario: Tool registered and available

- GIVEN the agent loop initializes
- WHEN tools are registered
- THEN `compare_account_assets` MUST appear in the LLM tool list

#### Scenario: Tool query returns comparison with recommendation

- GIVEN CEO asks "qué cuenta me conviene para este producto?"
- WHEN agent invokes `compare_account_assets` with product opportunity
- THEN returns ranking with `recommendedSellerId`, confidence, decisionLogic, and evidence
- AND `requiresApproval: true`, `noMutationExecuted: true`

#### Scenario: Goal-driven weighting applied

- GIVEN CEO asks "dónde maximizo ganancia?"
- WHEN agent invokes tool with `goal: "maximize_profit"`
- THEN ranking weights margin and opportunity factors highest

#### Scenario: Insufficient data does not break conversation

- GIVEN accounts have similar scores, no clear winner
- WHEN agent invokes tool
- THEN returns low confidence with `collect_more_evidence` suggestion — agent continues conversation
