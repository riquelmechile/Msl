# Seller Isolation and Security Specification

## Purpose

Enforces complete isolation between sellers at every layer: storage, pipeline, adapters, tools, checkpoints, and summaries. Zero secrets, zero PII, zero raw ML payloads, zero ML mutations.

## Requirements

### Requirement: Complete Seller Isolation

Plasticov and Maustian MUST remain completely isolated at: cost components, snapshots, checkpoints, summaries, tool queries, adapter scopes, run records, and reconciliation.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Cross-cost query blocked | Query for Plasticov costs tries to join Maustian data | Store query | Returns 0 or throws seller-scope error |
| Cross-checkpoint isolation | Plasticov checkpoint at page 10 | Maustian pipeline runs | Maustian uses its own checkpoint, never reads Plasticov's |
| Cross-summary blocked | Summary aggregation includes both sellers | Assembler | Rejected — seller scope enforced |

### Requirement: Zero Secrets in Persistence

The system MUST NOT persist: API keys, OAuth tokens, credentials, or secrets of any kind in cost components, snapshots, evidence references, or run records.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Accidental token leak | Code stores `access_token` in metadata field | Validation | Field rejected or stripped before persistence |

### Requirement: Zero PII in Persistence

The system MUST NOT store: buyer names, addresses, phones, emails, documents, or any personally identifiable information in any persisted record.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| ML response with buyer data | Raw order includes `buyer.name`, `buyer.email` | Normalize and persist | Only commercial identifiers stored, PII stripped at stage 7 |

### Requirement: Zero Raw ML Payloads

The system MUST NOT store raw ML API responses. Only economic fields, hashes, and technical IDs SHALL be persisted.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Full ML order JSON | 15KB raw response | Evidence reference creation | Only hash + economic fields extracted |

### Requirement: Zero ML Mutations

The pipeline MUST be strictly read-only. `noExternalMutationExecuted: true` on all operations.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Any operation | Pipeline, adapter, store query | Inspect operation | `noExternalMutationExecuted: true`, no ML API call with side effects |

### Requirement: Feature Flag

`MSL_ECONOMIC_INGESTION_ENABLED` MUST default to `false`. Pipeline SHALL NOT execute unless flag is explicitly `true`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Flag false | `MSL_ECONOMIC_INGESTION_ENABLED: false` | Pipeline triggered | Pipeline exits immediately, no data processed |
| Flag true | `MSL_ECONOMIC_INGESTION_ENABLED: true` | Pipeline triggered | Normal execution |
