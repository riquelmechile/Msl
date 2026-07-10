# account-asset-comparison Specification

## Purpose

Side-by-side comparison of Plasticov vs Maustian accounts with recommendation (not execution) based on capability match, health, risk level, profit goal alignment, and operational costs. Read-only; outputs always include `requiresApproval: true`.

## Requirements

### Requirement: Account Asset Comparison

The system SHALL accept `CompareAccountAssetsInput` and return `AccountAssetComparison` with `recommendedSellerId`, confidence, ranking, decisionLogic, evidence, and `suggestedNextAction`. All outputs SHALL include `noMutationExecuted: true` and `requiresApproval: true`.

#### Scenario: Clear winner identified

- GIVEN Plasticov matches capabilities and has higher margin, Maustian has higher risk
- WHEN `compare_account_assets` is called with product specs
- THEN recommendedSellerId is "plasticov" with high confidence
- AND ranking lists Plasticov first with higher score
- AND suggestedNextAction has requiresApproval: true

#### Scenario: Missing capabilities penalize

- GIVEN product requires "Fulfillment" capability, Maustian lacks it
- WHEN `compare_account_assets` is called
- THEN Maustian ranking includes missingCapabilities: ["Fulfillment"] and lower score

#### Scenario: Critical risk penalizes

- GIVEN Plasticov has critical reputation risk
- WHEN `compare_account_assets` is called
- THEN Plasticov score is reduced with risk noted in ranking risks[]

### Requirement: Goal-Driven Weighting

The system SHALL adjust ranking weights per the `goal` input. `maximize_profit` SHALL weight margin and opportunity; `reduce_risk` SHALL weight risk level; `grow_reputation` SHALL weight reputation and capability health; `clear_stock` SHALL weight sales velocity; `test_market` SHALL weight available capabilities.

#### Scenario: maximize_profit goal

- GIVEN goal is maximize_profit
- WHEN comparison runs
- THEN margin and opportunity factors carry highest weight in decisionLogic

#### Scenario: reduce_risk goal

- GIVEN goal is reduce_risk
- WHEN comparison runs
- THEN risk level and pending approvals factors carry highest weight

### Requirement: Seller Isolation

The system SHALL query each candidate seller independently. Ranking rows SHALL include per-seller data. Evidence rows SHALL include `sellerId` when data is account-specific.

#### Scenario: Both accounts compared without mixing

- GIVEN candidateSellerIds: ["plasticov", "maustian"]
- WHEN comparison runs
- THEN ranking[0].sellerId is plasticov, ranking[1].sellerId is maustian
- AND no Maustian data appears in Plasticov ranking row

### Requirement: Insufficient Data Handling

The system SHALL return low confidence and `collect_more_evidence` suggestion when ranking scores are too close or data is insufficient to recommend.

#### Scenario: Scores too close

- GIVEN Plasticov score 75, Maustian score 73
- WHEN comparison runs
- THEN confidence is "low"
- AND suggestedNextAction.kind is "collect_more_evidence"

### Requirement: Read-Only Guarantee

The system SHALL NOT execute any ML mutations. No HTTP, no DeepSeek, no MercadoLibre writes. Output MUST include `noMutationExecuted: true`.

#### Scenario: No side effects

- GIVEN tool invoked for any seller combination
- WHEN response inspected
- THEN `noMutationExecuted: true`, `requiresApproval: true`, zero ML API calls
