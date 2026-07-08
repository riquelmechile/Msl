# Design: DeepSeekReasoningGateway

Gateway wrapping `getDeepSeekClient()` singleton. Standardizes model selection, prompt cache blocks, cost recording, timeouts, and fallback for all internal-agent DeepSeek calls.

## Quick Path

1. Create `packages/agent/src/reasoning/` with gateway + types + model router + cost estimator
2. Refactor `CeoDeepSeekClientImpl.reason()` to build `ReasoningCall` and delegate to gateway
3. Refactor `SupplierMirrorDeepSeekAdvisor.analyze()` to delegate; consolidate pricing upstream
4. Export barrel from `packages/agent/src/reasoning/index.ts`

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Gateway wraps `OpenAI` singleton | Constructor receives `getDeepSeekClient()` result | Preserves single TCP connection; no new client instantiation |
| Gateway never throws | Returns `status: "fallback"` on all errors | Callers already handle fallback path; crashing breaks daemons |
| Autonomy gate for auto-execute | Gateway calls `AutonomyEngine.canAutoApprove()` per level | Reuses existing engine; no new permission system |
| Single `insertEntry()` path | All cost recording through `WorkforceCostCacheLedgerStore` | Eliminates double-counting; single audit trail |
| 3-block prompt cache | `stablePrefix` + `cacheableContext` + `volatileInput` concatenated | Matches existing `cacheBlocks` pattern; prefix reuse for Flash/Pro |

## File Structure

```
packages/agent/src/reasoning/
├── DeepSeekReasoningGateway.ts   — reason(), selectModel(), buildPrompt(), validateOutput(), recordCost()
├── reasoningTypes.ts             — ReasoningCall, ReasoningResult, CostTelemetry
├── reasoningLevels.ts            — ReasoningLevel enum, timeout map, auto-execute set
├── modelRouter.ts                — selectModel(level, forcePro) → "deepseek-v4-flash" | "deepseek-v4-pro"
├── costEstimator.ts              — estimateCost(model, tokens) → CostTelemetry
└── index.ts                      — barrel exports
```

## DeepSeekReasoningGateway Interface

```typescript
class DeepSeekReasoningGateway {
  constructor(
    client: OpenAI,
    ledger: WorkforceCostCacheLedgerStore,
    autonomy: AutonomyEngine,
  );

  reason(call: ReasoningCall): Promise<ReasoningResult>;
}
```

### ReasoningCall

```typescript
type ReasoningCall = {
  laneId: string;
  level: ReasoningLevel;
  stablePrefix: string;          // immutable — cached
  cacheableContext?: string;     // slow-changing — cached
  volatileInput: string;         // per-call — uncached
  expectedSchema?: Record<string, unknown>;
  forcePro?: boolean;
  timeoutMs?: number;            // override level default
  departmentId: string;          // cost attribution
  agentId: string;               // ledger agentId
};
```

### ReasoningResult (per spec)

```typescript
type ReasoningResult = {
  status: "success" | "fallback";
  summary: string;
  confidence: number;            // 0–1
  recommendations: unknown[];
  modelUsed: string;
  costTelemetry: CostTelemetry;
  requiresApproval: boolean;
  rawResponse?: string;
};

type CostTelemetry = {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  estimatedCostMicros: number;
};
```

## Model Selection

`modelRouter.selectModel(level, forcePro)` — decision table:

| Level | forcePro=false | forcePro=true |
|-------|---------------|---------------|
| classification, summarization, prioritization | `deepseek-v4-flash` | `deepseek-v4-pro` |
| recommendation, decision | `deepseek-v4-pro` | `deepseek-v4-pro` |

Flash for low-risk volume calls; Pro for high-stakes reasoning. Exported so `SupplierMirrorDeepSeekPolicy` can reference models from one place.

## Prompt Cache Strategy

3-block concatenation in `buildPrompt()`:

```
[System: stablePrefix]        ← cache_control block (never changes per lane)
[System: cacheableContext]    ← cache_control block (changes daily/weekly)
[User: volatileInput]         ← uncached (changes per call)
```

Both system blocks use DeepSeek `cache_control` markers. Flash and Pro both support prefix caching — same strategy for both models.

## Timeout Strategy

Per-level `AbortController` timeouts (spec-defined):

| Levels | Timeout |
|--------|---------|
| classification, summarization, prioritization | 5s |
| recommendation | 15s |
| decision | 30s |

`callerId`-provided `timeoutMs` overrides level default. Timeout → `status: "fallback"`.

## Autonomy Gate Integration

After successful `reason()`:
- Low-risk levels (`classification`, `summarization`, `prioritization`): call `autonomyGate.canAutoApprove()` → sets `requiresApproval`
- If blocked → `requiresApproval: true` with Spanish reason in `summary`
- `recommendation` and `decision` → always `requiresApproval: true`

## Error Handling

All errors caught and mapped to `status: "fallback"`:

| Error | Behavior |
|-------|----------|
| Network / API error | Fallback, empty recommendations |
| Timeout | AbortController fires, fallback |
| Invalid JSON response | Fallback |
| Schema mismatch (when `expectedSchema` provided) | Fallback |
| API key missing | Callers check at construction; gateway assumes valid client |

## Refactor Plan

### CeoDeepSeekClient
- **Moves to gateway**: OpenAI call, AbortController timeout, cost ledger `insertEntry`, JSON parse
- **Stays in client**: Cortex enrichment (`cortex.queryByMetadata()`), `POLICY_BLOCK` constant, `proposalType` enum validation, `SIGNAL_TO_ACTION` fallback map, factory `createCeoDeepSeekClient()`
- **New**: Client builds `ReasoningCall` with `level: recommendation`, delegates `reason()`, validates returned `proposalType`

### SupplierMirrorDeepSeekAdvisor
- **Moves to gateway**: OpenAI call, model selection, cost estimation, JSON parse
- **Stays in advisor**: `SupplierMirrorStore` evidence gathering, Spanish system prompt assembly, `SupplierMirrorAnalysis` type mapping
- **Consolidated into gateway**: `SUPPLIER_MIRROR_DEEPSEEK_PRICING` tables, `selectSupplierMirrorDeepSeekModel()` logic
- **Stays in policy**: `buildSupplierMirrorDeepSeekPromptPlan()`

## Data Flow

```
Caller → ReasoningCall
  → Gateway.selectModel(level, forcePro)
  → Gateway.buildPrompt(stable, cacheable, volatile)
  → OpenAI.chat.completions.create({ model, messages, response_format })
  → Gateway.validateOutput(raw, expectedSchema?)
  → Gateway.recordCost(usage, laneId, departmentId)
  → Gateway.checkAutonomy(level) → requiresApproval
  → ReasoningResult
```

## Exports (index.ts)

Add to `packages/agent/src/index.ts`:
```typescript
export { DeepSeekReasoningGateway } from "./reasoning/DeepSeekReasoningGateway.js";
export { ReasoningLevel } from "./reasoning/reasoningLevels.js";
export type { ReasoningCall, ReasoningResult, CostTelemetry } from "./reasoning/reasoningTypes.js";
```

## Deliberate Omissions

- No vision/multimodal support (out of scope)
- No per-agent model override config — `forcePro` flag is the only escape hatch
- Gateway is NOT a generic brain plugin system — it is DeepSeek-specific
- AgentLoop refactoring not in this change
