# Apply Progress: Jinpeng Supplier Runtime Enablement

## Mode

Standard. Strict TDD is disabled in `openspec/config.yaml`.

## Workload / PR Boundary

- Delivery strategy: auto-chain
- Chain strategy: stacked-to-main
- Current work unit: PR2 / Phase 2 — Jinpeng Bootstrap and Idempotent Store Evidence
- Boundary: builds on PR1 decimal pricing; adds the worker bootstrap service, disabled local store seed/proposals, idempotent ledger evidence, and SQLite tests only. CEO readiness tool, CLI/docs/smoke, worker enablement, publishing, pausing, and price updates remain out of scope.
- Estimated review budget impact: focused stacked PR slice within the configured 800-line budget.

## Completed Tasks

- [x] 1.1 Updated `packages/domain/src/supplierMirror.ts` so `SupplierPricingPolicy.multiplier` accepts finite positive decimal numbers such as `2.5`.
- [x] 1.2 Updated `packages/agent/src/conversation/supplierMirrorTools.ts` parser/copy to accept `x2.5`/`×2,5` and keep proposal-only pricing with `noMutationExecuted: true`.
- [x] 1.3 Added tests in `packages/agent/src/agent.test.ts` for decimal multiplier parsing, invalid multipliers, and rounded proposal output.
- [x] 2.1 Created `packages/workers/src/supplierMirror/jinpengBootstrap.ts` with runtime env/CLI config parsing, `dry-run`/`apply-seed` modes, and no secret persistence.
- [x] 2.2 Seeded disabled supplier `jinpeng`, ML/XKP source metadata, both target proposals, low-stock threshold `2`, and `enabled: false` defaults.
- [x] 2.3 Stored Maustian `x2.5` owned/improved content and Plasticov `x2` as proposed learned fallback policies rather than approved operational pricing.
- [x] 2.4 Added stable ledger idempotency keys for validation skips, blocked/deferred enablement, target proposals, and readiness report evidence.
- [x] 2.5 Added SQLite integration tests in `packages/workers/src/workers.test.ts` for repeated bootstrap idempotency and missing credential/source-info blocking.

## Verification

- `npm test -- --run packages/agent/src/agent.test.ts` — passed
- `npm test -- --run packages/workers/src/workers.test.ts` — passed
- `npm test` — passed
- `npm run typecheck` — passed
- `npm run lint` — passed
- `npm run format:check` — passed

## Safety Notes

- No publish, pause, price update, worker enablement, runtime execution, or external API call was added.
- The bootstrap persists only local disabled seed/proposal/readiness evidence in the configured Supplier Mirror store; credentials are represented as presence/missing flags and missing env names, not stored secret values.
- CEO confirmation/proposal-only behavior remains intact through the existing pricing proposal tool response.

## Remaining Tasks

- [ ] Phase 3: CEO Readiness and Runtime Gates
- [ ] Phase 4: CLI, Docs, and Verification
