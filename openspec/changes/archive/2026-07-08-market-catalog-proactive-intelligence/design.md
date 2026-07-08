# Design: AI Enrichment for Market Catalog Signals

## Technical Approach

Mirror the `SupplierMirrorDeepSeekAdvisor` + `OperationsDeepSeekAdvisor` pattern: a lazy-gateway advisor class that enriches rule-detected catalog signals via `DeepSeekReasoningGateway` at `ReasoningLevel.Classification` (~$0.01/call, Flash model). The advisor is an optional dependency of the market catalog daemon — when absent or failing, rule-only proposals still fire.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pattern | Replicate `OperationsDeepSeekAdvisor` exactly | Same lazy gateway init, same telemetry output, zero new abstractions |
| Advisor scope | low-visit + above-market + relist-expiring | These are the 3 actionable signal types; paused-with-history is purely informational |
| aiEnrichment shape | Same payload shape as supplier-manager + operations-manager | Proven, consumed by CEO without new parsing paths |
| Fallback strategy | try/catch before enqueue, log, skip | Rule-only baseline always delivered; advisor is best-effort |
| Call granularity | One advisor call per severity tier (critical, warning) | Matches existing enqueueGroup pattern; keeps API calls bounded |

## Data Flow

```
marketCatalogDaemon
  │
  ├─ 1. reader/cortex → allListings[], visitsPerItem, categoryMedians
  │
  ├─ 2. Detect signals (low-visit, above-market, relist-expiring, paused-with-history)
  │
  ├─ 3a. If critical findings: catalogAdvisor?.analyze({ actionableFindings }) → aiEnrichment
  ├─ 3b. If warning findings: catalogAdvisor?.analyze({ actionableFindings }) → aiEnrichment
  │
  ├─ 4. enqueueGroup(criticals, ...) with aiEnrichment in payload
  ├─ 5. enqueueGroup(warnings, ...) with aiEnrichment in payload
  └─ 6. enqueueGroup(infos, ...) — no aiEnrichment
```

## CatalogDeepSeekAdvisor Class Design

```typescript
// ── Input/output types ──

export type CatalogActionableFinding = {
  itemId: string;
  sellerId: string;
  title: string;
  price: number;
  status: string;
  visits: number;
  categoryId: string;
  categoryMedian?: number;
  signalKind: "low-visit" | "above-market" | "relist-expiring";
  severity: "warning" | "critical";
};

export type CatalogAnalysisInput = {
  actionableFindings: CatalogActionableFinding[];
  question?: string;
};

export type CatalogAnalysisFinding = {
  kind: "visibility-risk" | "pricing-strategy" | "relist-priority" | "catalog-insight";
  severity: "info" | "warning" | "critical";
  summary: string;
  detail: string;
  evidenceIds: string[];
};

export type CatalogAnalysis = {
  findings: CatalogAnalysisFinding[];
  summary: string;
  modelUsed: string;
  costMicros: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
};

// ── Class ──

export class CatalogDeepSeekAdvisor {
  private gateway: DeepSeekReasoningGateway | null = null;
  private openai: OpenAI;
  private ledger: WorkforceCostCacheLedgerStore | undefined;
  private sellerIds: string[];

  constructor(input: {
    openai: OpenAI;
    sellerIds: string[];
    ledger?: WorkforceCostCacheLedgerStore;
  })

  private getGateway(): DeepSeekReasoningGateway  // lazy init

  async analyze(input: CatalogAnalysisInput): Promise<CatalogAnalysis>
  // → Builds stablePrefix (Spanish system prompt, catalog analyst role)
  // → Builds volatileInput (listings, visits, medians, signal context)
  // → Calls gateway.reason({ laneId: "market-catalog", level: Classification, ... })
  // → Parses JSON, returns typed CatalogAnalysis
  // → On parse failure: returns empty findings + error summary
}
```

## Integration Points

| Step | File | Change |
|------|------|--------|
| 1 | `daemonTypes.ts` | Import `CatalogDeepSeekAdvisor` type; add `catalogAdvisor?: CatalogDeepSeekAdvisor` to `DaemonHandler` input |
| 2 | `daemonScheduler.ts` | Add `catalogAdvisor` to `DaemonSchedulerConfig`; pass `config.catalogAdvisor` in handler call |
| 3 | `agentLoop.ts` | Instantiate `CatalogDeepSeekAdvisor` alongside `operationsDeepSeekAdvisor` (same guard: `openai && config.workforceCostCacheLedgerStore`) |
| 4 | `marketCatalogDaemon.ts` | Destructure `catalogAdvisor`; before `enqueueGroup()`, call `catalogAdvisor.analyze()` for critical + warning groups |
| 5 | `index.ts` | Export `CatalogDeepSeekAdvisor` + types |
| 6 | `catalogDeepSeekAdvisor.ts` | **Create** — advisor class + types, ~140 loc |

## File Changes Summary

| File | Action | Est. LOC |
|------|--------|----------|
| `conversation/catalogDeepSeekAdvisor.ts` | Create | 140 |
| `workers/daemonTypes.ts` | Modify | +3 |
| `workers/daemonScheduler.ts` | Modify | +4 |
| `workers/marketCatalogDaemon.ts` | Modify | +35 |
| `conversation/agentLoop.ts` | Modify | +8 |
| `index.ts` | Modify | +3 |
| **Total** | | **~193** |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `CatalogAnalysisInput` → prompt construction | Verify stablePrefix + volatileInput formatting |
| Unit | JSON parse + fallback path | Invalid JSON returns empty findings, no throw |
| Integration | Daemon with advisor injected | Mock gateway; assert `aiEnrichment` in critical + warning payloads |
| Integration | Daemon without advisor | Rule-only proposals still enqueue; info proposals have no enrichment |
| E2E | Gateway unavailable | Advisor throws → logged, proposal still enqueued |

## Migration / Rollout

No data migration. `aiEnrichment` is optional; consumers ignore it when absent. Rollback: remove `catalogAdvisor` from `DaemonSchedulerConfig` + handler call (2 lines). Daemon reverts to rule-only.

## Open Questions

- None — pattern is proven across 2 prior advisors; no unresolved design decisions.
