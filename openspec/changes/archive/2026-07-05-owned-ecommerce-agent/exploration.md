# Exploration: Owned Ecommerce Agent

### Current State
MSL is a TypeScript hexagonal monorepo where `@msl/domain` stays pure, adapters live in channel packages, `@msl/agent` coordinates CEO-facing conversation and internal specialist lanes, `@msl/workers` performs background/readiness work, and `apps/web` is currently a Next.js demo console rather than a production storefront. The current company model already names Expansion Manager → Owned Ecommerce Specialist in `docs/agent-enterprise-vision.md`, but the implemented static lanes are still `ceo`, `cost-supplier`, `market-catalog`, and `creative-commercial`.

MercadoLibre integration already provides rich product, pricing, visits, ads, reputation, category, image, claims, and question evidence. Supplier Mirror already provides local-first supplier evidence, Jinpeng readiness, target policies, ledger records, and safe CEO-gated runtime rules. The operational read model stores seller-scoped snapshots in SQLite, and Cortex can provide learned relationship/decision context. Existing write actions are approval-gated, but there is no owned ecommerce domain, storefront catalog, ecommerce adapter, or web publish proposal model yet.

### Affected Areas
- `packages/domain/src/` — add pure owned ecommerce concepts: ecommerce candidate, catalog projection, channel product, merchandise/SEO proposal, publication readiness, adapter-neutral change plan, and risk/safety decisions.
- `packages/agent/src/conversation/lanes.ts` — extend the workforce model toward Expansion/Owned Ecommerce without exposing worker selection to Telegram; likely add `expansion-ecommerce` or durable CEO-created agent support with stable cache prefix.
- `packages/agent/src/conversation/companyAgents.ts` — department model currently only supports `executive | operations | commercial`; Expansion needs either a new department id or a durable agent profile mapped carefully without breaking existing static lanes.
- `packages/agent/src/conversation/tools.ts` — add proposal-only tools to request ecommerce evidence, rank ecommerce candidates, draft ecommerce content, and prepare ecommerce channel plans without public mutations.
- `packages/workers/src/` — add an owned ecommerce readiness/proposal worker that can run deterministic filters first, call DeepSeek only for ambiguous merchandising/content choices, and ledger outcomes.
- `packages/memory/src/operationalReadModel.ts` — likely extend snapshot kinds or add ecommerce-specific read models for channel candidate snapshots, readiness reports, storefront projections, and adapter publish state.
- `packages/mercadolibre/src/` — source candidate evidence from Plasticov and Maustian without treating either as the whole business boundary; preserve seller-lane provenance and freshness.
- `packages/memory/src/supplierMirrorStore.ts` and `packages/mercadolibre/src/supplierSource.ts` — reuse Supplier Mirror/Jinpeng evidence as candidate inputs, not as automatic publication authority.
- `packages/mcp/src/index.ts` — expose read/proposal tools for owned ecommerce readiness when external MCP clients need safe visibility.
- `apps/web/` — remains the current Next.js app, but should not become the storefront mutation engine in the first slice; future storefront UI can consume a generated projection.
- `openspec/specs/multi-agent-orchestration/spec.md` — future spec work should align Owned Ecommerce Specialist with CEO-only Telegram, evidence requests, stable prefixes, and proposal-only outputs.

### Approaches
1. **Medusa-first implementation** — Build a Medusa v2 commerce backend early, then make MSL sync selected products into Medusa products/variants.
   - Pros: strong TypeScript/headless fit, product/variant/workflow model, separates admin/storefront concerns, good long-term fit for agent-maintained commerce.
   - Cons: adds a new runtime/database/admin surface before MSL has ecommerce readiness evidence; risks making platform plumbing the first deliverable instead of CEO-gated business learning.
   - Effort: High

2. **WooCommerce-first implementation** — Use WordPress/WooCommerce REST APIs as the first owned ecommerce surface.
   - Pros: fastest conventional store/plugin route, mature checkout ecosystem, simple product REST API integration.
   - Cons: PHP/WordPress-centric, weaker fit with the current TypeScript agent architecture, higher long-term impedance for workflow/cost ledger/agent ownership.
   - Effort: Medium

3. **Adapter-first ecommerce abstraction** — Add an internal `OwnedEcommerceChannel`/`StorefrontAdapter` contract and implement a readiness/proposal pipeline first; Medusa becomes the preferred first concrete adapter after proposals are safe.
   - Pros: preserves hexagonal architecture, lets MSL rank/prepare candidates before choosing a live backend, keeps WooCommerce possible but not foundational, aligns with CEO-led proposal-only safety, and supports future channels.
   - Cons: more upfront modeling discipline; does not immediately launch a storefront; requires explicit later adapter implementation.
   - Effort: Medium

### Recommendation
Use the adapter-first abstraction as the first slice, with Medusa as the preferred first concrete ecommerce adapter once readiness and proposal flows are proven. WooCommerce should remain a possible adapter for a fast external shop, but it should not define MSL's domain model because MSL's product boundary is the CEO-led agent enterprise, not a CMS plugin.

The safe first implementation should be proposal-only/readiness-first:

1. Define pure domain models for ecommerce candidates, readiness, projection, content proposals, adapter capabilities, and approval-gated channel plans.
2. Build a deterministic candidate collector that merges evidence from Plasticov, Maustian, Supplier Mirror/Jinpeng, future supplier adapters, the operational read model, and Cortex.
3. Rank candidates with deterministic hard filters first: stock authority, margin floor, freshness, source confidence, category eligibility, duplicate content risk, moderation/safety blocks, and CEO policy.
4. Use DeepSeek only after deterministic filtering for non-deterministic reasoning: product selection tie-breaks, merchandising angles, SEO/GEO copy variants, category narrative, internal rationale, and missing-evidence explanations.
5. Generate a CEO-facing readiness/proposal report with evidence IDs, freshness, source provenance, proposed storefront representation, blocked items, and missing inputs. No public storefront mutation in slice one.

DeepSeek usage should follow current cache economics: stable Owned Ecommerce Specialist prefix, volatile product/cost/stock/SEO evidence in small Block C payloads, cheap deterministic paths before LLM, V4 Flash for routine classification/copy drafts, V4 Pro only for hard policy conflicts, and cost/cache ledger entries without raw prompts, responses, secrets, or full product payload dumps.

Candidate sourcing should be explicit and provenance-preserving:

- MercadoLibre Plasticov and Maustian: active/paused listings, sales/visits/orders, questions, ads, reputation, listing quality, category specs, images, price-to-win, promotion eligibility, and moderation/notices where available.
- Supplier Mirror/Jinpeng: supplier item snapshots, stock observations, target policies, price/stock changes, mappings, ledger reasons, readiness blocks, and enrichment records; ML stock remains authority when defined.
- Future suppliers: plug in via supplier source adapters that return normalized evidence with freshness/confidence and no mutation authority by default.
- Operational read model: local seller-scoped snapshots are the first read path; stale or missing critical evidence must produce warnings or block final readiness.
- Cortex: decision history, CEO corrections, approved/rejected product patterns, learned channel lessons, and outcome constellations used as context, not as hard policy override.

Likely new concepts/adapters/workers/tools:

- Domain: `OwnedEcommerceCandidate`, `EcommerceChannelProjection`, `StorefrontAdapterCapability`, `StorefrontChangePlan`, `MerchandisingProposal`, `SeoGeoContentDraft`, `DuplicateChannelContentRisk`, `EcommerceReadinessReport`.
- Adapter contract: `StorefrontAdapter` with `readCatalog`, `previewProductUpsert`, `previewContentChange`, and later `applyApprovedChange`; initial implementation can be in-memory/dry-run, followed by `@msl/ecommerce-medusa` or equivalent.
- Worker: `ownedEcommerce/readinessWorker` to collect, filter, rank, draft, and ledger proposal-only reports.
- Agent lane/tooling: `Owned Ecommerce Specialist` under Expansion Manager, with tools like `collect_ecommerce_candidates`, `prepare_ecommerce_readiness_report`, `draft_storefront_product_content`, and `prepare_storefront_change_plan`.
- Memory/read model: ecommerce candidate/projection snapshots and publication-readiness ledger records.

### Risks
- SEO/GEO copy may overclaim stock, origin, warranty, delivery time, certification, or supplier relationship unless deterministic claim guards require evidence-backed assertions.
- Inventory/pricing drift between MercadoLibre accounts, suppliers, and owned ecommerce can create oversell or margin loss; publication readiness must block stale/low-confidence stock and cost evidence.
- Duplicated channel content can harm SEO and blur channel strategy; content proposals need duplicate/near-duplicate risk scoring and channel-specific positioning.
- Security/secrets risk increases with ecommerce backend credentials, payment keys, and webhooks; all adapters must fail closed and redact secrets in reports/ledger.
- CEO approval boundaries can erode if readiness reports become implicit publishing; first slice must produce proposals only, with later mutations behind explicit approval and audit.
- Storefront performance can suffer if agent-generated content is fetched dynamically; public storefront should consume precomputed/static projections, not run agent reasoning on customer requests.
- Medusa adoption too early can distract from agent-owned readiness; WooCommerce adoption too early can lock MSL into WordPress/PHP assumptions.

### Ready for Proposal
Yes — propose an adapter-first, proposal-only Owned Ecommerce Agent slice. The orchestrator should tell the user that Medusa is the likely long-term first concrete backend, WooCommerce remains an adapter option, and the immediate change should focus on domain contracts, candidate sourcing, DeepSeek-safe ranking/content drafts, and CEO-gated readiness reports with no public mutations.
