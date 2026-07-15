# Fetch Remediation Consistency Gate Policy V4

## Target

- Operation: `review/start(target)`
- Lineage: `finalize-economic-run-consistency-fetch-remediation-v4`
- Target kind: `current-changes`
- Mode: `ordinary_4r`
- Generation: `1`
- Risk: `high`
- Purpose: independent corrected remediation design gate R1-R8; implementation review is out of scope

The target is the immutable native snapshot produced by `gentle-ai review-start`. It binds the complete current working-tree candidate, including `review-framework-incident.md`, the corrected design, migration plan, delta specifications, tasks, and tracked `packages/agent/src/economics/dataFetcher.ts`.

## Authority

The authoritative review material is the OpenSpec change `finalize-economic-run-consistency`. The v3 incident is recorded in `review-framework-incident.md`: lineage `finalize-economic-run-consistency-fetch-remediation-design-v3` is permanently unusable as PASS evidence after an accidental empty native freeze. V1-v3 stores and mirrors remain preserved and are not superseded, repaired, or reinterpreted by this independent lineage.

The native repository-derived event store is authoritative. The repository transaction JSON is a separate, non-authoritative machine mirror only.

## Design Gate

Four separately executed lenses must assess only design requirements R1-R8. Their findings must be consolidated into one native ledger with lens labels before classification. Gentle AI 1.49.0 does not persist separate lens-execution identities, so no artifact may claim that capability.

Exactly one native refuter batch is required only when genuine pending inferential severe candidates exist. If none exist, the positive-counter requirement is incompatible with the canonical contract and must not be satisfied by fabricated evidence.

## Snapshot Safety

This policy, transaction mirrors, manifests, receipts, requests, reviewer outputs, repository review-store files, and all v1-v3 review controls are outside genesis scope. Environment files, credentials, secrets, databases, SQLite WAL/SHM companions, backups, logs, generated runtime state, and operational or customer data are forbidden and must remain excluded.

## Review Fan-Out

Initialization launches no reviewer and performs no probe, freeze, classification, refutation, fix, test, live action, or commit. Only native `review-start` and read-only `review-resume` are authorized for initialization.
