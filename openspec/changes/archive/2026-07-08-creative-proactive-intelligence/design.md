# Design: Creative Proactive Intelligence

## Technical Approach

Create a `CreativeDeepSeekAdvisor` class following the exact pattern of `CatalogDeepSeekAdvisor` and `OperationsDeepSeekAdvisor`: lazy `DeepSeekReasoningGateway` initialization, Spanish system prompt, structured JSON output, cost telemetry, and isolated try/catch. Wire it through `daemonTypes.ts`, `daemonScheduler.ts`, `agentLoop.ts`, and `index.ts` using the same hybrid pattern as supplier/operations/market-catalog advisors.

Each creative daemon calls `creativeAdvisor.analyze()` with its actionable (critical + warning) findings and attaches the returned enrichment to the CEO proposal payload. Enrichment failure never blocks the daemon cycle.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Advisor granularity | Single `CreativeDeepSeekAdvisor` covering both daemons | Separate advisors per daemon | Both daemons deal with creative signals; one advisor reduces duplication and DeepSeek gateway instances |
| Enriched signals | Only critical + warning | Enrich all signals (including info) | Keeps AI cost proportional to risk; info signals are opportunities, not risks |
| Enrichment attachment | `aiEnrichment` field in proposal payload, same as operations/supplier | Separate proposal bus message | Follows established pattern; CEO already handles `aiEnrichment` in proposals |
| Gateway reuse | Lazy singleton per advisor instance | Shared global gateway | Matches all existing advisors; avoids gateway lifecycle issues |

## Data Flow

```text
creativeAssetsDaemon
  └─ rule-based detection (all 5 signals)
  └─ if advisor present AND (critical + warning findings exist)
       └─ creativeAdvisor.analyze({ daemonKind: "creative-assets", findings })
       └─ attach aiEnrichment to proposal payload
  └─ enqueue CEO proposal

creativeCommercialDaemon
  └─ rule-based detection (all 3 signals)
  └─ if advisor present AND (warning findings exist)
       └─ creativeAdvisor.analyze({ daemonKind: "creative-commercial", findings })
       └─ attach aiEnrichment to proposal payload
  └─ enqueue CEO proposal
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/agent/src/conversation/creativeDeepSeekAdvisor.ts` | New | Advisor class with `CreativeEnrichmentInput` → `CreativeEnrichmentOutput` |
| `packages/agent/src/workers/daemonTypes.ts` | Modify | Add `creativeAdvisor?: CreativeDeepSeekAdvisor` to `DaemonHandler` input |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Import `CreativeDeepSeekAdvisor`, add to config, pass to handlers |
| `packages/agent/src/workers/creativeAssetsDaemon.ts` | Modify | Call advisor for critical + warning findings, attach enrichment |
| `packages/agent/src/workers/creativeCommercialDaemon.ts` | Modify | Call advisor for warning findings, attach enrichment |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Create advisor instance, return from `createAgentLoop()` |
| `packages/agent/src/index.ts` | Modify | Export `CreativeDeepSeekAdvisor` class and types |

## Interfaces / Contracts

```ts
// Input to CreativeDeepSeekAdvisor
type CreativeEnrichmentInput = {
  daemonKind: "creative-assets" | "creative-commercial";
  actionableFindings: Array<{
    itemId: string;
    title?: string;
    signalKind: string;
    severity: "warning" | "critical";
    pictureCount?: number;
    visits?: number;
    avgVisits?: number;
    orders?: number;
    conversionRate?: number;
  }>;
};

// Output from CreativeDeepSeekAdvisor
type CreativeEnrichmentOutput = {
  findings: Array<{
    kind: "creative-quality" | "conversion-risk" | "campaign-risk" | "priority-action";
    severity: "info" | "warning" | "critical";
    summary: string;
    detail: string;
    evidenceIds: string[];
  }>;
  summary: string;
  modelUsed: string;
  costMicros: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
};
```

Enrichment payload in proposal:
```ts
{
  type: "proposal",
  summary: "...",
  findings: [...],
  recommendedAction: "...",
  capturedAt: "...",
  noMutationExecuted: true,
  aiEnrichment?: {
    findings: CreativeEnrichmentOutput["findings"],
    summary: string,
    modelUsed: string,
    enrichedAt: string,
  }
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Advisor parses DeepSeek response into enrichment output | Mock gateway, verify parse behavior |
| Unit | Assets daemon attaches enrichment when advisor present | Verify proposal payload includes `aiEnrichment` |
| Unit | Commercial daemon attaches enrichment only for warning | Verify info-only proposals have no enrichment |
| Unit | Advisor failure does not propagate | Inject throw, verify rule-only fallback |
| Integration | Advisor wired through scheduler config | Verify `creativeAdvisor` passes through to handlers |

## Migration / Rollout

No schema migration required. The `creativeAdvisor` is optional (`undefined` by default) — existing deployments continue with rule-only proposals. After deploy, advisor instances are created when `openai` client and ledger are available.

## Open Questions

- [ ] None.
