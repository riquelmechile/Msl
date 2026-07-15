## Exploration: enforce-seller-safe-evidence-supersession

### Current State
`EconomicEvidenceStore.markSuperseded` is a public store method with the signature
`markSuperseded(evidenceId: string, supersededBy: string): void`
(`packages/memory/src/economicEvidenceStore.ts:57-58`). It accepts neither an
authorized `sellerId` nor a named `supersedingEvidenceId` parameter (the latter is
currently the `supersededBy` string). The implementation prepares and executes:

```sql
UPDATE economic_evidence_references
SET superseded_by = ?
WHERE evidence_id = ?
```

(`packages/memory/src/economicEvidenceStore.ts:245-249`, executed at `374-375`).
Therefore authorization is not determined at this operation boundary: the target is
matched globally by its primary-key `evidence_id`, while the replacement ID is not
validated at all. This conflicts with the store's documented cross-seller rule that
all queries scope to `sellerId` (`openspec/specs/economic-evidence-store/spec.md:108-116`).

The legacy table already stores both `seller_id` and `superseded_by`
(`packages/memory/src/economicEvidenceStore.ts:96-112`), so enforcing the boundary
requires a query change, not a schema change. The runtime factory creates this store
with canonical migrations already applied (`packages/memory/src/economicWriteSession.ts:515-520`).

Observed behavior:
- Nonexistent target: the `UPDATE` affects zero rows; `.run()` metadata is ignored and the method returns `void`.
- Foreign-seller target: it is updated if its globally unique `evidence_id` is supplied.
- Foreign-seller successor: any string is stored, including another seller's ID or a nonexistent ID.
- Repeated valid operation: it runs the same update again and remains non-throwing; the existing tests cover only this implicit behavior.
- Zero updated rows: silent success, identical to the public result for an existing target.

No production invocation exists: a repository-wide direct-call search finds only the
two unit-test calls at `packages/memory/src/economicEvidenceStore.test.ts:342,363`.
`packages/agent/src/economics/pipeline.test.ts:1986-1999` only supplies a mock method
to satisfy a local test interface. Consequently no real caller currently omits
`sellerId`; the public method itself omits it.

The `void` result and ignored update count do not directly disclose whether a foreign
target exists. The current defect is stronger: anyone able to call the store with a
guessed/obtained ID can mutate another seller's record. A foreign successor ID is
also accepted without proving existence, so it does not itself provide a response
oracle; it can nevertheless create a cross-seller or dangling reference.

### Affected Areas
- `packages/memory/src/economicEvidenceStore.ts` — change the public signature and atomic supersession SQL.
- `packages/memory/src/economicEvidenceStore.test.ts` — preserve valid/repeat behavior and add target/successor seller-isolation and zero-row tests.
- `openspec/changes/enforce-seller-safe-evidence-supersession/specs/economic-evidence-store/spec.md` — future delta requirement/scenarios for seller-safe supersession.

### Approaches
1. **Single conditional UPDATE** — Accept `(sellerId, evidenceId, supersedingEvidenceId)` and update only when the target and successor both belong to `sellerId`.
   - Pros: one atomic SQLite statement; zero-row invalid cases can remain silent and indistinguishable; preserves successful same-seller and repeated calls; no migration.
   - Cons: callers receive no reason when a link is rejected.
   - Effort: Low.

2. **Read-then-update validation** — Read target and successor ownership before updating.
   - Pros: can produce detailed errors.
   - Cons: separate reads create a TOCTOU window unless enclosed in an `IMMEDIATE` transaction; different errors/counts can become an existence oracle; unnecessary with no current callers requiring diagnostics.
   - Effort: Medium.

### Recommendation
Use a single conditional statement, for example:

```sql
UPDATE economic_evidence_references AS target
SET superseded_by = ?
WHERE target.evidence_id = ?
  AND target.seller_id = ?
  AND EXISTS (
    SELECT 1
    FROM economic_evidence_references AS successor
    WHERE successor.evidence_id = ?
      AND successor.seller_id = ?
  )
```

Bind `supersedingEvidenceId, evidenceId, sellerId, supersedingEvidenceId, sellerId`.
This admits only existing, same-seller target/successor pairs and leaves invalid,
foreign, and missing cases as silent zero-row results, preserving the existing `void`
API and repeat semantics for a valid pair. It is atomic within SQLite, so no explicit
transaction is needed for this operation; a read-then-write alternative would need a
transaction to prevent TOCTOU. No migration is technically necessary because the
required columns and primary-key lookups already exist.

Preliminary implementation forecast: 2 source/test files, approximately 90-140
reviewable changed lines. With the future delta spec, 3 files and approximately
125-190 lines. This is within the 8-file and 400-line limits and needs no migration.

### Risks
- Changing the interface requires every structural implementation/mock to add `sellerId`; direct-call evidence currently shows no production callers, but compile-time checks must catch any indirect contract use.
- Keeping `void` intentionally hides invalid-case distinctions; later diagnostic requirements would need a separately designed, non-oracular result contract.
- SQLite's `changes` count is not relied on; a repeated assignment may report a matched row while invalid links report zero, but neither is exposed through this API.

### Ready for Proposal
Yes — scoped to seller-safe economic evidence supersession only. The proposal should state that valid same-seller links and repeated calls remain non-throwing, while missing/foreign target or successor links cause no mutation and expose no differentiated result.
