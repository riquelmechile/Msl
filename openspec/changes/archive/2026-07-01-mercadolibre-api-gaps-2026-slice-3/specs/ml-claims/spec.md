# ml-claims Specification — Delta (Slice 3)

## ADDED Requirements

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

The system MUST expose a typed read for reputation impact via `GET /post-purchase/v1/claims/{id}/affects_reputation`. The snapshot SHALL return a boolean flag and optional reason string.

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
