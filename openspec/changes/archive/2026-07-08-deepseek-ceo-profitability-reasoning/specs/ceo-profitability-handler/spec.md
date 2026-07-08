# Delta for ceo-profitability-handler

## MODIFIED Requirements

### Requirement: Signal-to-Action Mapping

The handler SHALL delegate profitability findings to `CeoDeepSeekClient` for LLM-reasoned recommendations enriched with Cortex context. The LLM SHALL return structured JSON with a valid `proposalType`. The handler SHALL forward valid recommendations to `msl_prepare_product_ads_action` with `requiresApproval: true`.

The existing static `SIGNAL_TO_ACTION` map SHALL be preserved as fallback:

| Signal | Action | Severity |
|--------|--------|----------|
| margin-consuming | pause-campaign | critical |
| scale-candidate | adjust-campaign-budget (increase) | opportunity |
| budget-waste | review-campaign-structure | warning |
| underinvested | adjust-campaign-budget (allocate) | info |
| unit-economics | review-campaign-structure (info-report) | info |

The handler SHALL fall back to the static map immediately when `CeoDeepSeekClient` returns an error, times out, or produces an invalid `proposalType`.

Info-only findings (unit-economics, underinvested) SHALL produce info-report actions without requiring seller approval prompts — LLM or fallback alike.

(Previously: handler used only the static SIGNAL_TO_ACTION map for all signal-to-action mapping.)

#### Scenario: LLM produces valid recommendation

- GIVEN a profitability proposal with findings for seller S
- AND `CeoDeepSeekClient.reason()` returns valid recommendations
- WHEN the handler processes findings
- THEN each `msl_prepare_product_ads_action` SHALL use the LLM-reasoned `proposalType`

#### Scenario: LLM unavailable triggers fallback

- GIVEN `CeoDeepSeekClient` fails, times out, or returns invalid `proposalType`
- WHEN the handler processes findings
- THEN the static `SIGNAL_TO_ACTION` map SHALL produce the recommendation immediately

#### Scenario: Margin-consuming ad triggers pause proposal (fallback)

- GIVEN a profitability proposal with a margin-consuming finding for campaign C, seller S
- WHEN the handler processes the finding via fallback
- THEN a `msl_prepare_product_ads_action` SHALL be created with `proposalType: pause-campaign` and `requiresApproval: true`

#### Scenario: Unit-economics finding produces info report (fallback)

- GIVEN a profitability proposal with a unit-economics finding
- WHEN the handler processes the finding via fallback
- THEN a `review-campaign-structure` info-report SHALL be created without requiring seller approval
