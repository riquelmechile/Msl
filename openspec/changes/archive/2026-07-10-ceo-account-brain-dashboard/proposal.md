# Proposal: CEO Account Brain Dashboard

## Intent

The CEO currently sees agent activity via `get_agent_work_status`, but lacks strategic account state per asset — health, risks, opportunities, costs, and pending approvals. No tool exists to compare Plasticov vs Maustian for product placement and profit decisions, forcing manual cross-reference across 5 stores.

## Scope

### In Scope
- `AccountBrainService` aggregating 5 existing stores into per-account strategic status
- `get_account_brain_status` tool: health, risks, opportunities, active agents, costs, pending approvals, recent learnings per seller
- `compare_account_assets` tool: side-by-side Plasticov vs Maustian with recommendation (but not execution)
- Two input types: `AccountBrainStatusInput`, `CompareAccountAssetsInput`
- Two output types: `AccountBrainStatus`, `AccountAssetComparison` — with confidence levels and evidence
- Per-seller isolation guaranteed: never mix Plasticov/Maustian data
- Graceful degradation: unavailable stores return `"unavailable"`, not errors

### Out of Scope
- No UI, no dashboard, no multi-bot
- No ML mutations, no DeepSeek calls (purely store aggregation)
- No product publishing, pricing, or answer-to-ML flows
- No "Dale" approval — these tools are read-only
- No HTTP, no secrets, no VPS

## Capabilities

### New Capabilities
- `account-brain-status`: Per-account strategic dashboard — aggregates AccountAssetStore (health, risks, goals), AgentWorkSessionStore (today's sessions, lessons), WorkforceCostCacheLedgerStore (costs, tokens, cache efficiency), CeoInboxStore (pending approvals), and Cortex (neural presence). Returns `AccountBrainStatus` with `noMutationExecuted: true` and confidence levels.
- `account-asset-comparison`: Side-by-side Plasticov vs Maustian — compares profit goals, health, risk levels, active agents, operational costs, pending actions per asset. Returns `AccountAssetComparison` with recommendation (which account suits a product or needs attention), always scoped per seller.

### Modified Capabilities
- `conversational-business-agent`: Register `get_account_brain_status` and `compare_account_assets` as internal read-only workforce tools in the agent loop tool list alongside existing `get_agent_work_status`.

## Approach

Additive only — no breaking changes. `AccountBrainService` injects existing store instances during construction. Each method queries stores with explicit `sellerId`, returns structured results with `source` attribution and confidence. Tools follow existing `ToolDefinition` pattern (see `agentWorkStatusTool.ts`). Store unavailability handled at service level — returns `"unavailable"` per field, never throws.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/accountBrainService.ts` | New | Service aggregating 5 stores |
| `packages/agent/src/conversation/tools/accountBrainTools.ts` | New | Two tool definitions |
| `packages/agent/src/conversation/tools/index.ts` | Modified | Export new barrel |
| `packages/agent/src/index.ts` | Modified | Export new service + tools |
| `packages/agent/src/conversation/agentLoop.ts` | Modified | Register 2 new tools |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cross-account data leak | Low | `sellerId` filter on every store query; test isolation explicitly |
| Store unavailable causes crash | Low | Every store access wrapped; returns `"unavailable"` |
| Confusion with `get_agent_work_status` | Low | Different scope documented: strategic (this) vs agent-activity (existing) |

## Rollback Plan

1. Comment out tool registration in agent loop — tools become unavailable, no other code affected
2. Service is additive — no existing tool or store modified

## Dependencies

- `AccountAssetStore` (exists — `getAccountAsset`, `compareAccounts`, `getRisks`, `getOpportunities`)
- `AgentWorkSessionStore` (exists — `summarizeShift`, `listRecentSessionsByAgent`)
- `WorkforceCostCacheLedgerStore` (exists — `aggregateCostByAgentAndSeller`, `aggregateCacheEfficiencyBySeller`)
- `CeoInboxStore` (exists — `getBySellerId`)
- `GraphEngine` / Cortex (exists — `traverse`, seller-scoped nodes)

## Success Criteria

- [ ] `get_account_brain_status("plasticov")` returns health, risks, agents, costs, approvals — zero Maustian data
- [ ] `compare_account_assets()` returns both accounts side-by-side with recommendation
- [ ] Missing store returns `"unavailable"` per field, never throws
- [ ] Missing account returns `missing_account_asset` status
- [ ] All outputs include `noMutationExecuted: true`
- [ ] ≥20 test cases: store aggregation, isolation, degradation, missing account, empty data
