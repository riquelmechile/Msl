## Exploration: DeepSeek Tool Smoke Test

### Current State
The agent already uses the OpenAI SDK against DeepSeek through `createDeepSeekClient()` with `baseURL: "https://api.deepseek.com"` and model default `deepseek-v4-flash`. `createRealClient()` converts registered `ToolDefinition`s into OpenAI-compatible function tools and submits them with `tool_choice: "auto"`; it also parses returned `message.tool_calls` into the local `LlmClient` shape. Contract tests prove `delegate_to_subagent` serializes correctly and remains proposal-only, but no live DeepSeek/OpenAI-compatible request has verified provider round-tripping.

Existing test defaults are safe: Vitest unit/integration tests run from `npm test`, DeepSeek is only constructed when `DEEPSEEK_API_KEY` exists, and mock/noop paths keep normal CI/local runs offline. There is no existing smoke-test script convention beyond guarded command scripts like `scripts/run-e2e.mjs`.

### Affected Areas
- `packages/agent/src/conversation/agentLoop.ts` — current DeepSeek client creation, tool schema conversion, `tool_choice: "auto"`, tool-call parsing, and cache telemetry extraction live here.
- `packages/agent/src/conversation/tools.ts` — source of the safe `delegate_to_subagent` tool schema and proposal-only execution contract.
- `packages/agent/tests/conversation/tools.test.ts` — existing contract coverage for OpenAI-compatible serialization; should remain offline and deterministic.
- `packages/agent/tests/conversation/agentLoop.test.ts` — existing offline DeepSeek env fallback and cache telemetry tests; useful as patterns, but live paid calls should not be included in the normal Vitest include set unless explicitly skipped by env.
- `scripts/` and root `package.json` — best location for an explicit opt-in smoke command so normal `npm test`, CI, build, and typecheck never call paid APIs.
- `openspec/specs/conversational-business-agent/spec.md` and `openspec/specs/multi-agent-orchestration/spec.md` — source requirements for DeepSeek Flash, cache telemetry, and lane cache measurement semantics.

### Approaches
1. **Standalone opt-in smoke script** — Add a small Node/TypeScript smoke runner under `scripts/` (or a dedicated package script) that directly calls `openai.chat.completions.create()` with the `delegate_to_subagent` function schema, `tool_choice` forced to that named function, model default `deepseek-v4-flash`, and a synthetic `user_id` such as `msl-smoke-deepseek-tool-v1`.
   - Pros: Never runs through normal Vitest/CI by accident; easiest to keep logs secret-safe; can inspect raw `finish_reason`, `message.tool_calls`, and `usage` without changing production interfaces; cheapest single-call shape.
   - Cons: Duplicates a little request-building logic unless it imports `createOpenAiToolDefinitions()`/`createDelegateToSubagentTool()`; separate verification command must be documented.
   - Effort: Low

2. **Vitest live smoke file with env skip** — Add `*.test.ts` coverage that skips unless both `DEEPSEEK_API_KEY` and an explicit live-smoke flag are set.
   - Pros: Reuses test assertions and reporter output; easy for developers to run with Vitest filters.
   - Cons: Higher risk of accidental paid calls if skip guards regress; live provider flakiness can contaminate test mental model; normal test include already scans `packages/**/*.test.ts`.
   - Effort: Medium

3. **Exercise the full agent loop live** — Run `createAgentLoop()` against DeepSeek and prompt it to delegate.
   - Pros: Closest to production behavior.
   - Cons: Current real client uses `tool_choice: "auto"`, so forcing `delegate_to_subagent` would require production API changes; prompts are less deterministic; more expensive and harder to assert; riskier because the full tool map contains broader tools.
   - Effort: Medium

### Recommendation
Use the standalone opt-in smoke script. It should be excluded from default CI/local test commands and require two gates: `DEEPSEEK_API_KEY` plus an explicit flag such as `MSL_DEEPSEEK_LIVE_SMOKE=1`. The smoke should import the real `delegate_to_subagent` schema from `@msl/agent` source utilities where practical, make exactly one non-streaming chat completion call, and force the named tool via official `tool_choice` support rather than relying on prompt persuasion.

Recommended request shape:
- `model`: `process.env.DEEPSEEK_SMOKE_MODEL ?? "deepseek-v4-flash"`.
- `messages`: short synthetic system/user content with no business data and no MercadoLibre identifiers.
- `tools`: only `delegate_to_subagent`.
- `tool_choice`: named function forcing for `delegate_to_subagent`.
- `user_id`: stable non-personal lane identifier, e.g. `msl-smoke-deepseek-tool-v1`, documented as synthetic and not derived from a person, seller, account, email, or token.
- `stream`: `false`.

Validation should assert only stable provider-contract facts: `finish_reason === "tool_calls"`, at least one `message.tool_calls` entry exists, the first function name is `delegate_to_subagent`, and parsed JSON arguments include a valid lane/scope. Cache telemetry validation should be non-flaky: if `usage.prompt_cache_hit_tokens` or `usage.prompt_cache_miss_tokens` are present, assert they are finite non-negative numbers and print a redacted summary; if absent or zero-hit on first run, do not fail. The smoke must not execute the returned tool as part of provider validation unless a separate local-only assertion invokes `createDelegateToSubagentTool().execute()` with synthetic arguments and checks `noMutationExecuted: true`.

### Risks
- Live provider availability, rate limits, or model behavior can fail independently of local correctness; keep it opt-in and report as smoke evidence, not unit-test truth.
- Named `tool_choice` typing may require direct OpenAI SDK request typing or a small helper because production `createRealClient()` currently hardcodes `tool_choice: "auto"`.
- Cache telemetry is best-effort and prefix-based; first-run misses or omitted counters must not fail the smoke.
- Logs could accidentally expose secrets if request/client errors are dumped raw; output should redact API keys and avoid printing full headers or environment.
- Any full-agent-loop smoke would register additional tools and increase mutation-safety review scope; avoid that for this change.

### Ready for Proposal
Yes — propose a new opt-in, standalone DeepSeek live smoke command that verifies OpenAI-compatible forced tool-call round-tripping for `delegate_to_subagent` without running in normal CI/local tests, without business data, without executing production mutations, and without requiring cache hits to pass.
