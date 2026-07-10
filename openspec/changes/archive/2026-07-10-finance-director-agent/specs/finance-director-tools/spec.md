# Finance Director Tools Specification

## Purpose

CEO-facing read-only tools for financial reasoning. All tools enforce seller isolation, set `noExternalMutationExecuted: true`, and degrade gracefully when dependencies are unavailable.

## Requirements

### Requirement: ask_finance_director

The tool `ask_finance_director` MUST accept `sellerId` + `question` (string), delegate to the `FinanceDirectorAdvisor`, and return a `FinancialAssessment`.

#### Scenario: Asking a question

- GIVEN seller "plasticov" with economic evidence available
- WHEN `ask_finance_director({ sellerId: "plasticov", question: "Are we making money on product X?" })`
- THEN a `FinancialAssessment` SHALL be returned with `type: "question"`, evidence IDs populated

### Requirement: review_financial_health

The tool `review_financial_health` MUST accept `sellerId` + optional `timeWindow` and return a health assessment across all evidence domains.

#### Scenario: Health review

- GIVEN seller "maustian" with 30 days of economic data
- WHEN `review_financial_health({ sellerId: "maustian", timeWindow: "30d" })`
- THEN a `FinancialAssessment` SHALL be returned with `type: "health"` and completeness score

### Requirement: explain_economic_outcome

The tool `explain_economic_outcome` MUST accept `outcomeId` + `sellerId`, retrieve the outcome from `EconomicOutcomeStore`, and return an explanation assessment.

#### Scenario: Outcome explanation

- GIVEN economic outcome O exists for seller S
- WHEN `explain_economic_outcome({ outcomeId: "O", sellerId: "S" })`
- THEN a `FinancialAssessment` SHALL be returned with `type: "outcome"` referencing O's evidence

### Requirement: review_proposal_profitability

The tool `review_proposal_profitability` MUST accept `proposalId` + `sellerId`, evaluate profitability, and return a review assessment. MUST NOT approve or execute proposals.

#### Scenario: Proposal review without approval

- GIVEN proposal P exists for seller S
- WHEN `review_proposal_profitability({ proposalId: "P", sellerId: "S" })`
- THEN a `FinancialAssessment` SHALL be returned with `type: "proposal"`
- AND `noExternalMutationExecuted` SHALL be `true`
- AND no approval state SHALL be changed

### Requirement: Graceful Degradation

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Store missing | `AssessmentStore` is `undefined` | Any tool called | Error returned with `noExternalMutationExecuted: true` |
| DeepSeek missing | `FinanceDirectorAdvisor` factory returns `null` | `ask_finance_director` called | Error returned, no crash |

### Requirement: Seller Isolation

All tools MUST extract `sellerId` from arguments and scope all store/evidence queries to that seller. Cross-seller access SHALL be rejected.

### Requirement: No Mutation Executed

All tools MUST include `noExternalMutationExecuted: true` in every response payload. No tool SHALL publish, mutate MercadoLibre data, change prices, or execute external effects.
