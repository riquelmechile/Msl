# Proposal: DeepSeek CEO Profitability Reasoning

## Intent

Replace the hardcoded `SIGNAL_TO_ACTION` map in the CEO profitability handler with DeepSeek LLM reasoning. The static map produces the same action for `margin-consuming` whether margin loss is 1% or 90% — a campaign with high CVR should get a different recommendation than one with no conversions. The handler just shipped and already feels too generic. DeepSeek adds Cortex-aware context: historical profitability data, cost snapshots, and past outcomes for the specific seller/campaign/item.

## Scope

### In Scope
- Standalone `CeoDeepSeekClient` wrapper (Approach 2) in `packages/agent/src/workers/`
- Batched: one LLM call per handler cycle with structured JSON output
- Cortex context injection: targeted query for this seller/campaign/item
- Fallback to existing `SIGNAL_TO_ACTION` map on error, timeout, or invalid response
- Cost ledger integration: each call recorded, charged to `product-ads-ceo-profitability` lane
- Prefix caching via existing `cacheBlocks` pattern

### Out of Scope
- Full agent loop conversion — over-engineered for a signal-to-action task
- Model tier split (Flash vs Pro) — first slice Flash only
- Injection via daemon scheduler context — handler imports client directly

## Capabilities

### New Capabilities
- `deepseek-ceo-profitability-reasoning`: standalone module that enriches findings with Cortex context, calls DeepSeek with structured output (`response_format: { type: "json_object" }`), validates response against known `proposalType` enum values, and returns a recommendation or falls back to the hardcoded `SIGNAL_TO_ACTION` map.

### Modified Capabilities
- `ceo-profitability-handler`: the Signal-to-Action Mapping requirement SHALL delegate to `CeoDeepSeekClient` when available. The existing static `SIGNAL_TO_ACTION` map SHALL be preserved as the fallback. Output validation SHALL reject invalid `proposalType` values and trigger fallback.

## Approach

Create `CeoDeepSeekClient` — a standalone wrapper in `packages/agent/src/workers/` reusing existing infrastructure: `resolveDeepSeekRuntimeConfig` + `buildDeepSeekChatCompletionRequest` from `@msl/domain`, Cortex `queryByMetadata()` for targeted context, `insertEntry()` on the workforce cost ledger. Flash model via `DEEPSEEK_API_KEY` env. Handler imports it directly. One batched call per cycle processes all findings in a single JSON response. Cold Cortex (no history) passed as "no historical data available" — LLM reasons on current data alone. Validated output must match known `proposalType` enum; invalid → fallback.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/workers/ceoProfitabilityHandler.ts` | Modified | Replace direct `SIGNAL_TO_ACTION` lookup with `CeoDeepSeekClient` call, preserve fallback |
| `packages/agent/src/workers/ceoDeepSeekClient.ts` | New | Standalone DeepSeek reasoning wrapper with Cortex enrichment, validation, and ledger recording |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| DeepSeek API unreachable | Low | Fallback to static map is immediate and reliable |
| LLM returns invalid `proposalType` | Medium | Output validated against known enum; invalid → fallback |
| Latency in daemon cycle | Low | Batched single call, <5s timeout, fallback on timeout |
| Cost accumulation | Low | Flash model, prefix caching, batched per cycle (not per finding) |

## Rollback Plan

Remove `CeoDeepSeekClient` import from `ceoProfitabilityHandler.ts`. The static `SIGNAL_TO_ACTION` map is preserved and still wired. One-line revert: delete the new import, restore direct lookup path. Delete `ceoDeepSeekClient.ts`. No migrations, no config changes.

## Dependencies

- `DEEPSEEK_API_KEY` env var (already set in agent environment)
- Existing `@msl/domain` DeepSeek runtime utilities (already built)
- Existing Cortex `GraphEngine` (already passed in daemon context, currently unused)
- Existing workforce cost ledger (already supports `insertEntry` with `department_id`)

## Success Criteria

- [ ] Handler produces LLM-reasoned recommendations when DeepSeek is reachable
- [ ] Fallback to static `SIGNAL_TO_ACTION` map is instant on error, timeout, or invalid output
- [ ] Every LLM call recorded in cost ledger with `department_id: product-ads-ceo-profitability`
- [ ] Existing handler behavior (message claiming, dedupe, forum topics, Telegram notifications) preserved unchanged
- [ ] Handler tests pass with both happy path (LLM available) and fallback path (LLM unavailable)
