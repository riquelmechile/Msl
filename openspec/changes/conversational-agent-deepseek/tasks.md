# Tasks: Conversational Agent with DeepSeek

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~790 (6 new files + 2 modified + tests) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | auto-forecast |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Types, system prompt, guardrails | PR 1 (base: main) | ~390 lines — standalone foundation, tests included |
| 2 | Cortex tools, cache blocks, agent loop | PR 2 (base: PR 1) | ~370 lines — depends on PR 1 types + guardrail types |
| 3 | Wire exports, dependencies, integration verify | PR 3 (base: PR 2) | ~30 lines — package.json, index.ts, full suite green |

---

## Phase 1: Foundation — Types, Prompt, Guardrails (PR 1)

- [x] 1.1 Create `packages/agent/src/conversation/types.ts` with `ConversationMessage`, `AgentProposal` (maps to `PreparedAction`), `StreamingChunk`
- [x] 1.2 Create `packages/agent/src/conversation/systemPrompt.ts` — Block A builder: Plasticov identity, Spanish-only rule, "dale" confirmation gate, no-prompt-reveal rule
- [x] 1.3 Create `packages/agent/src/conversation/guardrails.ts` — `SpanishValidator` (reject non-Spanish), `HarmfulContentFilter` (reuse `detectSafetyConflict` pattern), `ActionSafetyValidator` (map LLM output → `PreparedAction` risk)
- [x] 1.4 Write unit tests: `types.test.ts`, `systemPrompt.test.ts` (verify hard rules in output), `guardrails.test.ts` (English blocks, high-risk flags)

## Phase 2: Core — Tools, Cache, Agent Loop (PR 2)

- [x] 2.1 Create `packages/agent/src/conversation/cacheBlocks.ts` — Block B (daily aggregates, stub for now, 24h TTL via `@msl/domain` `CacheFreshness`) + Block C assembly wrapper
- [x] 2.2 Create `packages/agent/src/conversation/tools.ts` — `get_business_context` (intent → `GraphEngine.spreadActivation` → `traverse().context`) + `prepare_action` (LLM output → `createPreparedAction`)
- [x] 2.3 Create `packages/agent/src/conversation/agentLoop.ts` — SDK `Agent` + `Runner` with DeepSeek provider (`baseURL: "https://api.deepseek.com"`), `converse()` entry yielding `StreamingChunk`, fallback to `answerBusinessQuestion()` on failure
- [x] 2.4 Write unit tests: `cacheBlocks.test.ts` (TTL behavior), `tools.test.ts` (mock `GraphEngine`, verify `PreparedAction` shape), `agentLoop.test.ts` (mock DeepSeek client, verify streaming, verify fallback path)

## Phase 3: Integration — Wire-up & Verify (PR 3)

- [x] 3.1 Add `openai` and `@openai/agents` to `packages/agent/package.json` dependencies (pin exact versions: `openai@6.45.0`, `@openai/agents@0.12.0`)
- [x] 3.2 Modify `packages/agent/src/index.ts` — export `createAgentLoop` (provides `converse()`), `ConversationMessage`, `AgentProposal`, `ConversationState`, `StreamingChunk`, `GuardResult`, and all guardrail functions; keep `answerBusinessQuestion()` unchanged
- [x] 3.3 Run full verification: `npm test` (191/191 pass, incl. 6 deterministic), `npm run typecheck` (clean), `npm run build` (succeeds). `npm run lint` has 28 pre-existing errors from PR 1/PR 2 code — none from this PR.
