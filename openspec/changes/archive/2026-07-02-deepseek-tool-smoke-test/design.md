# Design: DeepSeek Tool Smoke Test

## Technical Approach

Add one standalone, opt-in smoke runner that makes a single non-streaming DeepSeek chat completion request and forces the `delegate_to_subagent` function call. The smoke reuses the built `@msl/agent` tool schema helpers, sends only synthetic data, validates provider contract fields, and never executes returned tools or mutates local/remote business state.

## Architecture Decisions

| Decision | Choice | Tradeoff / Rationale |
|---|---|---|
| Runner shape | `scripts/deepseek-tool-smoke.mjs` plus a root npm script | Matches existing guarded script convention (`scripts/run-e2e.mjs`) and avoids normal Vitest/CI discovery. |
| Provider client | Create a local `OpenAI` client in the smoke script | Keeps production `createDeepSeekClient()` unchanged while allowing smoke-only `DEEPSEEK_BASE_URL` override. |
| Tool schema source | Import `createDelegateToSubagentTool()` and `createOpenAiToolDefinitions()` from built `@msl/agent` | Prevents schema drift; command builds `@msl/agent` first so Node can import package exports. |
| Tool choice | Force named function `delegate_to_subagent` | More deterministic than prompt persuasion or production `tool_choice: "auto"`; validates the exact provider round trip. |
| Cache telemetry | Validate only finite non-negative counters when present | DeepSeek cache hits may be absent or zero on first run; smoke should fail only invalid telemetry, not cold-cache behavior. |

## Data Flow

```text
npm script ──env gates──> smoke runner ──tools/tool_choice──> DeepSeek API
    │                         │                              │
    │                         └── redacted validation output ←┘
    └── no normal test/CI execution, no tool execution, no mutations
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `scripts/deepseek-tool-smoke.mjs` | Create | Guarded live smoke runner with synthetic request, validation, redacted output, and exit codes. |
| `package.json` | Modify | Add `smoke:deepseek:tool` command, e.g. `npm run build --workspace @msl/agent && node scripts/deepseek-tool-smoke.mjs`. |
| `openspec/changes/deepseek-tool-smoke-test/design.md` | Create | This design artifact. |

## Interfaces / Contracts

Environment contract:

```text
DEEPSEEK_API_KEY              required
MSL_DEEPSEEK_LIVE_SMOKE=1     required explicit opt-in
DEEPSEEK_SMOKE_MODEL          optional, default deepseek-v4-flash
DEEPSEEK_BASE_URL             optional, default https://api.deepseek.com
```

Request contract:
- `model`: `process.env.DEEPSEEK_SMOKE_MODEL ?? "deepseek-v4-flash"`
- `baseURL`: `process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"`
- `stream: false`
- `tools`: only `delegate_to_subagent`
- `tool_choice`: `{ type: "function", function: { name: "delegate_to_subagent" } }`
- `user_id`: `msl-smoke-deepseek-tool-v1`
- prompt/args: synthetic scope only, e.g. lane `market-catalog`, scope `synthetic provider smoke`, evidence ID `smoke:evidence:synthetic-1`; no MercadoLibre IDs, seller IDs, catalog data, account data, emails, or tokens.

Validation contract:
- Fail non-zero if gates are missing, API fails, `finish_reason !== "tool_calls"`, no `message.tool_calls`, first function name is not `delegate_to_subagent`, or JSON args omit valid `laneId`/`scope`.
- If `usage.prompt_cache_hit_tokens` or `usage.prompt_cache_miss_tokens` exist, they must be finite non-negative numbers. Missing counters, zero hits, or all misses are accepted and logged as cold/absent telemetry.
- Output must redact secrets and summarize only model, finish reason, tool name, synthetic `user_id`, and cache counter presence/values.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Offline schema serialization remains valid | Existing `packages/agent/tests/conversation/tools.test.ts` coverage. |
| Integration | Smoke script validation helpers and env gates | Prefer small pure helper coverage if helpers are extracted; otherwise rely on typecheck/lint plus manual smoke. |
| Live smoke | DeepSeek forced tool-call round trip | `DEEPSEEK_API_KEY=... MSL_DEEPSEEK_LIVE_SMOKE=1 npm run smoke:deepseek:tool`. |

Verification commands:

```bash
npm run typecheck
npm run lint
npm test -- packages/agent/tests/conversation/tools.test.ts packages/agent/tests/conversation/agentLoop.test.ts
DEEPSEEK_API_KEY=... MSL_DEEPSEEK_LIVE_SMOKE=1 npm run smoke:deepseek:tool
```

## Migration / Rollout

No migration required. The command is opt-in, paid/live, and excluded from default test/build gates.

## Open Questions

None.
