# Tasks: Jinpeng Supplier Runtime Enablement

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 600-780 |
| 400-line budget risk | High |
| 800-line budget risk | Low |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 bootstrap/domain → PR 2 store/idempotency → PR 3 CEO/pricing → PR 4 CLI/docs/smoke |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Bootstrap contracts and decimal pricing | PR 1 | Tests with domain/agent parser changes. |
| 2 | Idempotent seed persistence and ledger evidence | PR 2 | Depends on PR 1; SQLite tests included. |
| 3 | CEO readiness review tool | PR 3 | Depends on PR 2; read-only tool tests included. |
| 4 | Admin CLI, docs, and smoke path | PR 4 | Final operator slice; no credentials required. |

## Phase 1: Contracts and Pricing Foundation

- [x] 1.1 Update `packages/domain/src/supplierMirror.ts` so `SupplierPricingPolicy.multiplier` accepts finite positive decimals such as `2.5`.
- [x] 1.2 Update `packages/agent/src/conversation/supplierMirrorTools.ts` parser/copy to accept `x2.5` and keep proposal-only pricing.
- [x] 1.3 Add tests in `packages/agent/src/agent.test.ts` for `x2.5`, invalid multipliers, and rounded proposal output.

## Phase 2: Jinpeng Bootstrap and Idempotent Store Evidence

- [x] 2.1 Create `packages/workers/src/supplierMirror/jinpengBootstrap.ts` with env/CLI config parsing, dry-run/apply-seed modes, and no secret persistence.
- [x] 2.2 Seed supplier `jinpeng`, ML/XKP source metadata, both target proposals, low-stock threshold `2`, and `enabled: false` defaults.
- [x] 2.3 Store per-target Maustian `x2.5` owned/improved content and Plasticov `x2` as proposed learned fallback metadata, not approved operational policy.
- [x] 2.4 Use stable ledger idempotency keys for validation skips, blocked enablement, target proposals, and report evidence.
- [x] 2.5 Add SQLite integration tests in `packages/workers/src/workers.test.ts` for repeat bootstrap idempotency and missing credential blocking.

## Phase 3: CEO Readiness and Runtime Gates

- [x] 3.1 Export bootstrap types/service from `packages/workers/src/supplierMirror/index.ts` without enabling the scheduler by default.
- [x] 3.2 Add `review_supplier_mirror_readiness` to `packages/agent/src/conversation/supplierMirrorTools.ts` that returns identity, authority, policy, failures, and ledger evidence.
- [x] 3.3 Add tests in `packages/agent/src/agent.test.ts` proving the readiness tool is read-only and asks for unresolved seller IDs, credentials, threshold, or approval.

## Phase 4: CLI, Docs, and Verification

- [x] 4.1 Create `scripts/supplier-mirror-jinpeng-bootstrap.mjs` defaulting to `--dry-run` and opening the configured SQLite store only from env.
- [x] 4.2 Add `supplier-mirror:jinpeng:dry-run` to `package.json` and ensure no publish, pause, or price-update client is called.
- [x] 4.3 Update `docs/supplier-mirror.md` with env names, dry-run command, missing credential behavior, XKP enrichment limits, and enablement gate.
- [x] 4.4 Verify with `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and no-credential CLI smoke.
