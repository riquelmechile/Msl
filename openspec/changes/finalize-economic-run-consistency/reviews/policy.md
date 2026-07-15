# Formal Bounded Review Policy

## Target

- Operation: `review/start(target)`
- Lineage: `finalize-economic-run-consistency`
- Target kind: `current-changes`
- Mode: `ordinary_4r`
- Generation: `1`
- Risk: `high`
- Trigger: complete working-tree diff exceeds 400 authored changed lines

The target is the immutable native snapshot produced by `gentle-ai review-start`. It includes all tracked working-tree changes and only the untracked paths named in the intended-untracked manifest supplied at transaction start.

## Snapshot Safety

The intended-untracked manifest must exclude environment files, SQLite databases, SQLite WAL/SHM companions, backups, logs, credentials, secrets, and real operational or customer data. Review policy and transaction artifacts are control-plane state and are not part of the reviewed application snapshot.

## Review Fan-Out

Run exactly four detached, read-only initial reviewers against the same immutable snapshot:

1. `review-risk`
2. `review-resilience`
3. `review-readability`
4. `review-reliability`

Each reviewer receives the native transaction identity, immutable snapshot identity, complete snapshot path set, this policy hash, and the canonical bounded-review contract. Each reviewer performs one exhaustive sweep, emits one structured result, does not edit files or launch another actor, and terminates.

## Finding Contract

Each claim must include `id`, `lens`, `location`, `severity`, `claim`, `evidence_class`, `proof_refs`, and `status`. Allowed severities are `BLOCKER`, `CRITICAL`, `WARNING`, and `SUGGESTION`. Initial findings freeze after the four results are merged. No reviewer may mutate lifecycle state directly.

## Scope

Review the complete bound snapshot for behavioral correctness, economic consistency, durability, idempotency, migration safety, reconciliation and checkpoint semantics, data isolation, failure recovery, test adequacy, and maintainability. Do not inspect or use excluded runtime data, credentials, environment files, or local databases.
