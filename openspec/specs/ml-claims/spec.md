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

### Requirement: Claim Messages Sub-Resource

The system MUST expose a typed read for claim messages via `GET /post-purchase/v1/claims/{id}/messages`. The snapshot SHALL return `ReadonlyArray<MlcClaimMessage>` with seller scope, freshness, confidence, and `noMutationExecuted: true`.

#### Scenario: Claim has messages

- GIVEN a valid claim ID with message history
- WHEN `getClaimMessages(sellerId, claimId)` is called
- THEN the snapshot MUST return typed messages with sender/receiver roles
- AND `noMutationExecuted` MUST be `true`

#### Scenario: Claim has no messages

- GIVEN a claim without messages
- WHEN messages sub-resource is read
- THEN it MUST return an empty array with `completeness: "complete"`

### Requirement: Claim Expected Resolutions

The system MUST expose a typed read for claim expected resolutions via `GET /post-purchase/v1/claims/{id}/expected_resolutions`. The snapshot SHALL return resolution proposals with id, status, reason.

#### Scenario: Claim has resolution proposals

- GIVEN a claim with expected resolution proposals
- WHEN `getClaimExpectedResolutions(sellerId, claimId)` is called
- THEN each proposal SHALL include id, status, reason, and dateCreated

### Requirement: Claim Affects Reputation

The system MUST expose a typed read for reputation impact via `GET /post-purchase/v1/claims/{id}/affects-reputation`. The snapshot SHALL return a boolean flag and optional reason string.

#### Scenario: Claim affects reputation

- GIVEN a claim that impacts seller reputation
- WHEN `getClaimAffectsReputation(sellerId, claimId)` is called
- THEN the snapshot MUST return `{ affects_reputation: true, reason?: string }`

### Requirement: Claim Status History

The system MUST expose a typed read for claim status history via `GET /post-purchase/v1/claims/{id}/status_history`. The snapshot SHALL return an array of status/date entries.

#### Scenario: Claim has status transitions

- GIVEN a claim that moved through multiple statuses
- WHEN `getClaimStatusHistory(sellerId, claimId)` is called
- THEN the snapshot MUST return chronological status/date entries

### Requirement: Claims Return Safe Reads

The system MUST expose typed safe reads for claim return detail, return reviews, and return-cost snapshots. Each snapshot SHALL preserve seller scope, source, freshness, confidence, site support, and `noMutationExecuted: true`. Return support for MLC SHALL be treated as `MLC-to-confirm`; unavailable, unauthorized, not-found, or unsupported upstream responses MUST degrade without fabricating return evidence or executing mutations.

#### Scenario: Return detail is read for a claim

- GIVEN valid OAuth for a connected MLC seller and a claim with return evidence
- WHEN return detail is requested for the claim
- THEN the snapshot MUST include typed return detail with seller scope and freshness
- AND `noMutationExecuted` MUST be `true`

#### Scenario: Return reviews are read for a return

- GIVEN valid OAuth and a known return ID
- WHEN return reviews are requested for the return
- THEN the snapshot MUST include typed review evidence or an empty complete result
- AND it MUST NOT create or update a return review

#### Scenario: Return cost is read for a claim

- GIVEN valid OAuth and a claim with return-cost charges
- WHEN return cost is requested for the claim
- THEN the snapshot MUST include typed charge/cost evidence with confidence metadata
- AND no refund, dispute, or cost action MUST execute

#### Scenario: MLC support is unavailable or unconfirmed

- GIVEN the upstream API returns unavailable, unauthorized, not-found, or unsupported for MLC
- WHEN any return read is requested
- THEN the system MUST return a controlled degraded snapshot with `siteSupport: "MLC-to-confirm"`
- AND it MUST NOT retry as a mutation or synthesize missing return data
