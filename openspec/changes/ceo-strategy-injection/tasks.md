# Tasks: CEO Strategy Injection

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1100–1200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (types + parser) → PR 2 (store) → PR 3 (injection + guardrails) |
| Delivery strategy | auto-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Types + hybrid parser with regex patterns for 9 rule types, LLM fallback, confidence scoring | PR 1 | Foundation. Verifiable via parser unit tests. |
| 2 | SQLite strategy CRUD with lifecycle (insert/listActive/archive/supersede) | PR 2 | Depends on types from PR 1. Verifiable via store unit tests. |
| 3 | System prompt injection + strategyValidator guardrail + agentLoop wiring | PR 3 | Depends on types + store. Verifiable via guardrail + integration tests. |

## Phase 1: Foundation — Types + Strategy Parser

- [x] 1.1 Add `ParsedRule`, `Strategy`, `ParseResult`, `RuleType` types to `packages/agent/src/conversation/types.ts`
- [x] 1.2 Create `packages/agent/src/conversation/strategyParser.ts` with regex patterns for 7 rule types (margin, stock, category, pricing, customer, competitive) — LLM fallback deferred to later PR
- [x] 1.3 ~~LLM fallback~~ — deferred to PR 2/3 per orchestrator scope decision
- [x] 1.4 Confidence scoring: pattern matches assign 1.0 confidence; aggregate `ParseResult.confidence` computed as average
- [x] 1.5 Write Vitest unit tests: margin (forward + reverse), stock (with scope), category (exclusion + focus), pricing (cap + floor), customer (response time), competitive, multi-rule, unparsed, empty input, Spanish variations (tuteo/voseo)

## Phase 2: Storage — Strategy CRUD

- [x] 2.1 Create `packages/agent/src/conversation/strategyStore.ts` with SQLite `ceo_strategies` table (id, rule_type, rule_text, parsed_rule JSON, confidence, status, replaced_by, created_at, updated_at)
- [x] 2.2 Implement `insertStrategy(ruleText, parsedRule, confidence)`, `listActive()`, `archiveStrategy(id)`, `updateStrategy(id, ruleText, parsedRule)` following existing `Database` pattern from `@msl/memory`
- [x] 2.3 Implement supersede logic: archiving old strategy sets `replaced_by` → new strategy ID
- [x] 2.4 Write Vitest unit tests: full CRUD lifecycle (insert→listActive→archive→supersede), in-memory SQLite

## Phase 3: Injection, Guardrails & Wiring

- [x] 3.1 Modify `buildSystemPrompt(sellerName, strategies?)` in `packages/agent/src/conversation/systemPrompt.ts` to append `## Estrategia del CEO` block when strategies exist; omit section when empty
- [x] 3.2 Write Vitest unit test: strategies injected vs. omitted, Spanish directive rendering per rule type
- [x] 3.3 Add `strategyValidator(proposal, strategies): GuardResult` to `packages/agent/src/conversation/guardrails.ts` — validate margin, category exclusion, empty-strategies pass-through
- [x] 3.4 Write Vitest unit tests: margin violation blocked, category exclusion blocked, compliant proposal passes, no-active-strategies passes, Spanish rejection message
- [x] 3.5 Add optional `strategies` field to `AgentLoopConfig` in `packages/agent/src/conversation/agentLoop.ts`; wire `strategyValidator` into `converse()` and `converseStream()` before proposal return
- [x] 3.6 Write Vitest integration test: full parse→store→inject→validate flow with real SQLite

## Phase 4: Cleanup & Verification

- [x] 4.1 Run `npm test` — all Vitest suites pass
- [x] 4.2 Run `npm run typecheck` — no new type errors
- [x] 4.3 Run `npm run lint` — clean with no warnings
- [x] 4.4 Verify rollback: confirm that removing `strategies` param from `buildSystemPrompt` and dropping `strategies` from `AgentLoopConfig` restores original behavior

## Phase 5: Conversation CRUD Intent Routing (verify fixes)

- [x] 5.1 Add `StrategyStore` interface and optional `store` field to `AgentLoopConfig` in `agentLoop.ts`
- [x] 5.2 Add `detectStrategyIntent()`, `extractRuleTypeFromMessage()`, and `handleStrategyCommand()` functions for list/update/archive intent routing before LLM flow
- [x] 5.3 Make MARGIN_RE in `strategyParser.ts` handle "margen a N%" phrasing (add `(?:a\s+)?` filler)
- [x] 5.4 Write tests: list active strategies, update margin strategy, archive stock strategy, normal message passthrough, empty store message
- [x] 5.5 Run full test suite — 288 tests pass, typecheck clean, build succeeds
