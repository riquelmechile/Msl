# Data Quality and Coverage Specification

## Purpose

Per-snapshot economic data coverage evaluation. Determines whether a snapshot is complete, partial, unverifiable, or disputed. Never artificially inflates confidence.

## Requirements

### Requirement: EconomicDataCoverage Evaluator

The system MUST evaluate each `UnitEconomicsSnapshot` across 11 coverage dimensions: revenue present, marketplace fee present, shipping present, seller discount present, refunds/returns evaluated, advertising evaluated, product cost present, landed cost evaluated, currency consistent, evidence current, evidence disputed, reconciliation status.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| All mandatory present | Revenue, fees, shipping, discounts, refunds, ads, product cost all verified from source | Evaluate | Status: `complete` |
| Missing product cost | Revenue + all direct costs present, product cost absent | Evaluate | Status: `partial`, missing: `product_cost` |

### Requirement: Coverage Statuses

| Status | Criteria |
|--------|----------|
| `complete` | All mandatory inputs present OR explicitly confirmed zero by source |
| `partial` | Valid revenue exists, one or more relevant costs missing |
| `unverifiable` | Cannot verify revenue or currency, evidence corrupt/insufficient |
| `disputed` | Sources contradict, corrected/claimed amount mismatch, seller mismatch, reconciliation materially fails |

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Complete with zero | Source explicitly confirms no advertising cost for order | Evaluate | Status `complete`, advertising noted as zero-by-source |
| Unverifiable revenue | Order data corrupt, total_amount field null | Evaluate | Status `unverifiable` |
| Disputed amounts | ML reports revenue 50000, payment shows 48000 | Evaluate | Status `disputed`, discrepancy documented |

### Requirement: Confidence Integrity

The system MUST NEVER artificially raise confidence. Confidence SHALL reflect evidence completeness and verification status. No heuristic SHALL convert `partial` to `complete`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Partial snapshot | 8 of 12 inputs known | Confidence evaluated | `confidence < 0.7` |
| Complete snapshot | All 12 verified from source | Confidence evaluated | `confidence >= 0.9` |
| Unverifiable | Evidence corrupt | Confidence evaluated | `confidence < 0.3` |
| Forced completion attempt | Code tries to mark partial as complete | Validation | Rejected |
