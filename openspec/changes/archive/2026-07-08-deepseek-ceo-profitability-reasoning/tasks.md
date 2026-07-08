# Tasks: DeepSeek CEO Profitability Reasoning

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 400–500 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Create `CeoDeepSeekClient` wrapper | PR 1 | Base = main; Cortex enrichment, DeepSeek call, validation, ledger; tests included |
| 2 | Wire handler to `CeoDeepSeekClient` | PR 2 | Base = main (after PR 1 merges); destructure cortex, delegate to client, tests for delegation + fallback |

## Phase 1: Client Foundation

- [x] 1.1 Add `ceoDeepSeekClient.ts` — factory `createCeoDeepSeekClient()` returning null when `DEEPSEEK_API_KEY` unset; `CeoDeepSeekClient` and `CeoFinding` types
- [x] 1.2 Implement `reason()` — Cortex `queryByMetadata()` enrichment per finding, build prompt with policy block + context + findings JSON

## Phase 2: Core Reasoning

- [x] 2.1 Wire DeepSeek Flash call via OpenAI SDK with `response_format: json_object`, `AbortController` 5s timeout
- [x] 2.2 Validate LLM response against known `proposalType` enum; invalid → return fallback signal
- [x] 2.3 Record `insertEntry()` on workforce cost ledger with `department_id: product-ads-ceo-profitability` and token counts

## Phase 3: Handler Integration

- [x] 3.1 Destructure `cortex` from handler input; instantiate `CeoDeepSeekClient` once per cycle
- [x] 3.2 Replace direct `SIGNAL_TO_ACTION` lookup with `client.reason()` call; preserve fallback on error/timeout/null client
- [x] 3.3 Info-only findings (unit-economics, underinvested) keep info-report path without seller approval — LLM or fallback

## Phase 4: Tests

- [x] 4.1 Unit: `reason()` — valid JSON parsed, invalid `proposalType` → fallback, timeout → fallback, missing API key → null factory
- [x] 4.2 Unit: handler delegates to client when available, falls back on null client with static map
- [x] 4.3 Integration: Cortex `queryByMetadata()` returns expected profitability nodes for context enrichment
