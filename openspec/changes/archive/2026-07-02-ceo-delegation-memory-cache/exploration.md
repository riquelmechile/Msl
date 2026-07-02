# Exploration: CEO Delegation Memory Cache

## Answer First

Phase 1 should not create autonomous subagents or execute business mutations. The executable first slice should promote the Telegram agent into a CEO/Socio proposal layer that can inspect local evidence, draft delegation-style proposals, and persist evidence/audit metadata while keeping every action approval-only.

Cortex should remain the reasoning and business-memory layer. Add a separate operational read model/cache for complete MercadoLibre catalog and business snapshots because Cortex graph nodes are useful for learned context and relationships, but not ideal as the only indexed source for full catalog reads, pagination state, freshness windows, or cache invalidation.

DeepSeek efficiency should be improved by making the existing 3-block cache strategy real in the runtime: stable CEO/Socio system prompt, daily operational aggregates from the local read model, and per-query Cortex/evidence context. Do not rely on DeepSeek as durable memory.

## Findings

### Telegram bot and agent loop

- `packages/bot/src/index.ts` already wires grammY to `createAgentLoop()`, durable per-chat SQLite sessions, optional Cortex, optional MercadoLibre client, and a 6-hour background ingestion worker.
- The Telegram system prompt already uses `buildSystemPrompt(sellerName)` and defaults to a business assistant role, but not yet an explicit CEO/Socio delegation role.
- `sendProactiveMessage()` and `listActiveChats()` already exist, so Phase 1 can use Telegram for proposal delivery without adding a new notification channel.
- `packages/agent/src/conversation/agentLoop.ts` already centralizes guardrails, strategy CRUD, tool registration, autonomy level injection, proposal handling, and DeepSeek via the OpenAI SDK.

### Cortex and current memory model

- `packages/memory` provides SQLite-backed Cortex graph memory with nodes, edges, Hebbian learning, spreading activation, pruning, and Escribano observer support.
- `packages/agent/src/conversation/tools.ts` exposes `get_business_context`, which reads Cortex metadata for listings, visits, orders, seasonal signals, and cross-account comparisons.
- `packages/agent/src/conversation/backgroundIngestion.ts` currently writes operational snapshots into Cortex (`listing_snapshot`, `visit_snapshot`, `order_snapshot`, `quality_snapshot`, `relist_opportunity`, `seasonal_pattern`). This works for reasoning, but it mixes operational cache duties with graph-memory duties.

### Operational cache/read model need

- Existing `business-memory-cache` specs already require local-first memory, freshness by business risk, and fresh-enough read snapshots.
- `packages/domain/src/cacheFreshness.ts` has risk-based TTLs: critical signals 5 minutes, medium signals 1 hour, low historical summaries 1 day.
- Current background ingestion fetches listings and then item visits per listing every cycle. For a large catalog, this is expensive and should be replaced by an operational read model with per-entity freshness, pagination checkpoints, and selective refresh.
- A separate local SQLite read model should store full catalog, listing detail snapshots, visits, orders, claims, reputation, promotions/ads, quality, and refresh metadata. Cortex should receive distilled events, aggregates, and relationships derived from that read model.

### MercadoLibre client/read snapshot patterns

- `packages/mercadolibre/src/index.ts` already normalizes ML reads into `MlcReadSnapshot<T>` with source, freshness, completeness, confidence, seller scope, and MLC site support.
- The client already includes safe-read methods for listings, orders, messages, reputation, category data, Product Ads insights, fees/prices, visits, listing quality, moderation, notices, claims, shipping status, and prepare-only answer/image flows.
- `packages/mercadolibre/src/sync/syncStore.ts` already uses SQLite for sync state, but it is not a general business read model.

### DeepSeek/OpenAI usage and cache patterns

- `createDeepSeekClient()` uses `openai` with `baseURL: "https://api.deepseek.com"`.
- `packages/agent/src/conversation/cacheBlocks.ts` documents and implements a 3-block prefix-anchored prompt layout, but `agentLoop.ts` currently builds messages directly from `systemPrompt + history + userMessage`; it does not use `assembleMessages()` or `buildDailyAggregates()` in the main runtime.
- `cacheBlocks.ts` still contains placeholder daily aggregates. Phase 1 should wire real daily aggregates from the operational read model only after the read model exists.

## Recommended Architecture

```text
Telegram CEO/Socio
  -> Agent loop (guardrails, proposal-only delegation contract)
  -> Tools
     -> Operational read model/cache (full catalog + ML snapshots + freshness)
     -> Cortex (reasoning memory, learned preferences, relationships)
     -> Approval/proposal storage (no production mutation in Phase 1)
  -> DeepSeek prompt
     -> Block A: stable CEO/Socio identity + safety rules
     -> Block B: daily aggregate from operational cache
     -> Block C: per-query Cortex + evidence context
```

Use the operational read model as the source for complete, indexed business state. Use Cortex as the source for learned judgment, relationships, decision history, and reasoning context. The CEO/Socio agent should cite evidence IDs/snapshots from the read model and store distilled learning in Cortex after the user confirms, rejects, or corrects proposals.

## First-Slice Boundary

### Include in Phase 1

- CEO/Socio role prompt update for Telegram, keeping explicit approval and safety language.
- A `delegate_to_subagent`-style tool or equivalent proposal tool that records: intended delegate role, task scope, allowed actions, required evidence, risk, approval requirement, and `noMutationExecuted: true`.
- Evidence tracking for delegation proposals: which local snapshots/Cortex nodes/ML reads supported the recommendation.
- Proposal-only approval flow: seller can approve that the proposal is worth pursuing, but approval does not execute social posting, e-commerce scaffolding, ML writes, payments, or external publishing.
- Operational cache/read-model design and minimal implementation only if kept small: schema/contracts for listings, snapshot metadata, freshness, and ingestion checkpoints.
- Keep existing background ingestion safe-read behavior, but start moving full-catalog storage responsibility out of Cortex.

### Explicitly Exclude from Phase 1

- Social posting to Instagram, TikTok, Telegram channels, or Meta Graph APIs.
- E-commerce scaffolding (`apps/storefront`, Medusa, payments, Mercado Pago, Webpay).
- Production MercadoLibre mutations, listing sync execution, relist execution, customer messages, refunds, cancellations, answers, or image association.
- SII/tax integration and payment production mode.
- Independent autonomous subagents. Phase 1 may model delegation proposals, not run separate agents.

## Affected Areas

- `packages/bot/src/index.ts` — Telegram runtime, CEO/Socio prompt entry point, proactive messaging, session/Cortex/ML client wiring.
- `packages/agent/src/conversation/agentLoop.ts` — tool registration, approval-only proposal handling, autonomy/guardrails, DeepSeek message assembly.
- `packages/agent/src/conversation/systemPrompt.ts` — CEO/Socio identity and delegation safety contract.
- `packages/agent/src/conversation/tools.ts` — likely home for a delegation proposal tool and Cortex business-context reads.
- `packages/agent/src/conversation/backgroundIngestion.ts` — current ML-to-Cortex ingestion; should eventually publish to operational read model first.
- `packages/agent/src/conversation/cacheBlocks.ts` — existing DeepSeek prefix-cache pattern to wire once daily aggregates come from real local cache.
- `packages/domain/src/cacheFreshness.ts` and `packages/domain/src/readSnapshot.ts` — existing freshness and snapshot contracts to reuse for operational cache entries.
- `packages/domain/src/specializationEvidence.ts` — evidence model can track delegation readiness, but may need typed workflow names/scope.
- `packages/mercadolibre/src/index.ts` — current safe-read client and snapshot normalization patterns.
- `packages/memory/src/cortex/*` — keep as reasoning memory, not full catalog database.
- `openspec/specs/business-memory-cache/spec.md`, `conversational-business-agent/spec.md`, `multi-agent-orchestration/spec.md`, `action-approval-safety/spec.md` — existing contracts already support the recommended boundary.

## Risks and Constraints

- Data freshness: a local cache reduces API calls, but stale stock, claims, messages, and reputation can create bad recommendations. Use risk-based TTLs and disclose stale evidence.
- Duplicated source of truth: MercadoLibre remains the source of truth; the operational cache is a read model. Cortex stores learned context, not authoritative state.
- Cache invalidation: full catalog and per-item reads need checkpointing, TTLs, and selective refresh to avoid both stale recommendations and API overuse.
- Approval safety: natural-language “dale” must not accidentally execute Phase 2+ actions. Phase 1 approvals should approve planning/proposal state only.
- LLM cost: current cache-block code is not wired into the agent loop, and placeholder aggregates would waste tokens or mislead decisions if used as-is.
- Scope creep: the uploaded proposal includes social, e-commerce, payments, SII, and production automation; Phase 1 must preserve the vision while refusing those execution paths.

## Open Questions

- Should the operational read model live inside `@msl/agent`, a new package, or `@msl/memory` as a non-Cortex store?
- What is the first exact cache scope: listings only, or listings plus visits/orders/reputation?
- Should Phase 1 expose the delegation proposal through Telegram only, MCP only, or both?
- What wording should distinguish “approve the proposal for planning” from “execute a business mutation” in Spanish UX?

## Ready for Proposal

Yes. The proposal should define Phase 1 as a safe CEO/Socio planning and delegation-proposal slice with local evidence tracking and a clear architecture decision: keep Cortex for reasoning memory, add an operational read model/cache for full business snapshots, and keep all production mutations out of scope.
