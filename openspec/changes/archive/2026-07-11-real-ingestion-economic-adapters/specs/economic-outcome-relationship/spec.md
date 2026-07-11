# Economic Outcome Relationship Specification

## Purpose

Governs when ingestion creates `EconomicOutcome` records versus `UnitEconomicsSnapshot` records. Sale ≠ causation.

## Requirements

### Requirement: Snapshot vs Outcome Distinction

A `UnitEconomicsSnapshot` SHALL be created for every order. An `EconomicOutcome` SHALL only be created when the order relates to a proposal, campaign, or agent execution. Organic sales without related proposal/action MUST NOT create `EconomicOutcome`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Organic sale | Order #500, no campaign, no proposal | Ingest | `UnitEconomicsSnapshot` created, NO `EconomicOutcome` |
| Campaign-driven sale | Order #501 linked to campaign C via correlationId | Ingest | Snapshot created, `EconomicOutcome` created in `observed` state |
| Proposal-linked | Order #502 from executed proposal P | Ingest | Snapshot created, outcome with `proposalId: "P"` |

### Requirement: Outcome Verification

`EconomicOutcome.verified` requires: complete economic evidence, verification process, seller match, consistent currency, observation window, recorded reason. MUST NOT auto-verify just because a sale exists.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Sale exists, evidence partial | Order with 6 of 12 costs known | Outcome created | Status stays `observed`, NOT `verified` |
| Complete evidence, seller match | All costs verified, same seller | Verification | Status transitions to `verified` with reason recorded |
| Cross-seller verification attempt | Plasticov outcome, Maustian evidence | Verification | Rejected — seller mismatch |

### Requirement: Cortex Independence

The ingestion pipeline MUST NOT directly reinforce Cortex. The Economic Learning Pipeline processes only verified outcomes.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Outcome just created | Outcome in `observed` state | Check learning eligibility | `evaluateEconomicLearningEligibility` blocks it — outcome not verified |
