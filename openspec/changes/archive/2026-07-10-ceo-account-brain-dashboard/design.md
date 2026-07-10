# Design: CEO Account Brain Dashboard

## Technical Approach

`AccountBrainService` aggregates 5 stores into per-account strategic views. Two read-only tools expose the service to the LLM via the agent loop. Additive change — no existing code modified except barrel exports and agent-loop tool registration.

```
                    ┌─────────────────────────┐
                    │  Agent Loop             │
                    │  config.accountBrainService
                    │       │                 │
                    │  toolMap.set(...)       │
                    ├───────┼─────────────────┤
        ┌───────────┘       │        └───────────────┐
        ▼                   ▼                        ▼
┌───────────────┐  ┌───────────────┐  tool.execute(args) → return JSON
│ get_account_  │  │ compare_      │
│ brain_status  │  │ account_assets│
└───────┬───────┘  └───────┬───────┘
        │                  │
        └──────┬───────────┘
               ▼
      AccountBrainService(sellerId → stores → result)
               │
    ┌──────────┼──────────┬──────────┬──────────┐
    ▼          ▼          ▼          ▼          ▼
AccountAsset  AgentWork  Workforce  CeoInbox  GraphEngine
   Store      Session    CostCache   Store    (Cortex)
              Store      Ledger
```

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Service vs inline tools | Separate `AccountBrainService` class, tools call it | Follows `AgentWorkSessionStore` pattern (store layer → tool layer). Keeps pure logic testable without tool wiring. |
| Tool registration path | `AgentLoopConfig.accountBrainService` | Matching existing pattern: `config.workforceCostCacheLedgerStore → register tool`. No new registration mechanism. |
| Store injection | Constructor injection, `sellerId` on every call | Follows `AgentWorkSessionStore` injection. `sellerId` is a method parameter, not constructor state — single service instance serves all accounts. |
| Scoring algorithm | Weighted multi-factor with goal-driven adjustment | Transparent, debuggable, no LLM dependency. Tradeoff: less nuanced than LLM scoring but deterministic and testable. |
| Two tools vs one | Separate `get_account_brain_status` and `compare_account_assets` | Different LLM use-cases: status-check vs decision-support. `compare` internally calls `getBrainStatus` for each candidate — DRY via service layer. |

## Component Design

### AccountBrainService

```typescript
class AccountBrainService {
  constructor(
    private accountAsset?: AccountAssetStore,
    private sessionStore?: AgentWorkSessionStore,
    private costLedger?: WorkforceCostCacheLedgerStore,
    private ceoInbox?: CeoInboxStore,
    private cortex?: GraphEngine,
  ) {}

  getAccountBrainStatus(sellerId: string, options?: BrainStatusOptions): AccountBrainStatus;
  compareAccountAssets(input: CompareInput): AccountAssetComparison;
}
```

Every method:
- Queries each store with explicit `sellerId`
- Catches store errors → `"unavailable"` per field
- Returns `noMutationExecuted: true`
- Never throws

### Tool Definitions

Both follow `agentWorkStatusTool.ts` pattern — factory functions returning `ToolDefinition`:

```typescript
export function createGetAccountBrainStatusTool(service?: AccountBrainService): ToolDefinition
export function createCompareAccountAssetsTool(service?: AccountBrainService): ToolDefinition
```

Undefined service returns `"unavailable"` response with `noMutationExecuted: true`.

## Scoring Algorithm (compareAccountAssets)

For each candidate account, compute weighted score (0..100):

| Factor | Weight (default) | Source |
|--------|------------------|--------|
| Capability match | 0.25 | BrainStatus.capabilities ∩ opportunity.requiredCapabilities |
| Health | 0.20 | BrainStatus.health (healthy=100, degraded=50, at-risk=25, critical=0) |
| Risk (inverted) | 0.20 | BrainStatus.risks severity count |
| Profit goal | 0.20 | BrainStatus.profitGoal relative to opportunity.marginTarget |
| Opportunity fit | 0.10 | BrainStatus.opportunities relevant to product |
| Cost load | 0.05 | BrainStatus.costAndCache.estimatedCostMicros (inverted) |

Goal-driven weight adjustment via lookup table; `maximize_profit` → profit×2.0 and opportunity×1.5.

Score differential <5 → confidence "low", recommendation `collect_more_evidence`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/accountBrainService.ts` | Create | Service class with `getAccountBrainStatus` and `compareAccountAssets` |
| `packages/agent/src/conversation/accountBrainService.test.ts` | Create | Unit tests for service: aggregation, isolation, degradation, scoring |
| `packages/agent/src/conversation/tools/accountBrainTools.ts` | Create | Two tool factory functions + input/output types |
| `packages/agent/src/conversation/tools/accountBrainTools.test.ts` | Create | Tool tests: seller isolation, missing store, noMutation executed |
| `packages/agent/src/conversation/tools/index.ts` | Modify | Add `export * from "./accountBrainTools.js"` |
| `packages/agent/src/index.ts` | Modify | Export `AccountBrainService` class + tool factories + types |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Add `accountBrainService` to config + conditional tool registration |

## Seller Isolation

- Every store query receives explicit `sellerId` from tool input
- `compareAccountAssets` queries each candidate independently via `getAccountBrainStatus(sellerId)`
- `AccountBrainService` methods accept `sellerId` as parameter — never as instance state
- Global Cortex nodes filtered via `queryByMetadata({ sellerId })` OR marked with `source: "global"`

## Error Handling

| Store missing | Behavior |
|---------------|----------|
| AccountAssetStore absent | `status: "missing_account_asset"` |
| Any store unavailable | Affected section returns `"unavailable"` |
| Account not found in store | `getAccountAsset(sellerId)` returns null → `missing_account_asset` |
| Store throws | Caught in try/catch → section `"unavailable"`, no crash |

## Testing Strategy

| Layer | What | Tool |
|-------|------|------|
| Service unit | Store aggregation, scoring, degradation, seller isolation | Vitest + in-memory SQLite |
| Tool unit | Tool.execute(), missing service, optional flags | Vitest |
| Integration | AgentLoop registers tools correctly | Vitest + in-memory DBs |
| ≥20 tests | Per proposal success criteria | Vitest |

Test files live alongside source (`accountBrainService.test.ts`, `tools/accountBrainTools.test.ts`) following `tools-agent-work-status.test.ts` pattern.
