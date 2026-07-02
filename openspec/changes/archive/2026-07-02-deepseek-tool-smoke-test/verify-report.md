# Verify Report: DeepSeek Tool Smoke Test

## Summary

Fresh SDD verification passed for the DeepSeek tool-call smoke implementation. Offline tests, typecheck, lint, and format check passed. The live DeepSeek smoke was intentionally not run because this environment did not already contain both `DEEPSEEK_API_KEY` and `MSL_DEEPSEEK_LIVE_SMOKE=1`.

## Commands

| Command | Result | Evidence |
|---|---:|---|
| `npm test -- scripts/deepseek-tool-smoke.test.mjs packages/agent/tests/conversation/tools.test.ts` | Pass | 2 files, 54 tests passed. |
| `npm run typecheck` | Pass | Root TypeScript build and `@msl/web` typecheck passed. |
| `npm run lint` | Pass | ESLint completed without errors. |
| `npm run format:check` | Pass | All matched files use Prettier code style. |

## Compliance Matrix

| Requirement | Status | Evidence |
|---|---:|---|
| Explicit live gates before provider calls | Pass | `assertLiveSmokeEnv()` requires `DEEPSEEK_API_KEY` and `MSL_DEEPSEEK_LIVE_SMOKE=1`; env-gate tests prove missing gates reject before provider client creation. |
| Official OpenAI-compatible tools and forced named `tool_choice` | Pass | `createDeepSeekToolSmokeRequest()` uses built `@msl/agent` tool schema helpers, one `delegate_to_subagent` tool, and `{ type: "function", function: { name: "delegate_to_subagent" } }`. |
| Synthetic `user_id` and no business data | Pass | Request uses `msl-smoke-deepseek-tool-v1`, synthetic lane/scope/evidence constants, and synthetic prompts only. |
| No tool execution or mutations | Pass | Smoke validates returned provider contract only and returns formatted evidence; it does not call the tool executor. |
| Safe tool-call and cache telemetry validation | Pass | Offline tests cover wrong finish reason, wrong tool name, malformed JSON, valid tool-call evidence, absent/zero cache counters, and invalid counters. |
| Secret-safe logs | Pass | Output contains model, finish reason, tool name, synthetic `user_id`, and cache telemetry; errors print messages only and do not dump env, headers, or API keys. |

## Live Smoke

Not run during fresh verification. Environment check result: `DEEPSEEK_API_KEY` absent and `MSL_DEEPSEEK_LIVE_SMOKE=1` absent. Required manual command:

```bash
DEEPSEEK_API_KEY=... MSL_DEEPSEEK_LIVE_SMOKE=1 npm run smoke:deepseek:tool
```

Optional overrides:

```bash
DEEPSEEK_SMOKE_MODEL=deepseek-v4-flash DEEPSEEK_BASE_URL=https://api.deepseek.com
```

## Notes

- Normal tests and CI do not call DeepSeek.
- The live smoke exits before client creation unless both `DEEPSEEK_API_KEY` and `MSL_DEEPSEEK_LIVE_SMOKE=1` are present.
- The smoke validates `finish_reason`, forced tool name, JSON arguments, and cache telemetry shape only; it does not execute returned tool calls.
- Fresh verification made no implementation changes.
