# Fetch Remediation Design Gate Policy V3

## Target

- Operation: `review/start(target)`
- Lineage: `finalize-economic-run-consistency-fetch-remediation-design-v3`
- Target kind: `current-changes`
- Mode: `ordinary_4r`
- Generation: `1`
- Risk: `high`
- Purpose: corrected remediation design gate R1-R8 only; implementation review is out of scope

The target is the immutable native snapshot produced by `gentle-ai review-start`. It binds the complete current working-tree candidate, including the corrected OpenSpec design, specification, policy, migration, operations restoration, and task artifacts and the tracked `packages/agent/src/economics/dataFetcher.ts` marker.

## Authority

The authoritative review material is the OpenSpec change `finalize-economic-run-consistency`, with emphasis on its corrected remediation `design.md`, delta specifications, policy documents, `migration-plan.md`, operations restoration policy, and `tasks.md`. Existing implementation is snapshot context only and is not authorized for implementation review, correction, testing, or execution in this lineage.

## Design Gate

Four separately executed lenses must assess only design requirements R1-R8 for internal consistency, explicit invariants, failure semantics, cancellation and resume behavior, seller-safe provenance, persistence boundaries, migration and operations restoration implications, verification obligations, and task traceability. Their results must be consolidated into one frozen native ledger before evidence classification.

At least one severe inferential finding must be routed through the single native ordinary-4R refuter batch. The authoritative transaction is not gate-complete unless that batch is persisted and `counters.refuter_batches` is greater than zero. The refuter may corroborate, refute, or mark each routed claim inconclusive; it must not edit the candidate.

## Snapshot Safety

All review policies, transaction mirrors, manifests, receipts, requests, reviewer outputs, and repository review-store files are control-plane artifacts and must remain outside genesis scope. Environment files, credentials, secrets, databases, SQLite WAL/SHM companions, backups, logs, generated runtime state, and operational or customer data are forbidden artifacts and must remain excluded.

## Review Fan-Out

Initialization launches no reviewer. A later explicitly authorized action may execute the four lenses and one refuter batch against this immutable design candidate. This policy itself neither starts reviewers nor advances review lifecycle state beyond native genesis creation.
