## Exploration: MercadoLibre API capabilities refresh

### Current State
MSL is a hexagonal TypeScript monorepo where `@msl/domain` owns pure business types, `@msl/mercadolibre` owns OAuth-backed direct MercadoLibre API access, `@msl/tools` owns safe business tool boundaries, and `@msl/mcp` exposes a project-owned MCP server. The official Mercado Libre MCP is documentation lookup only and must not be treated as a seller-operation executor.

Current MercadoLibre coverage is real but narrow: OAuth token storage/refresh with encrypted persistence and role validation; MLC read snapshots for listings, orders, messages, and reputation; direct client methods for items, orders, questions, categories, user info, publish item, and update item; Plasticov-to-Maustian product sync; prepared write proposals; and MCP read/prepare tools. Execution safety is stronger than capability breadth: write execution is intentionally not exposed by default, `sync_product` remains stubbed at MCP level, and production chat remains demo-bound.

Compared with the current MercadoLibre documentation snapshot, the project covers authentication, basic listings/categories, basic orders/messages/reputation, and product sync foundations. It does not yet cover important API areas such as category attributes/technical specs validation, pictures, variations, catalog-required listings, listing quality, shipping options/shipments, questions answer workflows, messaging thread operations, metrics/visits, billing reports, complaints, promotions/coupons/discounts, official store, or seller validation beyond configured seller IDs.

### Affected Areas
- `packages/mercadolibre/src/index.ts` — central direct API client, read snapshot normalizers, OAuth read client, legacy full client, transport, and current endpoint map.
- `packages/mercadolibre/src/types.ts` — current MercadoLibre DTOs are minimal and do not model many documented resources such as attributes, pictures, variations, shipping, metrics, promotions, or listing quality.
- `packages/mercadolibre/src/oauth/oauthManager.ts` and `packages/mercadolibre/src/oauth/tokenStore.ts` — OAuth flow is central to any expanded private-resource access and must preserve header-based bearer tokens, refresh-token rotation, and encrypted storage.
- `packages/mercadolibre/src/accountRoles.ts` — enforces allowed Plasticov/Maustian seller roles and MLC-only assumptions; new capabilities must keep this seller boundary explicit.
- `packages/tools/src/index.ts` — project-owned safe tool layer currently supports docs lookup, read tools, prepared writes, approval, execution, and audit; new capabilities should appear here as scoped reads or prepared actions, not as raw API execution.
- `packages/mcp/src/index.ts` and `packages/mcp/src/runtimeDependencies.ts` — MCP exposes authorized read tools and prepare-only writes; any new MCP surface must preserve API-key checks, OAuth-backed direct API reads, and no mutation execution by default.
- `packages/workers/src/index.ts` — workers currently contain stubs for order, claim, cancellation, stock, reputation, and message refreshes; documented shipping, metrics, complaints, and listing-quality signals likely belong behind worker/cache refresh boundaries.
- `openspec/specs/ml-api-integration/spec.md` — current spec names OAuth, write operations, product sync, and MCP tool surface but is narrower than current documented MercadoLibre capability areas.
- `openspec/specs/custom-business-mcp-tools/spec.md` — already records the critical documentation-only official MCP boundary and safe custom tool surface.
- `openspec/specs/action-approval-safety/spec.md` — approval, risk, and audit rules remain the governing boundary for every write/public-facing capability.

### Approaches
1. **Capability inventory and read-first expansion** — Add specs/design for a documented capability matrix, then implement only safe read/validation snapshots first: attributes/technical specs, listing quality, shipping options/status, questions received, metrics/visits, and richer reputation.
   - Pros: preserves safety; quickly improves business intelligence; creates a durable source-of-truth matrix; avoids accidental mutation exposure.
   - Cons: does not immediately execute high-value actions such as answering questions or promotions; requires careful DTO/normalizer growth.
   - Effort: Medium

2. **Operation-by-operation prepared action expansion** — Prioritize high-value write workflows such as answer questions, update listing content/price/stock, manage pictures, shipping dimensions, promotions, and catalog-required fixes as prepared actions behind approval/audit.
   - Pros: closer to revenue impact; aligns with the user's "correct and improve" intent; uses existing approval infrastructure.
   - Cons: higher platform/TOS and business risk; more API-specific edge cases; likely exceeds the review budget if done as one slice.
   - Effort: High

3. **Documentation adapter only** — Keep application capabilities unchanged and only add a maintained internal documentation/capability map powered by official MCP lookup.
   - Pros: very safe; low implementation risk; useful for future planning.
   - Cons: does not improve runtime business capability; duplicates value already available from official docs unless tied to actionable gaps.
   - Effort: Low

### Recommendation
Proceed with Approach 1 first, with Approach 2 split into later approval-gated slices. The first proposal should establish a MercadoLibre API capability matrix and read/validation foundations, not mutations. This keeps the official MCP as documentation-only, strengthens project-owned direct API boundaries, and gives the agent better evidence before it proposes risky actions.

Likely first slices:
1. Capability matrix + specs that classify each documented area as `docs-only`, `safe-read`, `prepare-only`, or `future-execute-with-approval`.
2. Read/validation endpoints for listing quality, category attributes/technical specs, pictures metadata, shipping options/status, metrics/visits, and richer reputation.
3. Question/message workflows as read-first snapshots, then `answer-question` as a prepared action only.
4. Listing improvement proposals for catalog/quality/attributes/pictures/variations as prepared actions, with no direct MCP execution.
5. Promotions, discounts, billing, complaints, and advanced reporting as separate high-risk slices after the evidence model is stable.

### Risks
- Treating the official Mercado Libre MCP as an executor would violate the established architecture; it is documentation lookup only.
- Expanding writes too early could expose seller-affecting mutations without sufficient approval, audit, rollback, or TOS review.
- MercadoLibre docs span multiple sites and some examples use MLA/MLB; MSL must keep MLC-specific assumptions explicit and verify site support per endpoint.
- Existing client code has overlapping `MlcApiClient` and `MlClient` surfaces; broad expansion without consolidation could increase confusion.
- Some documented capabilities return partial, sensitive, or policy-constrained data; snapshots need explicit freshness, confidence, and blocked-state metadata.
- A full capability refresh will exceed the 400-line review budget unless planned as chained PR slices.

### Ready for Proposal
Yes — tell the user the safe next step is a proposal for a read-first MercadoLibre capability refresh that maps the current API documentation into project-owned safe capabilities, keeps official MCP documentation-only, and defers all mutations to explicit prepared-action slices with approval and audit.
