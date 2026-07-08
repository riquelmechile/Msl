## Exploration: DeepSeek CEO Profitability Reasoning

### Current State

**CEO Profitability Handler** (`packages/agent/src/workers/ceoProfitabilityHandler.ts`) currently uses a **hardcoded lookup map** (`SIGNAL_TO_ACTION`) that deterministically maps 5 CFO-level signal strings to fixed Product Ads action types:

| Signal | Maps To | Severity | Requires Approval |
|--------|---------|----------|-------------------|
| `margin-consuming` | `pause-campaign` | critical | yes |
| `scale-candidate` | `adjust-campaign-budget` | opportunity | yes |
| `budget-waste` | `review-campaign-structure` | warning | yes |
| `underinvested` | `adjust-campaign-budget` | info | yes |
| `unit-economics` | `review-campaign-structure` | info | no |

The handler runs as a **daemon** (not an agent loop with an LLM). It claims messages from the agent message bus, parses findings from `productAdsProfitabilityDaemon`, does a 7-day deduplication check, maps the signal to a fixed action via the lookup table, sends a Telegram notification, and optionally calls `prepareProductAdsAction` to enqueue a formal proposal for seller approval.

The handler receives `cortex: GraphEngine` (the Cortex business memory) and `bus: AgentMessageBusStore` in its context, but **uses neither** — Cortex is unused, and the bus is only used for dedup queries. It has zero DeepSeek integration and zero cost ledger awareness.

**Existing DeepSeek Infrastructure** — the project already has:

1. **Full DeepSeek OpenAI-compatible client** in `packages/domain/src/deepseekRuntime.ts` — config (base URL `https://api.deepseek.com`, model `deepseek-v4-flash`, env vars `DEEPSEEK_API_KEY/BASE_URL/MODEL`). The `buildDeepSeekChatCompletionRequest()` wrapper adds per-user tracking via `extra_body.user_id`.

2. **Agent loop DeepSeek integration** in `packages/agent/src/conversation/agentLoop.ts` — `createDeepSeekClient()` creates an OpenAI SDK client pointed at DeepSeek, `createRealClient()` wraps it as an `LlmClient`. The agent loop uses DeepSeek as the default LLM, records usage in the cost ledger, and uses the 3-block prefix cache strategy for cost optimization.

3. **Dual-table cost ledger** in `packages/agent/src/conversation/workforceCostCacheLedgerStore.ts` — `workforce_cost_cache_ledger_entries` table (individual LLM call records) + `workforce_cost_cache_ledger_rollups` table (daily per-agent/per-model aggregations). Tracks: provider, model, operation, prompt cache tokens (hit/miss), input/output tokens, estimated cost in micros. The agent loop automatically records every LLM call via `recordLlmUsage()`.

4. **DeepSeek pricing data** already hardcoded in two places (`supplierMirrorDeepSeekPolicy.ts`, `ownedEcommerce/index.ts`): Flash ($0.028/$1.40/$2.80 per M tokens for cache hit/miss/output) and Pro ($0.03625/$4.35/$8.70).

5. **Prefix caching strategy** via `cacheBlocks.ts` — Block A (stable system prompt) + Block B (daily aggregates) form a token-0 anchored prefix that achieves >90% cache hit rates. Cortex context is injected as Block C in the user message.

6. **Cortex GraphEngine** (`packages/memory/src/cortex/engine.ts`) — `better-sqlite3` backed graph database with spreading activation, Hebbian learning, `queryByMetadata()` for listing/cost snapshot queries, Darwinian pruning. Every daemon already receives a `cortex` instance. Daemons use `cortex.queryByMetadata()` to fetch listing snapshots, cost data, visit data.

### What the LLM-Powered Replacement Would Look Like

Instead of a static `SIGNAL_TO_ACTION` map, the handler would:

1. **Enrich findings with Cortex context** — query Cortex for historical profitability data, cost snapshots, and past action outcomes for this seller/campaign/item
2. **Call DeepSeek with a structured prompt** — include the finding signals, metrics, Cortex context, and a system prompt asking for a recommended action with reasoning
3. **Parse the LLM response** — extract proposed proposalType, severity, rationale, and confidence
4. **Record the call in the cost ledger** — charging the DeepSeek API cost to the appropriate lane
5. **Fall back to deterministic mapping** when the LLM is unavailable or returns invalid output

### Affected Areas

- `packages/agent/src/workers/ceoProfitabilityHandler.ts` — the main file to be modified: replace `SIGNAL_TO_ACTION` with DeepSeek-powered reasoning
- `packages/agent/src/workers/daemonTypes.ts` — may need to extend `CeoHandlerContext` (or `DaemonHandler` input) with an LLM client and ledger reference
- `packages/agent/src/workers/daemonScheduler.ts` — may need to pass the new context (LLM client, ledger) when invoking the CEO handler
- `packages/agent/src/conversation/agentLoop.ts` — consider extracting `createDeepSeekClient()` and `createRealClient()` into a shareable utility so daemons can reuse them without depending on the full agent loop
- `packages/agent/src/conversation/workforceCostCacheLedgerStore.ts` — already exists; may need a `recordEntry()` convenience for daemon-side use
- `packages/agent/src/conversation/lanes.ts` — the `product-ads-ceo-profitability` lane contract may need updating if the new handler requires different context or capabilities
- `packages/memory/src/cortex/engine.ts` — may need additional query patterns if the LLM reasoning requires historical action outcome context (e.g., "what happened last time we paused this campaign")
- `packages/domain/src/deepseekRuntime.ts` — if resolving the DeepSeek routing config for daemon context requires different routing input

### Approaches

1. **Inject LLMClient into daemon context** — Extend the `DaemonHandler` input type (or `CeoHandlerContext`) to optionally include an `llmClient: LlmClient` and `ledger: WorkforceCostCacheLedgerStore`. The daemon scheduler resolves these (or not) and passes them through. The CEO handler checks for presence: if the LLM client is available, use DeepSeek reasoning; otherwise, fall back to the current hardcoded map.
   - Pros: Minimal structural change; daemons stay decoupled from the agent loop; fallback preserves current behavior
   - Cons: The `LlmClient` interface lives in `agentLoop.ts` — extracting it to a shared location would be cleaner but adds a refactor step; daemon handlers are async but not conversational (no streaming), so the full `LlmClient` interface is more than needed
   - Effort: Low

2. **Create a standalone `ceoDeepSeekClient` wrapper** — Extract `createDeepSeekClient()` from `agentLoop.ts` into a new shared module (e.g., `packages/agent/src/workers/ceoDeepSeekClient.ts`). Create a simpler `CeoDeepSeekReasoner` function that takes a prompt and returns a structured recommendation, handling error/timeout/fallback internally. The CEO handler imports and calls it directly.
   - Pros: Clean separation of concerns; no dependency on the agent loop; testable in isolation; clear fallback chain
   - Cons: Duplicates some pattern from the agent loop (though the agent loop would still use its own); requires a new file
   - Effort: Medium

3. **Promote the CEO handler to a full agent loop** — Convert the `product-ads-ceo-profitability` lane from a daemon to a full agent loop (similar to the CEO lane itself), giving it a system prompt, tools (Cortex lookup, ledger query, prepare action), and DeepSeek-driven conversation. The daemon scheduler would spawn an agent loop instance instead of calling the handler directly.
   - Pros: Full LLM capability (tool use, multi-turn if needed); consistent with the project's agent loop pattern; leverage existing infrastructure (caching, ledger, guardrails)
   - Cons: **Over-engineered** — this is a signal-to-action mapping, not a conversational agent; adds unnecessary complexity (state, history, tool orchestration); the agent loop is designed for interactive conversation, not batch processing
   - Effort: High

### Recommendation

**Approach 2** — standalone `CeoDeepSeekClient` wrapper. Here's why:

1. The CEO profitability handler is a **batch daemon**, not a conversational agent. It maps structured signals to structured actions. Approach 3 is architectural overkill for this use case.
2. Approach 1 works but leaves a dependency on the agent loop module. The daemon should be self-contained and testable without importing conversation orchestration internals.
3. Approach 2 gives a clean, testable, single-responsibility module that:
   - Creates a DeepSeek client (reusing `resolveDeepSeekRuntimeConfig` and `buildDeepSeekChatCompletionRequest` from `@msl/domain`)
   - Builds a structured system prompt + finding context
   - Calls the DeepSeek chat completion with `response_format: { type: "json_object" }` for structured output
   - Parses the JSON response into `{ proposalType, severity, requiresApproval, rationale }`
   - Falls back to the hardcoded map on error, timeout, or invalid response
   - Records usage in the cost ledger
   - Charges costs to the `product-ads-ceo-profitability` lane/agent

4. The Cortex context injection should be **targeted**: query Cortex for recent action outcomes and cost snapshots for this specific seller/campaign/item, not a full graph traversal.

### Risks

- **API dependency**: The CEO handler currently works 100% offline. Adding DeepSeek introduces a network dependency and potential latency. Mitigation: the fallback to the hardcoded map must be reliable and the default when the LLM client is unavailable.
- **Non-deterministic output**: The current system maps signals to actions with 100% predictability. An LLM may suggest unexpected actions. Mitigation: constrain the output schema to a fixed enum of proposal types, validate the response against known types, and log deviations for audit.
- **Cost**: Every call to DeepSeek costs money. The profitability handler runs on every scheduler cycle (15 min default). Mitigation: batch the findings into a single LLM call per handler invocation (not one call per finding); implement a cheap cache (e.g., hash the input signals and cache the LLM response for the dedup window); use Flash model by default, reserve Pro for high-severity signals.
- **Latency in the scheduler cycle**: The daemon scheduler processes all daemons sequentially per cycle. An LLM call adds 1-3 seconds. Mitigation: keep the timeout low (<5s), make the LLM call non-blocking by collecting all findings first then making one batched call.
- **Cortex data staleness**: If Cortex cost snapshots are stale, the LLM might reason on outdated data. Mitigation: pass the `capturedAt` timestamp to the LLM and include a freshness warning in the prompt.

### Ready for Proposal

**Yes** — the investigation is complete and the approach is clear. The project already has all the infrastructure needed: DeepSeek client, cost ledger, Cortex context, pricing data, and prefix caching. The change is well-scoped: replace the hardcoded signal-to-action map in `ceoProfitabilityHandler.ts` with DeepSeek LLM reasoning, using a self-contained wrapper that falls back to the current deterministic behavior.

The orchestrator should tell the user:
- The existing DeepSeek infrastructure is mature and ready to be leveraged
- The recommendation is a self-contained `CeoDeepSeekClient` wrapper (Approach 2) — not converting the handler to a full agent loop
- The cost ledger integration is straightforward: `insertEntry()` is already designed for this
- Cortex context should be used *targetedly* (query for this specific seller/campaign), not via full graph traversal
- Fallback to the current hardcoded map is essential for reliability
