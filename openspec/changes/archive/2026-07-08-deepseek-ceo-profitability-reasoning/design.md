# Design: DeepSeek CEO Profitability Reasoning

## Technical Approach

Replace the static `SIGNAL_TO_ACTION` lookup in `ceoProfitabilityHandler` with a batched DeepSeek Flash call per handler cycle. A new `CeoDeepSeekClient` factory wraps `OpenAI` pointed at DeepSeek's API, injects seller/campaign/item Cortex context via `queryByMetadata()`, sends all findings as a single JSON-structured prompt, validates the response against known `proposalType` values, records cost in the workforce ledger, and falls back to the existing static map immediately on error, timeout, or invalid output.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| Client shape | Factory function returning `{ reason(findings, cortex, ledger) }` | Class with DI constructor | Matches `createWorkforceCostCacheLedgerStore` pattern; handler imports directly (no injection framework) |
| Batching | One LLM call per handler cycle with all findings | Per-finding calls | 1 API call vs N — reduces cost and latency proportionally |
| Cortex query | `queryByMetadata({ sellerId, type: "profitability" })` per finding | `injectCortexContext` keyword search | Targeted metadata queries are deterministic; keyword search may miss structured data |
| Timeout | `AbortController` with 5s signal | `Promise.race` or no timeout | Standard pattern; `Promise.race` leaves hanging sockets |
| Model tier | Flash only (1st slice) | Flash + Pro fallback | Out of scope per proposal; Pro tier adds latency and cost without proven need |

## Data Flow

```
Handler receives findings[]
    │
    ▼
CeoDeepSeekClient.reason(findings, cortex, ledger)
    │
    ├── cortex.queryByMetadata() per finding → context map
    │
    ├── Build prompt: Block A (policy) + Block B (context) + findings JSON
    │
    ├── OpenAI.chat.completions.create({
    │       model: "deepseek-v4-flash",
    │       messages: [...],
    │       response_format: { type: "json_object" },
    │       timeout: 5000 }, { signal })
    │
    ├── Validate response → map<identity, proposalType>
    │
    ├── ledger.insertEntry() with token counts + department_id
    │
    └── Fallback on error/timeout/invalid → SIGNAL_TO_ACTION map
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/workers/ceoDeepSeekClient.ts` | Create | Factory returning `reason()` — Cortex enrichment, DeepSeek call, validation, ledger recording |
| `packages/agent/src/workers/ceoProfitabilityHandler.ts` | Modify | Destructure `cortex` from input; call `client.reason()` before `SIGNAL_TO_ACTION` fallback; all existing behavior (dedupe, Telegram, forum topics) preserved |

## Interfaces / Contracts

```ts
export type CeoDeepSeekClient = {
  reason(findings: CeoFinding[], cortex: GraphEngine, ledger: WorkforceCostCacheLedgerStore):
    Promise<Map<string, string>>; // identity → proposalType
};

export function createCeoDeepSeekClient(
  runtime?: DeepSeekRuntimeConfig,
): CeoDeepSeekClient | null; // null when DEEPSEEK_API_KEY unset — handler uses fallback
```

Known `proposalType` enum for validation:
```ts
const VALID_PROPOSAL_TYPES = new Set([
  "pause-campaign", "adjust-campaign-budget",
  "review-campaign-structure", "resume-campaign"
]);
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `reason()` — valid JSON parsed, invalid → fallback, timeout → fallback, missing API key → null factory | Vitest with `OpenAI` mocked via `vi.mock("openai")` |
| Unit | `ceoProfitabilityHandler` — delegates to client when available, falls back on `null` client | Hand-crafted `DaemonHandler` input with mocked `AgentMessageBusStore` |
| Integration | Cortex `queryByMetadata` returns expected nodes | Real `GraphEngine` with seeded in-memory SQLite |

## Migration / Rollout

No migration required. `DEEPSEEK_API_KEY` env controls behavior: unset → factory returns `null` → handler uses static map (zero behavior change). Set → LLM reasoning activates transparently. Rollback: unset env var or remove import.

## Open Questions

None — all decisions resolved in proposal review.
