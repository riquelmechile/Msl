# Tasks: MercadoLibre API Capabilities Refresh

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 700-1,000 across full rollout; 180-260 for first slice |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 specs/matrix → PR 2 domain/client reads → PR 3 tools/MCP reads → PR 4 prepared-action docs |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Complete read-first capability matrix and MLC support classification | PR 1 | Base main; no runtime execution or mutations |
| 2 | Add domain read kinds and OAuth GET client contracts | PR 2 | Depends on PR 1; tests stay with client changes |
| 3 | Expose project-owned safe read tools and MCP registrations | PR 3 | Depends on PR 2; no execute tools |
| 4 | Document prepare-only/future approval boundaries | PR 4 | Depends on matrix; approval/audit verification |

## Phase 1: Spec Matrix Foundation

- [x] 1.1 Update `openspec/specs/ml-api-integration/spec.md` with a capability matrix for listing quality, category attributes/specs, pictures, shipping, visits/metrics, reputation, questions, and messages.
- [x] 1.2 In the same spec, classify each entry as `docs-only`, `safe-read`, `prepare-only`, or `future-execute-with-approval` with evidence reference, freshness, confidence, and runtime surface.
- [x] 1.3 Validate and mark `siteSupport` as `MLC-confirmed` or `unknown`; unknown support MUST remain low confidence and non-executable.
- [x] 1.4 Update `openspec/specs/custom-business-mcp-tools/spec.md` to state official Mercado Libre MCP is docs lookup only and project-owned tools own runtime capabilities.

## Phase 2: Safety Boundary Specs

- [x] 2.1 Update `openspec/specs/mercadolibre-account-integration/spec.md` to preserve fail-closed OAuth, allowed seller IDs, MLC seller scope, and account mismatch blocking for all reads.
- [x] 2.2 Update `openspec/specs/action-approval-safety/spec.md` so mutation-like capabilities are prepare-only or future-approved with approval/audit metadata.
- [x] 2.3 Update `openspec/specs/seller-business-insights/spec.md` so recommendations cite source, freshness, confidence, partial coverage, and no implied mutation ability.

## Phase 3: Runtime Read Follow-ups

- [x] 3.1 Modify `packages/domain/src/readSnapshot.ts` with approved read kinds and metadata vocabulary only after PR 1 lands.
- [x] 3.2 Modify `packages/mercadolibre/src/index.ts` with OAuth-backed GET endpoints and normalizers only for `MLC-confirmed` `safe-read` entries.
- [x] 3.3 Modify `packages/tools/src/index.ts` to wrap safe reads with blocked-result handling, seller scope, freshness, and confidence.
- [x] 3.4 Modify `packages/mcp/src/index.ts` to register `read_mercadolibre_*` tools only; assert no execute mutation tool appears.

## Phase 4: Verification

- [x] 4.1 Add Vitest coverage in `packages/mercadolibre/src/*.test.ts` for normalizers, MLC-confirmed vs unknown support, and fail-closed seller access.
- [x] 4.2 Add Vitest coverage in `packages/tools/src/*.test.ts` for blocked unsafe reads, prepare-only requests, and metadata disclosure.
- [x] 4.3 Add Vitest coverage in `packages/mcp/src/*.test.ts` for read-only registration and absence of mutation execution tools.
- [x] 4.4 Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run format:check` before each PR slice.
