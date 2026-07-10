# CEO Account Brain Dashboard

## Purpose

`AccountBrainService` gives the CEO a per-account strategic dashboard by aggregating five existing stores into structured `AccountBrainStatus` reports. Two LLM-facing tools (`get_account_brain_status` and `compare_account_assets`) expose the service through the agent loop without mutations.

## Architecture

```
                  CEO Agent Loop
                  config.accountBrainService
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
 get_account_     compare_       (toolMap
 brain_status     account_       conditional
                  assets         registration)
        │              │
        └──────┬───────┘
               ▼
      AccountBrainService(sellerId → stores → result)
               │
   ┌───────────┼───────────┬───────────┬───────────┐
   ▼           ▼           ▼           ▼           ▼
AccountAsset  AgentWork  Workforce  CeoInbox   GraphEngine
  Store      Session    CostCache   Store      (Cortex)
             Store      Ledger
```

## Design

**`AccountBrainService`** (packages/agent/src/conversation/accountBrainService.ts):

- Constructor receives 5 optional stores via dependency injection
- `getAccountBrainStatus(sellerId, options?)` aggregates per-account data
- `compareAccountAssets(input)` ranks candidates with weighted scoring
- Every method: queries stores with explicit `sellerId`, catches errors gracefully, returns `noMutationExecuted: true`, never throws

**Tool factories** (packages/agent/src/conversation/tools/accountBrainTools.ts):

- `createGetAccountBrainStatusTool(service?)` → `ToolDefinition`
- `createCompareAccountAssetsTool(service?)` → `ToolDefinition`
- Undefined service → `"unavailable"` response with `noMutationExecuted: true`
- Both tools registered conditionally in `agentLoop.ts` via `config.accountBrainService &&`

## Stores Used

| Store                           | What it provides                                                                                  | Seller filter                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `AccountAssetStore`             | Account metadata, health history, capabilities, risks, opportunities, profit goal, strategy notes | `sellerId` on every call                           |
| `AgentWorkSessionStore`         | Today's agent sessions, observation counts, lesson summaries                                      | `sellerId` per shift                               |
| `WorkforceCostCacheLedgerStore` | Per-agent cost aggregation, cache efficiency                                                      | `sellerId` on `aggregateCostByAgentAndSeller`      |
| `CeoInboxStore`                 | Pending/routed approval proposals                                                                 | `sellerId` on `getBySellerId`                      |
| `GraphEngine` (Cortex)          | Memory nodes: seller-scoped + global                                                              | `getNodesBySeller` + `queryByMetadata` for globals |

## Scoring Algorithm (compareAccountAssets)

Weighted multi-factor scoring (default weights) per candidate:

| Factor           | Weight | Source                                           |
| ---------------- | ------ | ------------------------------------------------ |
| Capability match | 0.25   | Active vs total capabilities ratio               |
| Health           | 0.20   | healthy=100, degraded=50, at-risk=25, critical=0 |
| Risk (inverted)  | 0.20   | Severity-weighted risk count, inverted           |
| Profit goal      | 0.20   | ProfitGoal.value (capped at 100)                 |
| Opportunity fit  | 0.10   | Average confidence of detected opportunities     |
| Cost load        | 0.05   | Inverted cost: `100 - totalCost/10000`           |

### Goal-driven weight adjustment

| Goal              | Adjustment                  |
| ----------------- | --------------------------- |
| `maximize_profit` | profit×2.0, opportunity×1.5 |
| `reduce_risk`     | risk×2.0                    |
| `grow_reputation` | health×2.0                  |
| `clear_stock`     | health×1.5                  |
| `test_market`     | capabilityMatch×1.5         |

Score delta <5 → confidence `low`, recommendation `collect_more_evidence`.

## Confidence Calculation

**For status**: `high` when all primary stores are available; `medium` when ≥1 store is unavailable; `low` when both health and capabilities are unavailable.

**For comparison**: `high` when first/second delta ≥15; `medium` when 5 ≤ delta < 15; `low` when delta <5 or only one candidate or data incomplete.

## Recommended Focus

Generated from the most actionable signals:

1. Critical/at-risk health status
2. Critical risks with mitigation notes (top 3)
3. High-confidence opportunities (≥70%, top 3)
4. Fallback: "No critical items — account operating normally."

## Seller Isolation

- Every store query receives explicit `sellerId` from the tool input
- `compareAccountAssets` calls `getAccountBrainStatus` per candidate — each call is isolated
- `AccountBrainService` accepts `sellerId` as a parameter, never as instance state
- Global Cortex nodes are filtered to those without `sellerId` metadata and marked `source: "global"`
- Strategy notes include both account-specific (`sellerId === seller`) and global (`sellerId === undefined`) entries

## noMutationExecuted

Every response — from both the service and the tools — includes `noMutationExecuted: true`. This is a structural guarantee enforced by the `AccountBrainStatus` and `AccountAssetComparison` return types. The tools:

- Make zero HTTP calls
- Make zero DeepSeek/LLM calls
- Make zero MercadoLibre API calls
- Query only local in-memory stores

## How it Differs from `get_agent_work_status`

|                    | `get_agent_work_status`                     | `get_account_brain_status`                                                               |
| ------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Scope**          | Agent work sessions only (per-seller shift) | Full strategic view: health, capabilities, risks, opportunities, strategy, costs, cortex |
| **Stores**         | 1 (AgentWorkSessionStore)                   | 5 (AccountAsset, AgentWorkSession, WorkforceCostCacheLedger, CeoInbox, Cortex)           |
| **Comparison**     | None                                        | `compare_account_assets` for side-by-side ranking                                        |
| **Confidence**     | Not reported                                | Per-response confidence (high/medium/low)                                                |
| **Goal weighting** | None                                        | 5 goal profiles with weight adjustment                                                   |

## Example Responses

### get_account_brain_status

```json
{
  "sellerId": "plasticov",
  "status": "active",
  "health": { "currentStatus": "healthy", "reputation": "green", "marginProfile": 35 },
  "capabilities": [{ "kind": "Fulfillment", "status": "active", "health": "healthy" }],
  "profitGoal": { "value": 35 },
  "risks": [],
  "agentActivity": { "sessionsToday": 3, "status": "active", "agentIds": ["ops.1"], "lessons": 2 },
  "pendingApprovals": [{ "proposalId": "prop-42", "riskLevel": "low", "status": "pending" }],
  "costAndCache": { "totalEstimatedCostMicros": 1250, "cacheEfficiency": 0.85 },
  "cortex": { "nodeCount": 12, "hasAccountNode": true },
  "recommendedFocus": ["No critical items — account operating normally."],
  "confidence": "high",
  "noMutationExecuted": true
}
```

### compare_account_assets

```json
{
  "recommendedSellerId": "plasticov",
  "confidence": "high",
  "ranking": [
    {
      "sellerId": "plasticov",
      "score": 85,
      "strengths": ["Healthy account", "1/1 active capacities"]
    },
    { "sellerId": "maustian", "score": 62, "missingCapabilities": ["Fulfillment"], "strengths": [] }
  ],
  "decisionLogic": "Clear winner with delta 23.0. Weighted factors: capabilityMatch=0.25...",
  "suggestedNextAction": {
    "kind": "recommend_account",
    "description": "Recommend \"plasticov\" for this product/opportunity.",
    "requiresApproval": true
  },
  "noMutationExecuted": true
}
```
