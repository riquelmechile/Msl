# Economic Evidence Reference Specification

## Purpose

A bounded, safe reference linking each `EconomicCostComponent` back to its MercadoLibre source without storing raw ML payloads.

## Requirements

### Requirement: EconomicEvidenceReference Type

The system MUST define `EconomicEvidenceReference` with: `evidenceId`, `sellerId`, `sourceSystem`, `sourceEntityType`, `sourceRecordId`, `sourceField`, `observedAt`, `occurredAt`, `sourceVersion`, `checksum` (safe hash), `verification`, `confidence`, `ingestionRunId`, and safe `metadata`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Order revenue evidence | ML order #999, total 50000 CLP | Create evidence reference | `sourceSystem: "mercadolibre"`, `sourceEntityType: "order"`, `sourceRecordId: "999"`, `sourceField: "total_amount"` |
| Fee evidence from payment | Payment #777, fee 5500 CLP | Create evidence reference | `sourceEntityType: "payment"`, `sourceRecordId: "777"`, `sourceField: "sale_fee"` |

### Requirement: No Raw ML Payload Storage

The system MUST NEVER store raw ML API responses. Only safe fields SHALL be stored: hashes, selected economic fields, technical IDs, timestamps, and mapping reasons.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| ML order with full payload | Raw order JSON 15KB | Extract evidence | Stored: hash, economic amounts, order ID, timestamp. NOT stored: buyer info, shipping address, full JSON |
| Checksum verification | Evidence stored with hash v1 | Verify later | `checksum` matches re-computed hash of source fields |

### Requirement: Component-to-Evidence Traceability

Every `EconomicCostComponent` MUST reference evidence via `source` (evidenceId), `sourceRecordId`, `verification`, `confidence`, and bounded `metadata`. Every figure MUST be traceable back to its source.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Trace marketplace fee | Fee component amount 5500 | Inspect evidence chain | Evidence ref links to payment #777, field `sale_fee`, checksum verified |
| Missing evidence | Component created without evidence ref | Validation | Component rejected — evidence ref required |
