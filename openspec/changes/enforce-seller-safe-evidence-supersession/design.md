# Design: Enforce Seller-Safe Evidence Supersession

## Technical Approach

Change only the internal SQLite evidence-store mutation defined by delta R4. The caller must supply its already-authorized seller identity; the store validates runtime inputs and performs one conditional `UPDATE`. SQLite evaluates the target ownership and successor ownership in the same statement, so rejected requests are silent `void` no-ops rather than observable authorization checks.

## Architecture Decisions

| Decision | Choice | Alternative / tradeoff | Rationale |
|---|---|---|---|
| Authority provenance | `sellerId` is a required method argument from an approved seller-scoped runtime/store boundary. | Derive it from target, successor, model, or external payload. | Caller provenance is explicit and prevents a record lookup from becoming authorization. |
| Consistency | One conditional SQLite `UPDATE` with `EXISTS`. | Read-then-validate-then-update or multiple statements/transaction. | A single statement has no TOCTOU window or partial write. |
| Rejection contract | Return `void`; do not inspect `changes`, log, or throw for invalid/rejected requests. | Result codes or detailed errors. | Preserves existing non-oracular repeat semantics and does not disclose existence/ownership. |

## Data Flow

```
approved seller-scoped runtime
  sellerId, evidenceId, supersedingEvidenceId
                 │
                 v
EconomicEvidenceStore input guard ──invalid──> void
                 │ valid
                 v
one SQLite UPDATE (target seller match + successor EXISTS/seller match)
                 │
                 v
           void (one row or zero rows)
```

The exact public structural contract is:

```ts
markSuperseded(sellerId: string, evidenceId: string, supersedingEvidenceId: string): void;
```

`sellerId` is authorization provenance, never inferred. The input guard accepts only non-empty, non-whitespace strings without NUL characters for all three values; empty, malformed, absent-at-runtime, or non-string values return before SQLite binding. It must not normalize or report identifiers.

The prepared statement is:

```sql
UPDATE economic_evidence_references AS target
SET superseded_by = ?
WHERE target.evidence_id = ? AND target.seller_id = ?
  AND EXISTS (
    SELECT 1 FROM economic_evidence_references AS successor
    WHERE successor.evidence_id = ? AND successor.seller_id = ?
  )
```

Bind, in order: `supersedingEvidenceId`, `evidenceId`, `sellerId`, `supersedingEvidenceId`, `sellerId`. Ignore the run result. Thus target/successor missing or foreign yields zero rows; there is no post-mutation filtering, preliminary read, transaction split, or mutation of adjacent state. Repeating a valid link performs a harmless deterministic write and remains non-throwing.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/memory/src/economicEvidenceStore.ts` | Modify | Update the interface and implementation signature, add input guard, and replace the global update with the conditional statement. |
| `packages/memory/src/economicEvidenceStore.test.ts` | Modify | Replace legacy two-argument tests and add hostile SQLite authorization/no-op coverage. |
| `packages/memory/tests/economicRunProvenanceStore.test.ts` | Modify | Extend its existing file-backed, multi-worker SQLite harness with distinct-seller supersession concurrency proof. |

No production caller invokes `markSuperseded`; `EconomicEvidenceReader` deliberately excludes it, and the agent test mock is local/unaffected unless TypeScript proves otherwise. Do not export this internal store from `packages/memory/src/index.ts` or add a public runtime API.

## Testing Strategy

Use `better-sqlite3`, not mocks: in-memory store tests for behavior and the existing WAL/file-backed worker harness for concurrency. RED cases are: (1) Plasticov valid link, (2) Maustian valid link, (3–4) both foreign-target directions, (5–6) both foreign-successor directions, (7) missing target, (8) missing successor, (9) empty/malformed seller, (10) empty/malformed or runtime-missing evidence IDs, (11) rejected calls preserve target fields plus source-health/checkpoint/run/lease/fence/epoch rows, (12) return/errors/log capture contains no foreign seller, payload, email, token, path, or SQL, (13) repeated valid call is void/non-throwing, and (14) seller-scoped reads plus concurrent valid Plasticov/Maustian worker operations remain isolated.

Each rejection asserts all relevant `superseded_by` values before/after and no unrelated-row count/value change. The concurrency test opens two WAL connections/workers against one temporary SQLite file, waits for both completion, then verifies each seller's own target only. Run focused Vitest, then workspace typecheck; no E2E coverage is relevant.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. SQLite workers are test infrastructure, not a production process-integration boundary.

## Migration / Rollout

No migration required: `seller_id`, `evidence_id`, and `superseded_by` already exist, and the change only narrows write eligibility. Roll back by reverting the source and matching tests together; schema and persisted data need no rollback. The rollback boundary is this mutation only, not the existing migration registry or runtime write-session policy.

## Open Questions

None.
