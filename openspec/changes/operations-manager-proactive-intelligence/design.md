# Design: AI Reasoning for Operations Manager Signals

## Technical Approach

Mirror the `SupplierMirrorDeepSeekAdvisor` pattern: a lazy-gateway advisor class that enriches rule-detected claims + reputation signals via `DeepSeekReasoningGateway` at `ReasoningLevel.Classification`. The advisor is an optional dependency of the operations daemon — when absent or failing, rule-only proposals still fire. The redundant `unansweredQuestionsWatcher` standalone daemon is removed; question detection remains in `operationsManagerDaemon`.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pattern | Replicate `SupplierMirrorDeepSeekAdvisor` exactly | Same lazy gateway init, same telemetry shape, zero new abstractions |
| Advisor scope | Claims (critical) + reputation (warning) only | Delayed-order and unanswered-question detection stay rule-only per proposal scope |
| `unansweredQuestionsWatcher` removal | Remove standalone daemon + lane entry | Detection already exists in `operationsManagerDaemon` (lines 187–208); the watcher was redundant |
| aiEnrichment shape | Same payload shape as supplier-manager | Proven, consumed by CEO without new parsing paths |
| Fallback strategy | try/catch per signal, log, skip | Rule-only baseline always delivered; advisor is best-effort |

## Data Flow

```
operationsManagerDaemon
  │
  ├─ 1. ReadModel → allClaims[], reputationSnapshot
  │
  ├─ 2. advisor?.analyze({ openClaims, reputationSnapshot, unansweredQuestions, sellerIds, cortex })
  │         │
  │         └─ Gateway.reason() → parsed findings
  │
  ├─ 3. Merge aiEnrichment into proposal payload (critical + warning groups)
  │
  └─ 4. bus.enqueue() → CEO proposals
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/operationsDeepSeekAdvisor.ts` | **Create** | Advisor class + types, ~130 loc, mirrors supplier pattern |
| `packages/agent/src/workers/daemonTypes.ts` | Modify | Add `operationsAdvisor?: OperationsDeepSeekAdvisor` to `DaemonHandler` input |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Add `operationsAdvisor` to config + handler call; remove `unansweredQuestionsWatcher` import + lane entry |
| `packages/agent/src/workers/operationsManagerDaemon.ts` | Modify | Call `advisor.analyze()` before enqueue; append `aiEnrichment` to payload |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Instantiate `OperationsDeepSeekAdvisor` when `workforceCostCacheLedgerStore` is present |
| `packages/agent/src/index.ts` | Modify | Export `OperationsDeepSeekAdvisor` and its types |
| `packages/agent/src/workers/unansweredQuestionsWatcher.ts` | **Delete** | Logic unified; redundant with operations-manager |

## Interfaces / Contracts

```typescript
// ── NEW: operationsDeepSeekAdvisor.ts ──

export type OperationsAnalysisInput = {
  openClaims: Array<{ claimId: string; reason: string; sellerId: string; itemId: string }>;
  reputationSnapshot: { score: number; color: string };
  unansweredQuestions: Array<{ questionId: string; text: string; sellerId: string; hoursUnanswered: number }>;
  sellerIds: string[];
  cortex: GraphEngine;
};

export type OperationsAnalysis = {
  findings: Array<{ kind: "claim-risk" | "reputation-trend" | "priority-action";
                     severity: "info" | "warning" | "critical";
                     summary: string; detail: string; evidenceIds: string[] }>;
  summary: string;
  modelUsed: string;
  costMicros: number;
  cacheHitTokens: number; cacheMissTokens: number; outputTokens: number;
};

export class OperationsDeepSeekAdvisor {
  constructor(openai: OpenAI, ledger?: WorkforceCostCacheLedgerStore)
  async analyze(input: OperationsAnalysisInput): Promise<OperationsAnalysis>
}
```

Daemon proposal payload gains optional `aiEnrichment` (same shape as supplier-manager):
```typescript
aiEnrichment?: {
  findings: OperationsAnalysisFinding[];
  summary: string;
  modelUsed: string;
  enrichedAt: string;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `OperationsAnalysisInput` → prompt construction | Verify stablePrefix + volatileInput formatting |
| Unit | JSON parse + fallback path | Invalid JSON returns empty findings, no throw |
| Integration | Daemon with advisor injected | Mock gateway; assert `aiEnrichment` in payload |
| Integration | Daemon without advisor | Rule-only proposals still enqueue |
| E2E | Gateway unavailable | Advisor throws → logged, proposal still enqueued |

## Migration / Rollout

No data migration. The `unansweredQuestionsWatcher` removal requires removing the `"unanswered-questions"` entry from `daemonHandlerMap` — the laneId stays in the type union for backward compat with any bus messages already enqueued. The `aiEnrichment` field is optional; consumers ignore it when absent.

## Open Questions

- [ ] Should the `LaneId` type union remove `"unanswered-questions"` or keep it for backward compat?
- [ ] Should advisor also analyze `unansweredQuestions` context (gathered by daemon) even though those findings are rule-only?
