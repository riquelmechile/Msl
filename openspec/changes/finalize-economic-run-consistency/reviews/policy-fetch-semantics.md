# Economic Run Consistency Fetch-Semantics Review Policy

## Target

- Operation: `review/start(target)`
- Lineage: `finalize-economic-run-consistency-fetch-semantics`
- Target kind: `current-changes`
- Mode: `ordinary_4r`
- Generation: `1`
- Risk: `high`
- Trigger: complete working-tree diff exceeds 400 authored changed lines and spans economic ingestion, persistence, migration, reconciliation, checkpoint, CLI, factory, tests, and OpenSpec contracts

The target is the immutable native snapshot produced by `gentle-ai review-start`. It binds every tracked working-tree change, including `packages/agent/src/economics/dataFetcher.ts`, plus only the explicitly intended untracked implementation, test, and OpenSpec paths.

## Scope Rationale

The economic run consistency contract crosses fetch semantics, pipeline orchestration, provider adapters, durable run/evidence/outcome stores, reconciliation checkpoints, CLI and daemon wiring, factories, domain identities, migration behavior, tests, and the governing OpenSpec artifacts. Reviewing a narrower slice could miss failures where a successful empty provider response is confused with provider unavailability or failure, or where that distinction is lost across persistence and finalization boundaries.

The prior lineage policy and transaction mirror, this policy, and this lineage's machine transaction mirror are control-plane artifacts. They remain outside the reviewed application snapshot so creating review metadata cannot recursively alter the candidate.

## Snapshot Safety

The intended-untracked manifest excludes environment files, databases, SQLite WAL/SHM companions, backups, logs, credentials, secrets, and operational or customer data. It also excludes all review policy and transaction mirror artifacts.

## Review Fan-Out

This policy reserves the ordinary 4R review shape but does not launch reviewers during initialization. A later explicitly authorized review may run exactly four detached, read-only initial reviewers against this immutable snapshot:

1. `review-risk`
2. `review-resilience`
3. `review-readability`
4. `review-reliability`

Each reviewer must receive the native transaction identity, immutable snapshot identity, complete genesis path set, policy hash, and canonical bounded-review contract. Reviewers must not edit files, launch another actor, or mutate lifecycle state.

## Finding Contract

Each claim must include `id`, `lens`, `location`, `severity`, `claim`, `evidence_class`, `proof_refs`, and `status`. Allowed severities are `BLOCKER`, `CRITICAL`, `WARNING`, and `SUGGESTION`. Initial findings freeze only after all four authorized results are merged.

## Review Focus

Review the complete bound snapshot for behavioral correctness, economic consistency, success-empty versus unavailable/provider-failure semantics, durability, idempotency, migration safety, reconciliation and checkpoint behavior, data isolation, failure recovery, test adequacy, and maintainability. Do not inspect excluded runtime data, credentials, environment files, or local databases.
