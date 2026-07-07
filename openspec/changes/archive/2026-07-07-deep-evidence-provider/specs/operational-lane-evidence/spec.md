# Delta for operational-lane-evidence

## ADDED Requirements

### Requirement: Structured Evidence Retrieval

`OperationalEvidenceProvider` MUST provide `getStructuredEvidenceForLane(laneId, sellerId)` returning typed data arrays instead of compact ID-only strings. Each result entry SHALL include the full snapshot data payload from `readSnapshot<TData>()`, evidence metadata, and parsed business fields.

The existing `getEvidenceForLane()` method MUST remain unchanged: same signature, same compact string output, same lane-to-signal mapping. No existing call site requires modification.

#### Scenario: Structured evidence includes full data

- GIVEN listing evidence exists for lane "cost"
- WHEN `getStructuredEvidenceForLane("cost", sellerId)` is called
- THEN results MUST be an array of structured objects containing the parsed `data` field from each snapshot
- AND each entry MUST include the evidence timestamp and signal kind

#### Scenario: Backward compatible string evidence

- GIVEN existing call sites invoke `getEvidenceForLane("market", sellerId)`
- WHEN the provider is updated
- THEN `getEvidenceForLane` MUST return the same compact string format as before
- AND no existing tests or agent prompts require changes

#### Scenario: Unknown lane returns empty result

- GIVEN a lane ID with no mapping entry
- WHEN `getStructuredEvidenceForLane(unknownLane, sellerId)` is called
- THEN it MUST return an empty array without error

#### Scenario: Structured evidence preserves completeness metadata

- GIVEN a snapshot with completeness "complete" and confidence "high"
- WHEN returned via `getStructuredEvidenceForLane`
- THEN the structured entry MUST carry completeness, confidence, and freshness metadata alongside the data payload
