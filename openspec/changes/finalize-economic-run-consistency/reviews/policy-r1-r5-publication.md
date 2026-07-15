# R1-R5 Publication Review Policy

## Target

- Operation: `review/start(target)`
- Lineage: `finalize-economic-run-consistency-r1-r5-publication-v2`
- Change: `finalize-economic-run-consistency`
- Issue: `#132`
- Branch: `feat/finalize-economic-run-consistency`
- Base SHA: `a2cd0f99dd1389f7b3f5f242e1f990e5b72148c2`
- Target kind: `current-changes`
- Mode: `ordinary_4r`
- Risk: `high`
- Trigger: complete R1-R5 working-tree diff exceeds 400 authored changed lines
- Delivery: one draft PR with maintainer-approved, one-time `size:exception`

The target is the immutable snapshot produced natively by `gentle-ai review-start`.
It must include every tracked working-tree change and every valid untracked R1-R5
application, test, migration, OpenSpec, and technical-documentation path. The native
transaction path set and intended-untracked proof are the authoritative explicit manifest.

## Snapshot Safety

Exclude environment files, credentials, secrets, API keys, tokens, commercial or local
SQLite databases, WAL/SHM companions, backups, logs, dumps, `/tmp`, smoke output,
MercadoLibre payloads, customer data, PII, `node_modules`, `dist`, and `.next`.

Existing and newly generated review policy, transaction, ledger, receipt, bundle, and gate
context artifacts are control-plane mirrors and are not application snapshot inputs. No
excluded path may appear in the native intended-untracked manifest.

## Review Fan-Out

Run exactly four detached, read-only initial reviewers against the same immutable snapshot:

1. `review-risk`
2. `review-resilience`
3. `review-readability`
4. `review-reliability`

Each reviewer receives the native transaction identity, immutable snapshot identity,
complete snapshot path set, policy hash, and canonical bounded-review contract. Each performs
one exhaustive sweep, emits one structured result, does not edit files or delegate, and
terminates.

## Finding and Refuter Contract

Each claim must include `id`, `lens`, `location`, `severity`, `claim`, `evidence_class`,
`proof_refs`, and `status`. Findings freeze after the four initial results are merged.
Deterministic severe findings are corroborated directly. Inferential severe findings, if any,
are sent together to at most one detached refuter batch. No empty refuter batch is required or
permitted when no inferential severe candidate exists.

## Acceptance Scope

Review the complete bound R1-R5 snapshot for correctness, economic invariants, durability,
concurrency, recovery, migration safety, reconciliation/checkpoint semantics, seller
isolation, package boundaries, operational failure handling, observability, test adequacy,
and maintainability. Verify especially:

- private Memory imports reduce from 19 to 0;
- productive pipeline write bypasses reduce from 11 to 0;
- `@msl/memory/internal` and `internal.ts` are absent and Memory exports only `.`;
- `AdmittedEconomicWriteSession` is productively wired once per successful commit;
- receipt, fence, lease, renewal, epoch increment, rollback, and cleanup remain Memory-owned;
- `MaintenanceWriteAdmission` owns migration/bootstrap writes;
- derived abort signals and deadline clipping reach productive transports;
- Plasticov/Maustian isolation remains fail-closed;
- R1-R5 are complete while R6-R8 remain unstarted;
- no MercadoLibre mutation or smoke execution occurs.

The review may approve only after independent final verification binds current test/build
evidence and the frozen findings ledger to this exact snapshot. Publication remains draft-only.
