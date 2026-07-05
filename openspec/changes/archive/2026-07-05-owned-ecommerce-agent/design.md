# Design: Owned Ecommerce Builder Agent

## Technical Approach

Add an owned ecommerce slice to the hexagonal TypeScript monorepo: domain contracts in `@msl/domain`, SQLite/read-model persistence in `@msl/memory`, proposal workers in `@msl/workers`, CEO-facing tools/lanes in `@msl/agent`, a Medusa-first adapter package, and static Next.js preview routes in `apps/web`. First release is preview-only: workers precompute Medusa-ready storefront projections; public request paths read projections only and never call DeepSeek, workers, agent tools, or mutation adapters.

## Architecture Decisions

| Decision | Choice | Alternatives / Tradeoff | Rationale |
|---|---|---|---|
| Ecommerce target | Medusa-first behind `EcommerceAdapter` in `@msl/ecommerce-medusa` | Direct Medusa coupling is faster but harder to replace | Keeps Medusa semantics while preserving a port boundary. |
| Storefront runtime | Static/precomputed projections only | Dynamic personalization is richer but risks latency and LLM calls | Specs require fast public pages and no request-time reasoning. |
| DeepSeek use | Worker-only ranking/copy with deterministic validators | Deterministic-only ranking is safer but weaker commercially | Non-determinism improves positioning; validators decide usability. |
| Approval path | CEO Agent asks human CEO via Telegram; ecommerce workers stay internal | Direct worker chat would be simpler | Matches existing lane pattern and prevents leaking internal worker selection. |
| Safety model | Deterministic guardrails before and after DeepSeek | Post-checks only miss unsafe inputs; pre-checks only miss generated claims | Fail closed for stock, margin/freshness, secrets, publish, checkout/payment, price/stock mutation, risky claims. |

## DeepSeek Cost/Cache Policy

Mirror the verified Supplier Mirror policy shape in `supplierMirrorDeepSeekPolicy.ts`: stable prefix, cacheable context block, volatile evidence block, explicit model selection, cost estimation, and workforce cost/cache ledger telemetry.

- Stable/cacheable context: lane role, proposal-only boundaries, Medusa target rules, supplier/account scope, guardrail policy, and deterministic ordering for cache reuse.
- Volatile evidence block: Plasticov, Maustian, Supplier Mirror/Jinpeng, future supplier snapshots, read-model rows, Cortex summaries, prices, stock, media, and freshness evidence IDs.
- Model selection: default to low-cost DeepSeek model for ranking/copy; escalate only for policy conflicts, high-risk claims, or publish/checkout preparation.
- Telemetry: record provider, model, hit/miss tokens, estimated micros, lane ID, credential ref, and projection ID through the existing workforce cost/cache ledger.

## Data Flow

```text
Plasticov/Maustian + Supplier Mirror/Jinpeng + future suppliers
        + OperationalReadModel + Cortex context
        -> CandidateCollector with provenance records
        -> deterministic eligibility filters
        -> DeepSeek ranking/copy/positioning (worker only)
        -> claim rewrite/removal + operation validation
        -> Medusa projection + static preview
        -> CEO Agent summary/tool result
        -> Telegram approval for publish/checkout/risky writes
```

Each candidate carries source kind, source account/supplier ID, item ref, evidence IDs, freshness, stock authority, margin evidence, media evidence, read-model snapshot IDs, Cortex node IDs, and blocked/rewrite reasons. Provenance is persisted with projections so CEO tools, static previews, and later Medusa publish attempts can trace every claim.

## Static Preview Boundary

`apps/web/app/storefront/[projectionId]/page.tsx` renders only stored `StorefrontProjection` data. It must not import `@msl/agent`, `@msl/workers`, DeepSeek policy/client code, Telegram tools, or mutation adapters. Use static generation/revalidation from projection IDs where possible; otherwise dynamic rendering still reads local projection data only and emits cache headers compatible with preview freshness. No request-time LLM, candidate collection, approval decision, or external Medusa write is allowed.

## Media and Performance Readiness

Projection builders normalize media into optimized image records: canonical URL or stored asset ref, dimensions, alt text, content hash, responsive sizes, priority flag, and evidence IDs. Readiness checks verify missing/oversized images, alt text, schema metadata, duplicate/unsupported claims, static render budget, and Core Web Vitals readiness before publish/checkout can be prepared.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/domain/src/ownedEcommerce.ts` | Create | Candidate, projection, provenance, media, guardrail, readiness, and action types. |
| `packages/domain/src/preparedAction.ts` | Modify | Add ecommerce publish, checkout activation, price/stock mutation action kinds. |
| `packages/domain/src/index.ts` | Modify | Export owned ecommerce domain contracts. |
| `packages/memory/src/ownedEcommerceStore.ts` | Create | Persist candidates, provenance, projections, validation results, approval state, evidence IDs. |
| `packages/memory/src/index.ts` | Modify | Export owned ecommerce store types/factory. |
| `packages/workers/src/ownedEcommerce/index.ts` | Create | Candidate collection, deterministic filters, DeepSeek planning, projection/media/readiness builder. |
| `packages/workers/src/index.ts` | Modify | Export owned ecommerce worker entrypoints. |
| `packages/ecommerce-medusa/package.json` | Create | `@msl/ecommerce-medusa` package with only domain dependency; no agent/workers dependency. |
| `packages/ecommerce-medusa/tsconfig.json` | Create | Composite package extending root base config and referencing `../domain`. |
| `packages/ecommerce-medusa/src/index.ts` | Create | Medusa adapter implementation and preview/write boundary. |
| `tsconfig.json` | Modify | Add project reference to `./packages/ecommerce-medusa`; root workspace already includes `packages/*`, verify no package.json change needed. |
| `packages/agent/src/conversation/lanes.ts` | Modify | Add `owned-ecommerce` lane contract under CEO orchestration. |
| `packages/agent/src/conversation/ownedEcommerceTools.ts` | Create | CEO-facing read-only review/approval preparation tools. |
| `apps/web/app/storefront/[projectionId]/page.tsx` | Create | Static preview page from stored projection data only. |
| `packages/*/tests`, `apps/web/**/*.test.tsx` | Modify/Create | Unit, integration, import-guard, media, performance, and safety invariant tests. |

## Interfaces / Contracts

```ts
type StorefrontCandidate = { id: string; provenance: CandidateProvenance; itemRef: string; evidenceIds: string[]; stock: { status: string; authority: string }; margin?: { value: number; evidenceId: string }; blockedReasons: string[] };
type CandidateProvenance = { source: "plasticov"|"maustian"|"supplier-mirror"|"future-supplier"|"read-model"|"cortex"; sourceId: string; snapshotIds: string[]; cortexNodeIds?: string[] };
type StorefrontProjection = { id: string; status: "preview"|"approved"|"published"; catalog: MedusaCatalogProjection; content: { seoTitle: string; geoCopy: string; claims: EvidenceClaim[] }; media: OptimizedMedia[]; readiness: GuardrailResult[]; generatedAt: string };
type OptimizedMedia = { src: string; alt: string; width: number; height: number; sizes: string; hash: string; evidenceIds: string[] };
type EcommerceAdapter = { buildPreview(input: StorefrontProjection): Promise<{ previewRef: string }>; publish(input: StorefrontProjection, approval: ApprovalRecord): Promise<{ publicUrl: string }> };
type GuardrailResult = { passed: boolean; severity: "block"|"approval-required"|"warning"; code: string; evidenceIds: string[]; redactedMessage: string };
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Eligibility, provenance, claim rewrite/removal, action risk, media readiness, adapter ports | Vitest pure tests in `packages/domain` and adapter tests with fakes. |
| Integration | Worker collection/ranking/projection with fake evidence and fake DeepSeek | In-memory/fake stores; assert stale evidence blocked, evidence IDs retained, ledger telemetry recorded. |
| Agent/tool | CEO-only outputs, no direct worker Telegram, approval-required operations | Tool tests mirroring `supplierMirrorTools`; assert worker cannot message human directly. |
| Web invariant | Static preview has no request-time LLM/agent/tool imports | Import-guard tests for `page.tsx` and route dependency graph. |
| Performance | Media optimization and Core Web Vitals readiness | Test projection checks for dimensions, responsive sizes, alt text, static cache headers, render budget. |
| Safety | Publish/checkout/price/stock fail closed | Tests require exact CEO approval, credentials, audit record, and passing readiness before writes. |

## Migration / Rollout

Preview-only first. Medusa credentials, public publish, checkout/payment activation, and price/stock mutation stay disabled unless exact config, readiness checks, redacted audit records, cache/cost telemetry, and explicit CEO approval exist.

## Open Questions

- [ ] Exact Medusa deployment/runtime target for previews is not configured yet.
