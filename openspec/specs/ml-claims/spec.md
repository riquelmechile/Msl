# ml-claims Specification

## Purpose

Safe-read claims/mediations search and detail via the MercadoLibre post-purchase API. Exposes typed snapshots for claim search, detail, messages, expected resolutions, reputation impact, and status history. No mutations — claims POST/PUT endpoints are deferred to a future execution slice.

## Requirements

### Requirement: Claims Search

The system MUST return typed claim summaries via `GET /post-purchase/v1/claims/search`. The snapshot SHALL include `source: "mercadolibre-api"`, `noMutationExecuted: true`, freshness, confidence, and seller scope metadata.

#### Scenario: Search with stage filter

- GIVEN valid OAuth for a connected MLC seller
- WHEN `getClaims(sellerId, { stage: "dispute" })` is called
- THEN the snapshot MUST return paged claim summaries with id, type, stage, status, resource, players
- AND `noMutationExecuted` MUST be `true`

#### Scenario: Search returns empty results

- GIVEN valid OAuth and no claims match the filter
- WHEN claims search is called
- THEN the snapshot MUST return an empty data array with `completeness: "complete"` and confidence metadata

#### Scenario: OAuth token missing or expired

- GIVEN seller OAuth is missing or expired
- WHEN claims search is called
- THEN the system MUST return `ReconnectRequired` and SHALL NOT attempt the API call

#### Scenario: Upstream rate limited

- GIVEN the ML API returns HTTP 429
- WHEN claims search is called
- THEN the snapshot MUST surface `rate-limited` in blocked metadata and SHALL NOT retry

### Requirement: Claims Sub-Resources

The system MUST expose typed reads for claim messages, expected resolutions, reputation impact check, and status history. Each sub-resource SHALL preserve seller scope, freshness, confidence, and `noMutationExecuted: true`.

#### Scenario: Claim detail with messages

- GIVEN a valid claim ID with message history
- WHEN detail and messages are read
- THEN each sub-resource MUST return typed snapshots with attached metadata

#### Scenario: Claim has no expected resolutions

- GIVEN a claim without resolution proposals
- WHEN expected resolutions is read
- THEN it MUST return an empty result with appropriate completeness metadata

### Requirement: Runtime Surface Classification

The capability MUST be classified as `safe-read` with runtime surface `read-tool`. The MCP tool SHALL NOT create approval requests and SHALL NOT execute mutations.

| Field | Value |
|-------|-------|
| Classification | `safe-read` |
| Endpoints | `GET /post-purchase/v1/claims/search`, `GET /post-purchase/v1/claims/{id}`, 4 sub-resources |
| Site support | MLC-to-confirm |
| Runtime surface | `read-tool` |
| Confidence | Medium |

---

## ADDED: Claim Sub-Resources (Slice 3)

### Requirement: Claim Messages Read

The client MUST expose `getClaimMessages(sellerId, claimId)` returning `MlcClaimMessagesSnapshot` with message history.

### Requirement: Expected Resolutions Read

The client MUST expose `getClaimExpectedResolutions(sellerId, claimId)` returning available resolution options.

### Requirement: Reputation Impact Read

The client MUST expose `getClaimAffectsReputation(sellerId, claimId)` returning whether the claim affects seller reputation.

### Requirement: Status History Read

The client MUST expose `getClaimStatusHistory(sellerId, claimId)` returning chronological status transitions.
