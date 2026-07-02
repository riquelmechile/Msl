# Delta for ml-claims

## ADDED Requirements

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
