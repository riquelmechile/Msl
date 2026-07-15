# Complete Fetch Remediation Consistency Gate Policy V4

## Target

- Operation: `review/start(target)`
- Lineage: `finalize-economic-run-consistency-fetch-remediation-v4-complete`
- Target kind: `current-changes`
- Mode: `ordinary_4r`
- Generation: `1`
- Risk: `high`
- Purpose: corrected complete immutable genesis for the remediation design gate; implementation review is out of scope

The target is the immutable native snapshot produced by `gentle-ai review-start`. It binds all tracked working-tree changes and only the intended untracked paths listed below.

## Expected Reviewed Artifacts

- `openspec/changes/finalize-economic-run-consistency/apply-progress.md`
- `openspec/changes/finalize-economic-run-consistency/confirmed-findings.md`
- `openspec/changes/finalize-economic-run-consistency/cumulative-metrics-policy.md`
- `openspec/changes/finalize-economic-run-consistency/design.md`
- `openspec/changes/finalize-economic-run-consistency/exploration.md`
- `openspec/changes/finalize-economic-run-consistency/fetch-data-quality-policy.md`
- `openspec/changes/finalize-economic-run-consistency/idempotent-entity-identities.md`
- `openspec/changes/finalize-economic-run-consistency/migration-plan.md`
- `openspec/changes/finalize-economic-run-consistency/operations-restore-alert-policy.md`
- `openspec/changes/finalize-economic-run-consistency/proposal.md`
- `openspec/changes/finalize-economic-run-consistency/real-smoke-plan.md`
- `openspec/changes/finalize-economic-run-consistency/reconciliation-checkpoint-policy.md`
- `openspec/changes/finalize-economic-run-consistency/review-framework-incident.md`
- `openspec/changes/finalize-economic-run-consistency/rollback-plan.md`
- `openspec/changes/finalize-economic-run-consistency/run-association-policy.md`
- `openspec/changes/finalize-economic-run-consistency/run-identity-invariant.md`
- `openspec/changes/finalize-economic-run-consistency/specs/economic-evidence-store/spec.md`
- `openspec/changes/finalize-economic-run-consistency/specs/economic-ingestion-durability/spec.md`
- `openspec/changes/finalize-economic-run-consistency/specs/migration-framework/spec.md`
- `openspec/changes/finalize-economic-run-consistency/tasks.md`
- `packages/agent/src/economics/economicSanitizer.ts`
- `packages/domain/src/economicIdentity.test.ts`
- `packages/memory/tests/economicRunProvenanceStore.test.ts`

## Authority

The authoritative review material is the OpenSpec change `finalize-economic-run-consistency`. The incomplete v4 lineage and v1-v3 lineages remain preserved and unchanged. This independent lineage does not supersede, repair, or reinterpret them.

The native repository-derived event store is authoritative. The repository transaction JSON is a separate, non-authoritative machine mirror only.

## Snapshot Safety

This policy, intended-untracked manifests, transaction mirrors, receipts, requests, reviewer outputs, repository review-store files, and all prior review controls are outside genesis scope. Environment files, credentials, secrets, databases, SQLite WAL/SHM companions, backups, logs, generated runtime state, and operational or customer data are forbidden and must remain excluded.

## Initialization Boundary

Initialization launches no reviewer and performs no review step, probe, freeze, classification, refutation, fix, test, live action, or commit. Only native `review-start` and read-only `review-resume` are authorized.
