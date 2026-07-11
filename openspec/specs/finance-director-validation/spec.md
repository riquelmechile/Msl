# finance-director-validation Specification

## Purpose

Hardened `checkInventedFigures` rule within `FinanceDirectorValidator` that extracts
numeric claims from LLM-generated financial assessments and cross-references them
against available evidence, detecting fabricated metrics, unrealistic precision,
and undocumented monetary amounts.

## Requirements

### Requirement: Numeric Claim Extraction

`checkInventedFigures` MUST parse the assessment to extract every numeric claim
(monetary amounts, percentages, ratios, counts) along with its context (field,
sentence, associated evidence ID). The extraction SHALL cover `summary`,
`verifiedFacts`, `hypotheses.statement`, and `recommendations.action/rationale`.

#### Scenario: Extracts numeric claims from assessment

- GIVEN an assessment with `verifiedFacts: [{ statement: "Profit margin is 32%", evidenceId: "ev_001" }]`
- WHEN `checkInventedFigures` runs
- THEN the claim `32%` is extracted with context "Profit margin is 32%" and linked
  to evidence `ev_001`

#### Scenario: Handles assessment with no numeric claims

- GIVEN an assessment where all sections contain only qualitative statements
- WHEN `checkInventedFigures` runs
- THEN zero numeric claims are extracted
- AND no validation issues are raised

### Requirement: Evidence Cross-Referencing

Every extracted numeric claim MUST be cross-referenced against the provided
`evidence` parameter. A claim SHALL be flagged as "unsubstantiated" if no
evidence item supports the claimed value.

#### Scenario: Claim matches evidence

- GIVEN a claim "Ad spend = 50,000 CLP" with evidenceId "ev_002"
- AND evidence `ev_002` contains `adSpend: { amount: 50000, currency: "CLP" }`
- WHEN the cross-reference runs
- THEN the claim is marked as substantiated
- AND no issue is raised for this claim

#### Scenario: Claim has no supporting evidence

- GIVEN a claim "ROAS = 4.7" with no `evidenceId` field
- AND no evidence item contains a ROAS metric near 4.7
- WHEN the cross-reference runs
- THEN the claim is flagged as "unsubstantiated"
- AND a validation issue is added with the fabricated figure detail

### Requirement: Fabricated Metric Detection

`checkInventedFigures` MUST detect metrics (ROAS, CAC, profit margin percentages,
conversion rates) that are not computable from the available evidence. Claims about
metrics without corresponding raw data in evidence SHALL be flagged.

#### Scenario: Metric not derivable from evidence

- GIVEN an assessment claims "CAC = $2.47" but evidence contains only revenue data,
  no customer acquisition costs
- WHEN `checkInventedFigures` runs
- THEN the CAC claim is flagged as "fabricated metric"
- AND the issue message states which data is missing

#### Scenario: Metric is derivable from evidence

- GIVEN a claim "Profit = $100" and evidence contains `{ revenue: 500, costs: 400 }`
- WHEN `checkInventedFigures` runs
- THEN the claim is not flagged (derivable: 500 - 400 = 100)

### Requirement: Precision Fabrication Detection

Numeric claims with unrealistic precision (e.g., "47.831%" profit margin) that cannot
be derived from integer minor-unit Money types SHALL be flagged.

#### Scenario: Unrealistic precision detected

- GIVEN a claim "profit margin of 47.831%" and all evidence uses integer CLP amounts
- WHEN `checkInventedFigures` runs
- THEN the claim is flagged as "suspicious precision"
- AND the precision level and source are noted in the issue

#### Scenario: Reasonable precision passes

- GIVEN a claim "profit margin of 32%" derived from integer amounts
- WHEN `checkInventedFigures` runs
- THEN no precision issue is raised

### Requirement: Undocumented Money Amount Detection

Claims about CLP or USD amounts without corresponding evidence entries SHALL be
flagged. The check MUST verify that the claimed currency matches the evidence's
currency.

#### Scenario: Undocumented amount flagged

- GIVEN a claim "Shipping cost increased by 12,000 CLP" with no evidenceId
- AND no evidence item documents shipping costs near 12,000 CLP
- WHEN `checkInventedFigures` runs
- THEN the claim is flagged as "undocumented amount"

#### Scenario: Currency mismatch flagged

- GIVEN a claim "$50 USD" linked to evidence whose currency is "CLP"
- WHEN `checkInventedFigures` runs
- THEN the claim is flagged as "currency mismatch"
- AND the evidence currency and claimed currency are both noted in the issue

### Requirement: Confidence Validation Preservation

The existing confidence check (valid 0-1 number) MUST be preserved. The hardened
`checkInventedFigures` SHALL add numeric-claim verification without removing or
weakening the confidence validation.

#### Scenario: Invalid confidence still caught

- GIVEN an assessment with `confidence: 1.5`
- WHEN `checkInventedFigures` runs
- THEN a validation issue for "confidence out of range" is raised
- AND numeric-claim extraction also runs independently

### Requirement: Issue Aggregation

All validation issues from `checkInventedFigures` MUST be aggregated into the
caller's `issues` array. Each issue SHALL include `{ rule: "checkInventedFigures",
type: string, detail: string }`.

#### Scenario: Multiple issues returned

- GIVEN an assessment with one undocumented amount and one fabricated metric
- WHEN `checkInventedFigures` runs
- THEN two issues are appended to the `issues` array
- AND each issue has `rule: "checkInventedFigures"` with distinct `type` and `detail`
