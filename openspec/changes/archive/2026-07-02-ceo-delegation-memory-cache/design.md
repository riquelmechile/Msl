# Design: CEO Delegation Memory Cache

## Technical Approach

Implement Phase 1 as a Telegram-first CEO/Socio layer that coordinates cache-resident specialist lanes and only returns evidence-backed proposals. DeepSeek caching is measured cost optimization: each lane gets a stable token-0 prefix plus refreshable local context. The first slice wires contracts, telemetry, evidence, and no-mutation approvals.

## Architecture Decisions

| Decision | Choice | Tradeoff / rationale |
|---|---|---|
| Lane model | Model CEO/Socio plus Cost/Supplier, Market/Catalog, and Creative/Commercial as lane contracts in `@msl/agent`, not autonomous workers. | Keeps Phase 1 reviewable and proposal-only while preserving the future delegation shape. |
| Durable data boundary | Add an operational SQLite read model separate from `packages/memory/src/cortex/*`. | Current ingestion stores snapshots in Cortex; full catalog, pagination, freshness, and evidence IDs need indexed operational tables. Cortex remains learned judgment. |
| DeepSeek cache | Use stable identical prefixes from token 0 per lane; keep volatile snapshots outside prefixes. | Accepts cache misses when policy changes, avoids stale business facts in immutable prompts. |
| Isolation | Configure lane credentials/accounts abstractly and benchmark API-key/account/user isolation. | Provider cache isolation must not be hardcoded; optimize only after telemetry proves hit rates. |
| Approval | In Phase 1, `dale` advances investigation/preparation/proposal state only. | Existing flow can imply execution; this change blocks mutations and records `noMutationExecuted: true`. |

## Data Flow

```text
Telegram -> agentLoop CEO lane -> lane router
  -> Operational read model -> evidence IDs/freshness
  -> Cortex -> learned preferences/patterns
  -> DeepSeek lane prompt: stable prefix + refreshable context
  -> CEO combined Spanish proposal -> approval/audit + Cortex feedback
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Register lane router, use cache-block assembly, capture lane telemetry, and enforce no-mutation confirmations. |
| `packages/agent/src/conversation/cacheBlocks.ts` | Modify | Replace placeholder daily aggregates with lane prompt assembly helpers and token-0 stable prefix hygiene. |
| `packages/agent/src/conversation/tools.ts` | Modify | Add `delegate_to_subagent` / lane proposal tool and local-first evidence reads. |
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modify | Write snapshots to operational read model first, then distilled Cortex events. |
| `packages/bot/src/index.ts` | Modify | Configure CEO/Socio prompt, lane credentials/accounts, and safe Telegram approval wording. |
| `packages/domain/src/cacheFreshness.ts` | Modify | Extend signal/freshness metadata for operational snapshots and evidence IDs. |
| `packages/memory/src/cortex/*` | Modify | Add feedback/outcome reinforcement helpers; keep Cortex out of full catalog storage. |
| `packages/agent/tests/conversation/*` | Modify/Create | Unit/integration tests for lane contracts, cache telemetry, approvals, and read-model boundaries. |

## Interfaces / Contracts

| Contract | Fields |
|---|---|
| `LaneContract` | `laneId`, `stablePrefix`, `refreshableContextProvider`, `inputs`, `outputs`, `boundaries`, `requiredEvidenceKinds`, `credentialScope` |
| `LaneOutput` | `laneId`, `recommendation`, `missingInputs`, `risks`, `evidenceIds`, `freshness`, `cacheTelemetry`, `boundaryWarnings` |
| `CacheTelemetry` | `provider`, `model`, `laneId`, `promptCacheHitTokens`, `promptCacheMissTokens`, `credentialRef`, `measuredAt` |
| `OperationalEvidence` | `evidenceId`, `snapshotKind`, `sellerId`, `entityId`, `capturedAt`, `freshnessStatus`, `completeness`, `source` |
| `DelegationApproval` | `proposalId`, `approvedScope`, `allowedActions`, `noMutationExecuted`, `evidenceIds`, `userText` |

Boundaries: Cost/Supplier asks for missing cost/supplier/margin before profitability; Market/Catalog ranks catalog/stock/competition opportunities; Creative/Commercial drafts only; CEO synthesizes and asks when scope expands.

## DeepSeek Cache Strategy

- Stable prefix starts at token 0 and contains only identity, safety, lane boundaries, and durable policy.
- Refreshable context contains local snapshots, costs, outcomes, Cortex lessons, and evidence IDs.
- Record `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` when available; degrade without memory assumptions when absent.
- Benchmark lane isolation with configured credential/account variants before optimizing prefixes or credential layout.

## Cortex and Operational Read Model

The operational DB stores full snapshots, freshness metadata, checkpoints, and evidence IDs. Cortex stores approvals, rejections, corrections, patterns, and measured outcomes that reinforce, weaken, or prune reasoning edges. Background ingestion publishes to the read model first and feeds Cortex distilled lessons/events.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Lane contracts, cache assembly, telemetry, freshness/evidence IDs, no-mutation guard | Vitest package tests. |
| Integration | Telegram `dale`, lane routing, local-first fallback, Cortex feedback | Existing agent/bot tests. |
| E2E | Seller approves investigation and receives combined proposal with evidence/no-mutation statement | Playwright only where supported by project runner. |

## Migration / Rollout

Create operational read-model schema behind opt-in config; dual-write ingestion to read model and Cortex distilled nodes; route only proposal-safe lane calls; then enable cache telemetry dashboards/logs. Roll back by disabling lane routing and returning to the existing single agent path.

## First Implementation Slice

Slice 1: define lane contracts/types, cache telemetry extraction, delegation proposal tool, and Phase 1 `dale` no-mutation guard with tests. Exclude full read-model ingestion.

## Open Questions

- [ ] Exact package location for the operational read model: `@msl/agent`, `@msl/memory`, or a new package.
- [ ] Exact first persisted snapshot scope: listings only, or listings plus visits/orders/reputation.
