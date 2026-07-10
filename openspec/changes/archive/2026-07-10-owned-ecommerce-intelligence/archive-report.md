# Archive Report: Owned Ecommerce Intelligence

**Archived**: 2026-07-10
**PR**: #128 → squash commit `214e528` on main
**Verification**: 2356 tests pass, no verify-report artifact persisted (tests validated externally)

## Archive Contents

| Artifact | Status |
|----------|--------|
| proposal.md | ✅ |
| design.md | ✅ |
| specs/owned-ecommerce-agent/spec.md (delta) | ✅ |
| tasks.md | ✅ (23/23 tasks complete) |
| verify-report.md | ⚠️ Not found — verification was performed externally (2356 tests pass per orchestrator) |

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| owned-ecommerce-agent | Updated | 5 requirements modified, 7 requirements added |

### MODIFIED Requirements
1. **Evidence-Based Storefront Selection** — Added `SupplierWebSignals` as source, `supplier-web-signal` provenance, and "Signal-driven provenance" scenario
2. **Cortex-Powered Supplier Reasoning** — Added `cortexUnavailable` marker, seller isolation clause, "Cortex unavailable" and "Seller isolation" scenarios
3. **DeepSeek Merchandising Reasoning** — Added deterministic fallback, FakeTransport requirement, superlative blocking, and 3 new scenarios
4. **Static Medusa Storefront Projections** — Added `noMutationExecuted`, `missingMedia`, evidence-mapped SEO, GEO intent+FAQ, and 2 new scenarios
5. **CEO-Gated Owned Ecommerce Operations** — Added 3 read-only tools (`inspect_owned_ecommerce_candidate`, `prepare_storefront_projection`, `read_storefront_projection_status`) and 3 new scenarios

### ADDED Requirements
1. **SupplierWebSignal Contract** — 6 signal kinds, validation, deduplication (3 scenarios)
2. **Supplier Manager Bridge** — Signal enqueue, missing evidence handling (4 scenarios)
3. **Intelligence Service + Daemon** — Cortex processing, graceful degradation, proposal generation (3 scenarios)
4. **Candidate Scoring** — Deterministic scoring, stock/margin blocking, creative delegation (5 scenarios)
5. **Creative Studio Delegation** — Creative request enqueue, dedup suppression, missingMedia in proposals (3 scenarios)
6. **AccountBrain Channel** — Cross-channel comparison, recommendation evidence (3 scenarios)
7. **Work Sessions** — Observation/lesson registration, store-down resilience (4 scenarios)

### Unchanged Requirements
- Backend-Only Medusa Runtime Execution (3 scenarios preserved)
- Public Publish and Checkout Activation Gates (3 scenarios preserved)

## Source of Truth Updated

`openspec/specs/owned-ecommerce-agent/spec.md` — now contains 14 requirements with 39 scenarios.

## Risks & Notes

- No CRITICAL issues found
- Verify-report artifact was not persisted in the change folder; verification was performed externally (2356 tests all passing)
- All 23 tasks were marked complete before archival
- No destructive deltas — all MODIFIED requirements were additive (new clauses and scenarios appended, existing scenarios preserved)
