# SDD Change Archive

Archived changes from the spec-driven development cycle. Each entry preserves the full SDD artifact chain (proposal → spec → design → tasks) as an audit trail.

**Status per entry reflects the state at archive time.** Current system state lives in `openspec/specs/` and the codebase.

---

## 2026-07-11-finalize-economic-ingestion-durability

**Status:** Implemented / Archived
**Phase:** P1 hardening — durability improvements on top of P0 PR 4/4

### Summary of 5 PRs

| PR | Unit | Description |
|----|------|-------------|
| 1/5 | UUID RunIdFactory | `CryptoRunIdFactory` + `DeterministicRunIdFactory`, replaces sequential counter |
| 2/5 | Fail-closed + Atomic tx | No silent catch, `db.transaction()` wraps final writes, checkpoint-after-commit |
| 3/5 | Evidence Store + Provenance | `EconomicEvidenceStore` (15 cols, composite key), `ingestion_run_id` on components/snapshots, multi-dimensional reconciliation |
| 4/5 | Full verification suite | 65+ tests: evidence store CRUD, fault injection (6 points), rollback, dual-seller, re-ingestion, migration upgrade, CLI inspect |
| 5/5 | Docs + Archive | README, ARCHITECTURE, ROADMAP, docs/, specs delta, archive |

### Key Architectural Decisions

- **UUID IDs over counters**: Run IDs (`economic-ingestion-{uuid}`) and evidence IDs (`evidence-{uuid}`) survive restarts, no collision risk
- **Fail-closed over best-effort**: Persistence errors abort the pipeline, never silently swallowed
- **Atomic transaction boundary**: Evidence, components, snapshots, run, and checkpoint all commit or rollback together
- **Run-scoped vs cumulative metrics**: `runMetrics` resets per invocation; `cumulativeMetrics` aggregates from DB
- **Multi-dimensional reconciliation**: Revenue, cost, and coverage evaluated independently; zero-both-sides → incomplete
- **MigrationRegistry for economic tables**: v1–v5 additive DDL, idempotent, feature-gated
- **Evidence Store with provenance**: 15-column composite-key table, cross-seller isolation, no PII

### Remaining Items

- **Dual persistent smoke test**: Run on real production data with both Plasticov and Maustian credentials to confirm durability in production
- **Product cost**: Stub adapter — requires Supplier Mirror integration with real supplier data
- **Landed cost**: Stub adapter — requires customs, freight, and import documentation
- **Other stub adapters** (packaging, financing, tax, other): require external data sources or manual entry
