# Delta for Company Agents

## ADDED Requirements

### Requirement: Finance Department in CompanyDepartmentId

The `CompanyDepartmentId` union type MUST be extended with `"finance"`.

(Previously: `CompanyDepartmentId = "executive" | "operations" | "commercial"`)

#### Scenario: Department extension

- GIVEN the codebase defines `CompanyDepartmentId`
- WHEN a new lane with `departmentId: "finance"` is registered
- THEN TypeScript compilation SHALL accept `departmentId: "finance"` without error

### Requirement: Finance Director Agent Registration

The `finance-director` agent MUST be registered via `toCompanyAgent()` from its `LaneContract`, with `source: "lane-contract"`, `departmentId: "finance"`, and `laneDepartments["finance-director"] = "finance"`.

#### Scenario: Finance director registration

- GIVEN `finance-director` lane is in `LANE_CONTRACTS`
- WHEN `listCompanyAgents()` is called
- THEN the `finance-director` agent SHALL appear with `source: "lane-contract"` and `departmentId: "finance"`
