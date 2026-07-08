# Delta for action-approval-safety

## ADDED Requirements

### Requirement: Product Ads Mutations Require Seller Approval

The system MUST require explicit seller approval before any MercadoLibre Product Ads mutation: campaign budget adjustments, campaign pause/resume, ad pause/resume. The `msl_prepare_product_ads_action` tool SHALL produce `PreparedAction` records with `requiresApproval: true`. Proposals lacking seller confirmation MUST be blocked before execution regardless of autonomy level. Seller-impacting Product Ads recommendations SHALL be emitted only when the same seller/campaign/item/signal identity has no seller-impacting recommendation in the previous rolling 7 days; data-quality notices MAY surface daily and SHALL NOT carry seller-impacting action proposals.

#### Scenario: Ad pause proposal requires dale

- GIVEN the profitability daemon identifies a margin-consuming ad and CEO prepares a pause-campaign proposal
- WHEN the proposal is formatted
- THEN it MUST have pending status and `requiresApproval: true`

#### Scenario: Execution blocked without approval

- GIVEN a pending Product Ads proposal exists without recorded seller approval
- WHEN execution is attempted
- THEN the system MUST block and prompt for "dale" confirmation

#### Scenario: Budget adjustment follows same approval gate

- GIVEN a `adjust-campaign-budget` proposal targets an active campaign
- WHEN the proposal is prepared
- THEN it MUST require explicit seller approval with exact change details before execution

#### Scenario: Seller-impacting recs follow rolling 7-day cadence

- GIVEN the profitability daemon runs daily and the last seller-impacting recommendation for seller S, campaign C, product X, and tier T was 3 days ago
- WHEN the daemon investigates product X and thresholds are still breached
- THEN no new seller-impacting proposal SHALL be emitted for that same seller/campaign/item/tier identity until the rolling 7-day window expires
- AND data-quality notices (insufficient data) for product X MAY still emit daily without action proposals
