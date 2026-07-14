# Idempotent Entity Identities

Technical primary keys are UUIDs, not module counters. Database uniqueness defines the canonical business entity under concurrent writes.

| Entity | Unique business key | Version behavior |
|---|---|---|
| Evidence | `(seller, system, entityType, recordId, sourceVersion, checksum)` | Exact repeat ignored; changed refund/version retained with an auditable predecessor/successor relationship. |
| Component | `(seller, source, sourceRecordId, economicMeaning, sourceVersion, currency, amountMinor)` | Exact repeat returns canonical row; changed version supersedes active predecessor without deletion. |
| Snapshot | `(seller, orderId, itemId, currency, sourceVersion, economicAlgorithmVersion, economicChecksum)` | Deterministic ID/checksum from canonical non-PII economic fields only; exact repeat returns canonical row. |

Checksums exclude buyer names, addresses, emails, documents, tokens, and raw payloads. A database uniqueness conflict is handled by reading the canonical row, incrementing ignored counts, and retaining the new invocation's distinct run ID.
