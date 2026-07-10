# Delta for Lane Contracts

## ADDED Requirements

### Requirement: Finance Director LaneId

The `LaneId` union type MUST include `"finance-director"`.

(Previously: LaneId had 15 members; `"finance-director"` did not exist.)

#### Scenario: Lane addition

- GIVEN the codebase defines `LaneId` as a union type
- WHEN `"finance-director"` is referenced as a `LaneId`
- THEN TypeScript compilation SHALL accept it

### Requirement: Finance Director Lane Contract Registration

`LANE_CONTRACTS` array MUST include `FINANCE_DIRECTOR_LANE: LaneContract` with `laneId: "finance-director"`, `label`, `stablePrefix`, `inputs`, `outputs`, `boundaries`, 15 `requiredEvidenceKinds`, and `credentialScope: "provider-default"`.

#### Scenario: Lane contract completeness

- GIVEN `LANE_CONTRACTS` is the source-of-truth for lane registration
- WHEN `getLaneContract("finance-director")` is called
- THEN a valid `LaneContract` SHALL be returned
- AND `requiredEvidenceKinds` SHALL contain exactly 15 entries
