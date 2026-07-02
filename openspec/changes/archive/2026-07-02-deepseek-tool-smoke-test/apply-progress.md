# Apply Progress: DeepSeek Tool Smoke Test

## Mode

Standard apply mode. Strict TDD is disabled in `openspec/config.yaml`.

## Completed Tasks

- [x] 1.1 Created `scripts/deepseek-tool-smoke.mjs` with exported validation helpers and direct-execution `main()` guard.
- [x] 1.2 Added runtime imports for `OpenAI`, `createDelegateToSubagentTool()`, and `createOpenAiToolDefinitions()` from built package exports after env gates pass.
- [x] 1.3 Defined synthetic smoke constants: `user_id` `msl-smoke-deepseek-tool-v1`, lane `market-catalog`, synthetic scope, and synthetic evidence ID.
- [x] 2.1 Added `DEEPSEEK_API_KEY` and `MSL_DEEPSEEK_LIVE_SMOKE=1` gates before client creation or provider calls.
- [x] 2.2 Built non-streaming chat completion request with only `delegate_to_subagent`, forced named `tool_choice`, synthetic prompt content, and `user_id`.
- [x] 2.3 Added validation for `finish_reason === "tool_calls"`, first tool name, and parseable JSON arguments with valid `laneId` and `scope`.
- [x] 2.4 Added optional cache telemetry validation for finite non-negative counters.
- [x] 2.5 Added secret-safe summarized output only.
- [x] 3.1 Added root `smoke:deepseek:tool` script.
- [x] 3.2 Added env-gate tests proving provider client creation is blocked without explicit gates.
- [x] 3.3 Added response validation tests for invalid and valid provider contracts.
- [x] 3.4 Added cache telemetry validation tests.
- [x] 4.1 Ran focused offline tests.
- [x] 4.2 Ran typecheck, lint, and format check.
- [x] 4.4 Remediated repository formatting drift with formatter-only Prettier changes and reran all required gates.

## Remaining Tasks

- [ ] 4.3 Live smoke was not run because this apply did not receive an already-present API key and explicit live opt-in gate. Run manually with:

```bash
DEEPSEEK_API_KEY=... MSL_DEEPSEEK_LIVE_SMOKE=1 npm run smoke:deepseek:tool
```

Optional overrides:

```bash
DEEPSEEK_SMOKE_MODEL=deepseek-v4-flash DEEPSEEK_BASE_URL=https://api.deepseek.com
```

## Verification Evidence

| Command | Result | Notes |
|---|---:|---|
| `npx prettier --write docs/propuesta-ceo-socio.md packages/agent/src/conversation/agentLoop.ts packages/agent/src/conversation/backgroundIngestion.ts packages/agent/src/conversation/escribano.ts packages/agent/src/conversation/lanes.ts packages/agent/src/conversation/syncTools.ts packages/agent/src/conversation/tools.ts packages/agent/tests/conversation/cacheBlocks.test.ts packages/agent/tests/conversation/tools.test.ts packages/bot/src/index.ts packages/domain/src/cacheFreshness.ts packages/mcp/src/index.ts packages/mcp/src/mcp.test.ts packages/memory/src/cortex/engine.ts packages/memory/src/cortex/feedback.ts packages/memory/src/operationalReadModel.ts packages/mercadolibre/src/index.ts packages/mercadolibre/src/mercadolibre.test.ts README.md ROADMAP.md` | Pass | Formatter-only remediation for the 20 files reported by Prettier. |
| `npm run format:check` | Pass | All matched files use Prettier code style. |
| `npm run lint` | Pass | ESLint completed without errors. |
| `npm run typecheck` | Pass | Root TypeScript build and `@msl/web` typecheck passed. |
| `npm test -- scripts/deepseek-tool-smoke.test.mjs packages/agent/tests/conversation/tools.test.ts` | Pass | 2 files, 54 tests passed. |

## Deviations

- Runtime provider imports are dynamic and happen after env gates pass. This preserves the design requirement to use built `@msl/agent` exports for live smoke while allowing offline helper tests to run without building or loading live dependencies.
- Formatting remediation touched files outside the smoke implementation only through Prettier output; no behavior changes were made.

## Workload / PR Boundary

- Mode: single small PR.
- Current work unit: guarded DeepSeek live smoke plus offline validation tests.
- Boundary: script, package wiring, Vitest include for script tests, OpenSpec progress/verification artifacts.
- Estimated review budget impact: within the 800-line configured budget; no chained PR needed.
