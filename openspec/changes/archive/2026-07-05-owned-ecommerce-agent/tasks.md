# Tasks: Owned Ecommerce Builder Agent

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,200-1,800 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 domain/memory → PR 2 worker → PR 3 adapter/web → PR 4 CEO/safety |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Domain, guardrails, persistence | PR 1 | Unit/store tests. |
| 2 | Worker, DeepSeek policy, projections | PR 2 | Fake DeepSeek tests. |
| 3 | Medusa adapter and static preview | PR 3 | Import-guard tests. |
| 4 | CEO tools and safety | PR 4 | Final verification. |

## Phase 1: Domain and Persistence Foundation

- [x] 1.1 Create `packages/domain/src/ownedEcommerce.ts` with candidate, provenance, projection, media, guardrail, readiness, adapter types.
- [x] 1.2 Update `packages/domain/src/preparedAction.ts` with publish, checkout, price, and stock action kinds.
- [x] 1.3 Export contracts from `packages/domain/src/index.ts` and test provenance, risk codes, and fail-closed action typing.
- [x] 1.4 Create `packages/memory/src/ownedEcommerceStore.ts` for candidates, projections, validation, approvals, evidence IDs, and redacted reasons.
- [x] 1.5 Export the store from `packages/memory/src/index.ts` and test stale/incomplete evidence persistence.

## Phase 2: Worker Projection Pipeline

- [x] 2.1 Create `packages/workers/src/ownedEcommerce/index.ts` collecting ML accounts, Supplier Mirror/Jinpeng, future suppliers, read-model, and Cortex evidence.
- [x] 2.2 Add filters for freshness, stock authority, margin, secrets, checkout/payment, publish, price/stock, and risky claims.
- [x] 2.3 Add worker-only DeepSeek policy mirroring `supplierMirrorDeepSeekPolicy.ts`, with cost/cache ledger telemetry.
- [x] 2.4 Build projections with evidence-backed SEO/GEO claims, optimized media, schema metadata, and block/rewrite reasons.
- [x] 2.5 Export worker entrypoints from `packages/workers/src/index.ts` and test fake evidence, fake DeepSeek, stale blocks, and evidence IDs.

## Phase 3: Medusa Adapter and Static Preview

- [x] 3.1 Create `packages/ecommerce-medusa/package.json`, `tsconfig.json`, and `src/index.ts` with preview/write boundaries and only `@msl/domain` dependency.
- [x] 3.2 Update root `tsconfig.json` with `./packages/ecommerce-medusa` project reference.
- [x] 3.3 Create `apps/web/app/storefront/[projectionId]/page.tsx` rendering stored projection data with preview cache/freshness headers.
- [x] 3.4 Add import-guard tests proving the route excludes `@msl/agent`, `@msl/workers`, DeepSeek, Telegram tools, and mutation adapters.

## Phase 4: CEO Orchestration and Safety

- [x] 4.1 Update `packages/agent/src/conversation/lanes.ts` with an internal `owned-ecommerce` specialist under CEO control.
- [x] 4.2 Create `packages/agent/src/conversation/ownedEcommerceTools.ts` with CEO-facing review/approval-preparation tools only.
- [x] 4.3 Test CEO-only Telegram behavior: worker returns evidence-backed results and never messages the human directly.
- [x] 4.4 Test approval boundaries for publish, checkout/payment, price/stock, risky claims, credentials, audit records, and readiness.

## Phase 5: Verification

- [x] 5.1 Run `npm test` for domain, memory, workers, adapter, agent, and web invariants.
- [x] 5.2 Run `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` before handoff.
- [x] 5.3 Document rollback: disable lane/tools/worker and leave publish/checkout credentials unconfigured.
