# Design: Cost Supplier Proactive Intelligence

## Technical Approach

Create `CostSupplierDeepSeekAdvisor` mirroring the `CatalogDeepSeekAdvisor` / `OperationsDeepSeekAdvisor` pattern: a class with a constructor accepting `openai`, `sellerIds`, and optional `ledger`, and an `analyze()` async method. Wire it through the existing dependency injection chain so `createAgentLoop` instantiates it and `startDaemonScheduler` passes it to the daemon handler.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|-----------|
| Advisor file | `costSupplierDeepSeekAdvisor.ts` | Inline in daemon | Consistent with existing advisor-separate pattern |
| Handler field name | `costSupplierAdvisor` | Reuse `advisor` field | The `advisor` generic field is used by supplier-manager; use explicit name like `catalogAdvisor`/`operationsAdvisor` |
| Enrichment scope | critical + warning only | All findings | Info-only (restock) signals don't need LLM reasoning; saves cost |
| departmentId | `"cost-supplier"` | `"inventory"` | Matches laneId naming pattern |

## Data Flow

```
createAgentLoop()
  └── new CostSupplierDeepSeekAdvisor({openai, sellerIds, ledger})
  └── return { ..., costSupplierDeepSeekAdvisor }

startDaemonScheduler(config)
  └── handler({
        ...,
        costSupplierAdvisor: config.costSupplierAdvisor,
      })

costSupplierDaemon()
  └── rule-based margin/cost/restock signals
  └── IF costSupplierAdvisor && has critical/warning findings:
        └── analysis = await costSupplierAdvisor.analyze(actionableFindings)
        └── payload.aiEnrichment = analysis
  └── enqueue CEO proposal with or without enrichment
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/costSupplierDeepSeekAdvisor.ts` | Create | Advisor class + types |
| `packages/agent/src/workers/daemonTypes.ts` | Modify | Import + add costSupplierAdvisor to DaemonHandler |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Import + add to config + pass to handler |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Import + instantiate + return advisor |
| `packages/agent/src/workers/costSupplierDaemon.ts` | Modify | Receive advisor + enrichment block |
| `packages/agent/src/index.ts` | Modify | Export class + types |

## Interfaces / Contracts

```typescript
// Input: actionable findings from costSupplierDaemon rules
type CostSupplierActionableFinding = {
  itemId: string;
  title?: string;
  signalKind: "low-margin" | "critical-margin" | "below-cost" | "restock-opportunity";
  severity: "info" | "warning" | "critical";
  price: number;
  cost: number;
  margin: number;
  stock?: number;
  visits?: number;
};

// Output: enriched analysis from DeepSeek
type CostSupplierEnrichmentFinding = {
  kind: "margin-risk" | "cost-anomaly" | "pricing-opportunity" | "priority-action";
  severity: "info" | "warning" | "critical";
  summary: string;
  detail: string;
  evidenceIds: string[];
};

type CostSupplierEnrichment = {
  findings: CostSupplierEnrichmentFinding[];
  summary: string;
  modelUsed: string;
  costMicros: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
};
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Advisor input parsing and output shaping | Mock gateway, verify JSON parse/error handling |
| Integration | daemon wiring through scheduler | Verify advisor reaches handler |
| Existing | costSupplierDaemon rule logic | No regression in existing tests |

## Migration / Rollout

No migration required. The new advisor is optional — when absent, costSupplierDaemon behaves exactly as before.
