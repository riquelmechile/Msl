## Exploration: MLC Read Tools Foundation

### Current State
The merged MVP is a deterministic TypeScript monorepo with package boundaries for MercadoLibre access state, memory/cache contracts, custom tools, principal agent behavior, workers, and a Next.js demo UI. MercadoLibre integration currently exposes read-only client methods for listings, orders, messages, and reputation through a generic transport, while custom tools already enforce approval/audit safety for prepared writes. The README explicitly states there are no real MercadoLibre credentials, OAuth calls, real API calls, external AI/media providers, or autonomous publication.

The source-of-truth specs already require project-owned tools backed by direct MercadoLibre APIs, local-first memory with freshness metadata, and fresh-enough business data for daily summaries. The narrowest next product/code slice is therefore to bridge the existing MercadoLibre client and tool layer for safe authorized reads, without introducing real OAuth, persistence, writes, or live provider integration yet.

### Affected Areas
- `packages/mercadolibre/src/index.ts` — currently defines OAuth access evaluation and low-level direct read client methods, but does not normalize MercadoLibre read payloads into seller-facing business snapshots.
- `packages/tools/src/index.ts` — currently supports docs lookup and prepared writes; it does not expose concrete custom read tools for listings, orders, messages, or reputation.
- `packages/memory/src/index.ts` — defines local-first repository and freshness contracts that read tools can use, but has no small in-memory snapshot adapter for demo/testable tool reads.
- `packages/domain/src/*` — contains seller/listing/cache contracts that should remain the shared vocabulary for read results and freshness metadata.
- `tests/tools/tools.integration.test.ts` or package-level tests — should prove reads use project-owned tools, include source/freshness/confidence metadata, block revoked access, and do not require approval.
- `apps/web/app/demo.ts` and `apps/web/app/demo-console.tsx` — may later consume read-tool output, but should be avoided or kept minimal in this first slice to stay within the review budget.
- `openspec/specs/custom-business-mcp-tools/spec.md`, `openspec/specs/mercadolibre-account-integration/spec.md`, and `openspec/specs/business-memory-cache/spec.md` — likely need small delta specs for concrete read-tool behavior.

### Approaches
1. **MLC read tools foundation** — Add concrete project-owned read tools that wrap the existing `MlcApiClient`/access boundary and return typed business responses with freshness, source, confidence, and no approval requirement.
   - Pros: Directly advances real product capability after the MVP; small, testable, reviewable; reuses existing boundaries; preserves approval safety by limiting scope to reads.
   - Cons: Still uses fake/test transports and memory adapters rather than live credentials; UI impact is limited unless a later slice wires it into the demo.
   - Effort: Medium

2. **OAuth connection flow skeleton** — Add route/API boundaries and token lifecycle placeholders for account connection before adding read tools.
   - Pros: Moves closer to real MercadoLibre account integration; clarifies credential and reconnect seams.
   - Cons: Higher security/design surface; risks exceeding 400 changed lines; less user-visible unless backed by real configuration and callback handling.
   - Effort: High

3. **Daily insights data pipeline** — Feed `generateDailySummary` from normalized listing/order/reputation snapshots instead of hardcoded demo candidates.
   - Pros: Improves product realism in a seller-facing area; builds on existing insights package.
   - Cons: Depends on trustworthy read-tool inputs; otherwise it couples demo logic to placeholder data and may create rework.
   - Effort: Medium/High

### Recommendation
Start with **MLC read tools foundation** using change name `mlc-read-tools-foundation`. This is the safest next slice because it converts the MVP from static demo boundaries toward usable authorized read capabilities while staying inside the current architecture: direct MercadoLibre API boundary, project-owned custom tools, local-first/freshness metadata, and no write execution without approval.

Keep the first implementation slice focused on package behavior and tests: define typed read tool inputs/outputs, wrap listings/orders/messages/reputation reads, attach source/freshness/confidence metadata, handle revoked/mismatched access from the existing client, and prove reads never require approval. Defer real OAuth callback handling, real persistence, UI rewiring, pagination depth, write executors, and live credentials to later changes.

### Risks
- MercadoLibre API payload shapes may need documentation validation before real normalization; the first slice should avoid pretending the mocked transport is a complete live integration.
- Adding UI wiring in the same slice could exceed the 400-line review budget and blur the package boundary being established.
- Read tools must not weaken the existing documentation-only official MCP boundary or imply official MCP executes seller operations.
- Freshness metadata must stay explicit; otherwise daily insights could present stale operational data as final guidance.

### Ready for Proposal
Yes — propose `mlc-read-tools-foundation` as a focused SDD change for concrete custom read tools over the existing MercadoLibre direct API client, with tests and small spec deltas. Tell the user this is the right next slice because it creates the missing bridge between the demo-safe MVP and future real seller data without taking on credentials, UI expansion, or write execution yet.
