# Proposal: Enforce Seller-Safe Evidence Supersession

## Intent

Close the first critical R6–R8 audit item: `EconomicEvidenceStore.markSuperseded` can currently mutate a cross-seller target and accept a foreign or missing successor. Supersession must be authorized by an explicit seller identity without exposing target or successor existence.

## Scope

### In Scope
- Require an explicit authorized `sellerId` and named `supersedingEvidenceId` at the `markSuperseded` boundary.
- Perform a seller-scoped target write only when the successor exists and is owned by that same seller.
- Add SQLite production-store tests for valid same-seller links, repeated non-throwing calls, and missing/foreign target or successor zero-mutation cases.

### Out of Scope
- DB migration, external calls, alerts, restore journal, SLOs, dispatcher work, general documentation, Product Launch Intelligence, and all other R6–R8 work.
- Diagnostic result/error distinctions for rejected links; invalid cases remain non-oracular silent no-ops.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `economic-evidence-store`: supersession requires explicit seller authorization and same-seller target/successor ownership.

## Approach

Use one conditional SQLite `UPDATE`: match the target by `evidence_id` and `seller_id`, and require an `EXISTS` successor with the same `seller_id`. This atomically fails closed: any missing or foreign participant produces zero mutation and the existing `void` contract reveals no reason. Preserve valid same-seller links and repeated operations. No migration is required.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/memory/src/economicEvidenceStore.ts` | Modified | Seller-authorized atomic supersession boundary. |
| `packages/memory/src/economicEvidenceStore.test.ts` | Modified | SQLite production-store authorization and no-op coverage. |
| `openspec/changes/enforce-seller-safe-evidence-supersession/specs/economic-evidence-store/spec.md` | New | Delta requirement and scenarios. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Signature change leaves an interface/mock outdated | Low | Typecheck and update only affected structural contracts. |
| Rejected links need diagnostics later | Low | Keep `void` non-oracular contract; design diagnostics separately. |

## Rollback Plan

Revert the source and test change as one unit; no data or schema rollback is needed because the change creates no migration or external side effect.

## Dependencies

- `exploration.md`; existing `economic-evidence-store` specification.

## Success Criteria

- [ ] Only an existing same-seller target and successor can be linked by the supplied authorized `sellerId`.
- [ ] Foreign/missing target or successor causes zero mutation with no differentiated result.
- [ ] Valid same-seller and repeated calls remain non-throwing; source, test, and delta spec stay within 8 files and 400 reviewable lines.
