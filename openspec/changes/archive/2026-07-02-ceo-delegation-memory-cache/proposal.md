# Proposal: CEO Delegation Memory Cache

## Intent

Build the CEO/Socio around DeepSeek V4's cheap cached-input economics: a CEO lane coordinates cache-resident specialist lanes with stable prompts, local evidence, and proposal-only safety.

## Problem

The previous slice treated DeepSeek caching as generic savings. The real architecture is specialist lanes with large, stable, mostly immutable prompt prefixes that stay hot, reason frequently, and refine recommendations cheaply. Cortex must remain durable Darwinian learning; the operational DB/read model remains the authoritative local source for full catalog/business snapshots. DeepSeek cache is not memory.

## Goals / Non-goals

**Goals**: CEO-coordinated specialist lanes; measured cache hit/miss per lane; local read-model evidence; Cortex reinforcement/pruning; Telegram-first approval language.

**Non-goals**: production mutations, MercadoLibre writes, publishing, payments, SII/tax, customer messaging, autonomous execution, or treating DeepSeek cache as durable state.

## Proposed First Slice

- Define CEO lane plus three specialist lane contracts: Cost/Supplier, Market/Catalog, Creative/Commercial.
- Wire lane-specific stable prompt prefixes and record `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` per lane.
- Allow frequent/near-continuous safe reasoning that produces proposals only.
- Store evidence IDs, lane outputs, approvals, rejections, and outcome feedback.

## Cache-Resident Specialist Lane Architecture

| Lane | Stable cache prefix | Output |
|------|---------------------|--------|
| CEO/Socio | safety, delegation policy, business strategy | coordinated proposal |
| Cost/Supplier | costs, suppliers, margins, constraints | viability and missing inputs |
| Market/Catalog | catalog, stock, rotation, competition | opportunity ranking |
| Creative/Commercial | sales angles, campaigns, channels | campaign/proposal drafts |

## Cache Isolation Strategy and Benchmark Requirement

The implementation MUST NOT assume DeepSeek cache isolation. If isolation is API-key based, support one API key per lane. If account/user based, support one account/user per lane. Benchmark each lane independently using `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`; keep prefixes stable only when hit rates prove the cache is hot.

## User Flow Examples

- CEO detects slow stock; after `dale`, specialists investigate locally and return margin, market, and campaign proposals with evidence.
- If costs/supplier constraints are missing, the Cost/Supplier lane asks before any profitability claim.
- Creative lane can draft a campaign, but `dale` only advances preparation, not publication.

## Data/Memory Architecture Decision

Operational DB/read model is authoritative for catalog/business snapshots and freshness. Cortex stores durable learned judgment: confirmed useful outcomes reinforce behavior; rejected or weak proposals are de-emphasized/pruned. DeepSeek cache only makes repeated specialist reasoning cheap.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `conversational-business-agent`: CEO lane and specialist-lane UX.
- `business-memory-cache`: authoritative local read model plus freshness.
- `multi-agent-orchestration`: cache-resident specialist lane coordination.
- `action-approval-safety`: `dale` approves bounded preparation only.
- `neural-graph-memory`: Cortex outcome reinforcement/pruning.

## Safety/Approval Semantics

Phase 1 `dale` approves bounded investigation, preparation, and proposal advancement only. It MUST NOT publish, mutate MercadoLibre, charge payments, interact with SII, message customers, or execute external effects.

## Success Criteria

- [ ] Each lane reports cache hit/miss tokens and evidence-backed output.
- [ ] CEO combines specialist outputs into one bounded proposal.
- [ ] Operational read model and Cortex responsibilities stay separate.
- [ ] Rejections and confirmations alter Cortex learning, not DeepSeek cache.
- [ ] No Phase 1 approval can trigger production mutation.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cache isolation differs by provider scope | Med | Benchmark API-key/account/user strategies per lane |
| Hot prefixes become stale | Med | Keep immutable role policy separate from refreshed local evidence |
| `dale` implies execution | High | Hard no-mutation guardrails and audit flags |
| Overbuilding autonomous agents | Med | Proposal-only lane contracts in Phase 1 |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/*` | Modified | CEO prompt, lane prompts, cache metrics, proposals |
| `packages/bot/src/index.ts` | Modified | Telegram CEO/Socio flow |
| `packages/domain/src/cacheFreshness.ts` | Modified | Snapshot freshness semantics |
| `packages/memory/src/cortex/*` | Modified | Outcome reinforcement/pruning |

## Rollback Plan

Disable specialist-lane routing and cache metrics, revert to the existing single Telegram agent path, and keep read-model/Cortex data intact.

## Dependencies

- DeepSeek V4 cache telemetry, Telegram bot, local SQLite/read model, Cortex, MercadoLibre safe-read client.

## Next Recommended Phase

Run `sdd-spec`, then `sdd-design`, focused on lane contracts, cache-isolation benchmarking, approval wording, and read-model/Cortex boundaries.
