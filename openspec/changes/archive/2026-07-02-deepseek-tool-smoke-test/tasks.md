# Tasks: DeepSeek Tool Smoke Test

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 220-320 |
| Configured review budget | 800 changed lines |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR with one work-unit commit |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Add guarded DeepSeek live smoke plus offline validation tests | PR 1 | Include script, package wiring, tests, and verification evidence. |

## Phase 1: Foundation / Script Skeleton

- [x] 1.1 Create `scripts/deepseek-tool-smoke.mjs` with exported validation helpers and a `main()` guard that runs only when executed directly.
- [x] 1.2 Import `OpenAI`, `createDelegateToSubagentTool()`, and `createOpenAiToolDefinitions()` from built `@msl/agent` exports.
- [x] 1.3 Define synthetic constants in `scripts/deepseek-tool-smoke.mjs`: `user_id` `msl-smoke-deepseek-tool-v1`, lane `market-catalog`, scope, and evidence ID.

## Phase 2: Live Smoke Behavior

- [x] 2.1 Add env gates in `scripts/deepseek-tool-smoke.mjs` requiring `DEEPSEEK_API_KEY` and `MSL_DEEPSEEK_LIVE_SMOKE=1` before any client creation or provider call.
- [x] 2.2 Build one non-streaming chat completion request with only `delegate_to_subagent` in `tools`, forced named `tool_choice`, synthetic prompt content, and `user_id`.
- [x] 2.3 Validate `finish_reason === "tool_calls"`, first tool name `delegate_to_subagent`, and parseable JSON args containing valid `laneId` and `scope`.
- [x] 2.4 Validate `usage.prompt_cache_hit_tokens` and `usage.prompt_cache_miss_tokens`, when present, as finite non-negative numbers without requiring a cache hit.
- [x] 2.5 Print secret-safe output only: model, finish reason, tool name, synthetic `user_id`, and cache counter presence/values; never print headers, env dumps, or API keys.

## Phase 3: Package Wiring and Tests

- [x] 3.1 Add root `package.json` script `smoke:deepseek:tool` that builds `@msl/agent` then runs `node scripts/deepseek-tool-smoke.mjs`.
- [x] 3.2 Create `scripts/deepseek-tool-smoke.test.mjs` covering missing env gates stop before provider calls.
- [x] 3.3 Test `scripts/deepseek-tool-smoke.test.mjs` response validation for wrong finish reason, wrong tool name, malformed JSON args, and valid tool-call evidence.
- [x] 3.4 Test cache telemetry validation accepts absent/zero counters and rejects negative, infinite, or non-number counters.

## Phase 4: Verification

- [x] 4.1 Run `npm test -- scripts/deepseek-tool-smoke.test.mjs packages/agent/tests/conversation/tools.test.ts`.
- [x] 4.2 Run `npm run typecheck`, `npm run lint`, and `npm run format:check`.
- [ ] 4.3 Manually verify live smoke only with `DEEPSEEK_API_KEY=... MSL_DEEPSEEK_LIVE_SMOKE=1 npm run smoke:deepseek:tool`.
- [x] 4.4 Remediate formatter drift with Prettier-only changes and rerun `npm run format:check`, `npm run lint`, `npm run typecheck`, and focused offline smoke tests.
