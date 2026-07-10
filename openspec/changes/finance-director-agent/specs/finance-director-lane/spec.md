# Finance Director Lane Specification

## Purpose

Lane contract for the Finance Director agent. Defines identity, credential scope, input evidence, output assessments, and immutability boundaries.

## Requirements

### Requirement: Lane Registration

The lane MUST be registered with `LaneId = "finance-director"`, department `"finance"`, and `credentialScope: "provider-default"`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Lane listed | LANE_CONTRACTS includes finance-director | `listCompanyAgents()` | Agent exists with source `lane-contract` |
| Department assigned | finance-director lane registered | `getCompanyAgent("finance-director")` | `departmentId` is `"finance"` |
| Credential scope | finance-director lane contract defined | inspected | `credentialScope` is `"provider-default"` |

### Requirement: Stable Prefix Identity

The lane's `stablePrefix` MUST declare: identity as Finance Director, read-only financial reasoning over economic evidence, prohibition against fabricating numbers, and Phase-1 proposal-only boundary. The prefix MUST be immutable after deployment to preserve prompt cache hits.

#### Scenario: Stable prefix enables cache reuse

- GIVEN the finance-director stable prefix is deployed
- WHEN consecutive reasoning calls use the same `cacheBlocks` configuration
- THEN the prompt cache SHALL hit on the stable prefix blocks without cache-busting changes

### Requirement: Evidence Kind Declaration

The lane SHALL declare 15 required evidence kinds: `unit-economics`, `economic-outcome`, `profit-summary`, `cost-evidence`, `product-ads-profitability`, `account-brain`, `listing-snapshot`, `order-snapshot`, `claim-snapshot`, `reputation-snapshot`, `stock-evidence`, `supplier-evidence`, `advertising-cost`, `refund-return-cost`, `financing-cost`.

#### Scenario: Evidence kind completeness

- GIVEN the finance-director lane contract is registered
- WHEN `requiredEvidenceKinds` is inspected
- THEN all 15 kinds SHALL be present with no duplicates

### Requirement: Boundaries

The lane SHALL enforce: read-only analysis only — never execute mutations, never fabricate numbers, reject currency mixing, and enforce seller isolation.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Mutation boundary | Finance Director processes a request | Any tool call made | `noExternalMutationExecuted` SHALL be `true` |
| No fabrication | Evidence is partial or absent | Assessment produced | Missing fields SHALL report `null`/gaps, not invented values |
