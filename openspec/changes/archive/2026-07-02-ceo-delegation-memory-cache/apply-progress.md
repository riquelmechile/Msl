# Apply Progress: CEO Delegation Memory Cache

## Mode

Standard SDD apply. Artifact store: OpenSpec. Chain strategy: stacked-to-main. Current PR boundary: later-slice boundary contracts only, preserving previous Slice 1 behavior.

## Completed Tasks

- [x] 1.1 Created lane contracts/types and CEO/Cost/Market/Creative lane definitions in `packages/agent/src/conversation/lanes.ts`.
- [x] 1.2 Added lane prompt block assembly helpers that keep stable token-0 prefixes separate from volatile refreshable context.
- [x] 1.3 Added `extractPromptCacheTelemetry()` for `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`, degrading missing counters to `null`.
- [x] 2.1 Added proposal-only `delegate_to_subagent` tool with boundary warnings, evidence IDs, and `noMutationExecuted: true`.
- [x] 2.2 Wired mock CEO lane routing to return a combined Spanish proposal with recommendation, rationale, risks, evidence IDs, and no-mutation statement.
- [x] 2.3 Updated Telegram help wording so `dale` means bounded investigation/preparation only in Phase 1.
- [x] 4.1 Added/extended focused tests for immutable prefix hygiene, telemetry association, missing cost clarification, proposal-only delegation, and Phase 1 no-mutation.
- [x] Remediation: wired OpenAI-compatible tool schema submission for real DeepSeek/OpenAI chat completions and added contract coverage for `delegate_to_subagent`.
- [x] Remediation: classified repository-wide typecheck failures as unrelated to Slice 1 changes; no Slice 1 regression found in focused tests or targeted lint.
- [x] Remediation: fixed all repository-wide typecheck blockers without expanding Slice 1 behavior.
- [x] Remediation: fixed the remaining broad targeted ESLint debt in `packages/agent/src/conversation/syncTools.ts`, `packages/mercadolibre/src/index.ts`, and `packages/mercadolibre/src/mercadolibre.test.ts` with behavior-preserving type/lint cleanup.
- [x] Remediation: fixed all remaining repository-wide `npm run lint` failures without expanding CEO Slice 1 behavior.
- [x] 3.1 Added `OperationalEvidence` metadata and confidence helpers in `packages/domain/src/cacheFreshness.ts`; stale or incomplete evidence cannot support high-confidence claims.
- [x] 3.2 Added minimal operational read-model reader/writer interfaces in `packages/memory/src/operationalReadModel.ts`; no catalog ingestion or remote sync was implemented.
- [x] 3.3 Added Cortex delegation feedback contracts/helpers in `packages/memory/src/cortex/feedback.ts`; full catalog snapshots are explicitly rejected from Cortex storage.

## Deferred Tasks

- [x] 3.1 Operational evidence freshness/completeness metadata.
- [x] 3.2 Minimal read-model interfaces; full ingestion remains deferred.
- [x] 3.3 Cortex feedback contracts and reinforcement/pruning.
- [x] 4.2 Full repository verification after existing unrelated typecheck issues are resolved or explicitly waived.

## Verification Commands

- `npm test -- packages/agent/tests/conversation/cacheBlocks.test.ts packages/agent/tests/conversation/tools.test.ts packages/agent/tests/conversation/agentLoop.test.ts packages/bot/src/bot.test.ts` — passed, 120 tests.
- `npx eslint packages/agent/src/conversation/agentLoop.ts packages/agent/src/index.ts packages/agent/tests/conversation/tools.test.ts` — passed after removing an unrelated unused test local from `tools.test.ts`.
- `npx tsc -p packages/agent/tsconfig.json --pretty false` — failed on existing unrelated agent issues in `packages/agent/src/conversation/escribano.ts` and `packages/agent/src/conversation/syncTools.ts`; no errors reported for the Slice 1 changed schema path.
- `npm run typecheck` — failed on existing unrelated repo issues in `packages/mercadolibre/src/mercadolibre.test.ts`, `packages/workers/src/insights/index.ts`, `packages/agent/src/conversation/escribano.ts`, `packages/agent/src/conversation/syncTools.ts`, and `packages/mcp/src/index.ts`.
- `npm run typecheck` — initially failed on the above blockers; after remediation, passed (`tsc -b --pretty false` and `@msl/web` `tsc --noEmit --pretty false`).
- `npm test -- packages/mercadolibre/src/mercadolibre.test.ts packages/workers/src/insights/insights.test.ts packages/agent/tests/conversation/escribano.test.ts packages/agent/tests/conversation/syncTools.test.ts packages/mcp/src/mcp.test.ts` — passed, 296 tests.
- `npx eslint packages/mercadolibre/src/index.ts packages/mercadolibre/src/mercadolibre.test.ts packages/workers/src/insights/index.ts packages/agent/src/conversation/escribano.ts packages/agent/src/conversation/syncTools.ts packages/mcp/src/index.ts` — previously failed before the targeted ESLint follow-up; no waiver was applied to typecheck.
- `npx eslint packages/agent/src/conversation/syncTools.ts packages/mercadolibre/src/index.ts packages/mercadolibre/src/mercadolibre.test.ts` — initially failed with 39 errors and 4 warnings; after remediation, passed with no output.
- `npm run typecheck` — passed after ESLint remediation (`tsc -b --pretty false` and `@msl/web` `tsc --noEmit --pretty false`).
- `npm test -- packages/mercadolibre/src/mercadolibre.test.ts packages/agent/tests/conversation/syncTools.test.ts` — passed, 145 tests.
- Fresh final verification: `npm run typecheck` — passed.
- Fresh final verification: `npm test -- packages/agent/tests/conversation/cacheBlocks.test.ts packages/agent/tests/conversation/tools.test.ts packages/agent/tests/conversation/agentLoop.test.ts packages/bot/src/bot.test.ts` — passed, 120 tests.
- Fresh final verification: `npm test -- packages/mercadolibre/src/mercadolibre.test.ts packages/workers/src/insights/insights.test.ts packages/agent/tests/conversation/escribano.test.ts packages/agent/tests/conversation/syncTools.test.ts packages/mcp/src/mcp.test.ts` — passed, 296 tests.
- Fresh final verification: `npx eslint packages/agent/src/conversation/syncTools.ts packages/mercadolibre/src/index.ts packages/mercadolibre/src/mercadolibre.test.ts` — passed with no output.
- Fresh final verification: `npm run lint` — failed with 114 ESLint errors. The targeted previously failing files above are clean, but broad lint still reports debt in `packages/agent/src/conversation/backgroundIngestion.ts`, `packages/agent/src/conversation/tools.ts`, `packages/agent/tests/conversation/agentLoop.test.ts`, `packages/agent/tests/conversation/escribano.test.ts`, `packages/agent/tests/conversation/syncTools.test.ts`, and `packages/bot/src/index.ts`.
- Lint remediation baseline: `npm run lint` — reproduced the final verification failure (`eslint .`, 114 errors) in `backgroundIngestion.ts`, `tools.ts`, `agentLoop.test.ts`, `escribano.test.ts`, `syncTools.test.ts`, and `bot/src/index.ts`.
- Lint remediation final: `npm run lint` — passed with no output.
- Lint remediation final: `npm run typecheck` — passed (`tsc -b --pretty false` and `@msl/web` `tsc --noEmit --pretty false`).
- Lint remediation final: `npm test -- packages/agent/tests/conversation/agentLoop.test.ts packages/agent/tests/conversation/escribano.test.ts packages/agent/tests/conversation/syncTools.test.ts packages/bot/src/bot.test.ts` — passed, 109 tests.
- Fresh independent final verification after global lint remediation: `npm run lint` — passed with no output.
- Fresh independent final verification after global lint remediation: `npm run typecheck` — passed (`tsc -b --pretty false` and `@msl/web` `tsc --noEmit --pretty false`).
- Fresh independent final verification after global lint remediation: `npm test -- packages/agent/tests/conversation/cacheBlocks.test.ts packages/agent/tests/conversation/tools.test.ts packages/agent/tests/conversation/agentLoop.test.ts packages/bot/src/bot.test.ts` — passed, 120 tests.
- Fresh independent final verification after global lint remediation: `npm test -- packages/mercadolibre/src/mercadolibre.test.ts packages/workers/src/insights/insights.test.ts packages/agent/tests/conversation/escribano.test.ts packages/agent/tests/conversation/syncTools.test.ts packages/mcp/src/mcp.test.ts` — passed, 296 tests.
- Later-slice boundary verification: `npm test -- packages/domain/src/domain.test.ts packages/memory/src/memory.test.ts packages/memory/tests/cortex/engine.test.ts` — passed, 112 tests.
- Later-slice boundary verification: `npm run typecheck` — passed (`tsc -b --pretty false` and `@msl/web` `tsc --noEmit --pretty false`).
- Later-slice boundary verification: `npm run lint` — passed with no output.

## ESLint Remediation

| Area | Resolution |
|---|---|
| `packages/agent/src/conversation/syncTools.ts` | Restored async only where awaited work exists, narrowed paused-listing analysis away from unsafe `any`, stringified Cortex metadata only for scalar values, and removed redundant snapshot data assertions now covered by narrowed API types. |
| `packages/mercadolibre/src/index.ts` | Removed redundant literal-plus-`string` unions, replaced stale lint disables with typed Blob/fetch body handling, returned prepared answers through explicit resolved promises, and assigned promotion net-proceeds shapes without unnecessary assertions. |
| `packages/mercadolibre/src/mercadolibre.test.ts` | Avoided unbound transport method assertions and replaced `any` test request capture with `MercadoLibreApiTransport` parameter types. |
| `packages/agent/src/conversation/backgroundIngestion.ts` | Added typed metadata coercion and snapshot normalization helpers, removed unnecessary assertions, kept synchronous helpers synchronous, and avoided enabling dormant quality/relist phases while satisfying unused-function lint. |
| `packages/agent/src/conversation/tools.ts` | Replaced direct `String(unknown)` metadata coercion with scalar-safe string conversion. |
| `packages/agent/tests/conversation/agentLoop.test.ts` | Removed unnecessary async from a synchronous stub tool executor. |
| `packages/agent/tests/conversation/escribano.test.ts` | Replaced matcher shapes that inferred unsafe `any` assignments with direct metadata assertions. |
| `packages/agent/tests/conversation/syncTools.test.ts` | Centralized the require-await disable for synchronous async test stubs, avoided unbound method destructuring, and narrowed partial-error assertions. |
| `packages/bot/src/index.ts` | Returned resolved promises from synchronous `listActiveChats()` branches instead of marking the method `async`. |

## Typecheck Classification

| Area | Classification | Evidence |
|---|---|---|
| `packages/mercadolibre/src/mercadolibre.test.ts` | Unrelated/pre-existing | Test helper return unions (`Summary | readonly Summary[]`) are accessed as concrete objects across moderation/notices/answers/claims/image orchestration tests. Outside Slice 1 changed files. |
| `packages/workers/src/insights/index.ts` | Unrelated/pre-existing | `BusinessSignalKind` now requires `business-signal` in a workers label map. Outside Slice 1 changed files. |
| `packages/agent/src/conversation/escribano.ts` | Unrelated/pre-existing agent issue | Tool-result narrowing treats parsed payloads as `{}` before accessing `results`/`claim`; file was not changed by Slice 1. |
| `packages/agent/src/conversation/syncTools.ts` | Unrelated/pre-existing agent issue | Existing import-type syntax issue and `exactOptionalPropertyTypes` mismatch around optional `title`; file was not changed by this remediation. |
| `packages/mcp/src/index.ts` | Unrelated/pre-existing | Existing image orchestration union/optional-title type mismatch. Outside Slice 1 changed files. |
| Slice 1 changed files | No regression found | Focused tests passed, targeted ESLint passed, and no typecheck diagnostics reference `agentLoop.ts`, `tools.ts`, `lanes.ts`, `cacheBlocks.ts`, `bot/src/index.ts`, or Slice 1 tests. |

## Typecheck Remediation

| Area | Resolution |
|---|---|
| `packages/mercadolibre/src/index.ts` | Added a single-object snapshot alias for read snapshots that always return object data, preserving array-capable listing snapshots while narrowing moderation/notices/claims/shipment/image orchestration results. |
| `packages/mercadolibre/src/mercadolibre.test.ts` | Added explicit `present()` assertions for indexed test fixtures under `noUncheckedIndexedAccess`. |
| `packages/workers/src/insights/index.ts` | Added the missing `business-signal` label to the `BusinessSignalKind` label map. |
| `packages/agent/src/conversation/escribano.ts` | Narrowed parsed claim tool-result payloads before reading `results` or `claim`. |
| `packages/agent/src/conversation/syncTools.ts` | Removed invalid nested `type` import modifiers and omitted optional `title` when absent for exact optional property types. |
| `packages/mcp/src/index.ts` | Omitted optional image orchestration `title` when absent and used the narrowed image orchestration snapshot data. |

## Changed Files

- `packages/agent/src/conversation/lanes.ts` — added lane contracts, lane outputs, cache telemetry types, and lane definitions.
- `packages/agent/src/conversation/cacheBlocks.ts` — added lane prompt assembly helpers.
- `packages/agent/src/conversation/agentLoop.ts` — added cache telemetry extraction, proposal-only CEO routing, and Phase 1 no-mutation confirmation semantics.
- `packages/agent/src/conversation/tools.ts` — added `delegate_to_subagent` proposal-only tool.
- `packages/agent/src/index.ts` — exported lane contracts, delegation tool, and OpenAI-compatible tool schema helper.
- `packages/bot/src/index.ts` — updated Telegram `/help` approval wording.
- `packages/agent/tests/conversation/cacheBlocks.test.ts` — added immutable prefix hygiene tests.
- `packages/agent/tests/conversation/tools.test.ts` — added delegation tool safety test and OpenAI-compatible schema contract coverage; removed an unrelated unused local that made targeted ESLint fail.
- `packages/agent/tests/conversation/agentLoop.test.ts` — added telemetry/no-mutation/CEO proposal tests and updated Phase 1 `dale` expectations.
- `packages/bot/src/bot.test.ts` — added help wording safety test.
- `packages/mercadolibre/src/index.ts` — narrowed single-object MLC snapshot types for object-returning API helpers.
- `packages/mercadolibre/src/mercadolibre.test.ts` — added explicit indexed-fixture presence assertions for type safety.
- `packages/workers/src/insights/index.ts` — completed the business signal label map.
- `packages/agent/src/conversation/escribano.ts` — narrowed claim payload records before claim persistence.
- `packages/agent/src/conversation/syncTools.ts` — fixed type-only imports and exact optional title handling for image orchestration.
- `packages/mcp/src/index.ts` — fixed exact optional title handling for image orchestration.
- `packages/agent/src/conversation/syncTools.ts` — fixed remaining targeted ESLint issues without changing tool behavior.
- `packages/mercadolibre/src/index.ts` — fixed remaining targeted ESLint issues without changing API behavior.
- `packages/mercadolibre/src/mercadolibre.test.ts` — fixed remaining targeted ESLint issues in test scaffolding.
- `packages/agent/src/conversation/backgroundIngestion.ts` — fixed repository-wide ESLint issues in metadata normalization, snapshot narrowing, and synchronous helper declarations.
- `packages/agent/tests/conversation/escribano.test.ts` — fixed unsafe matcher inference in tool issue assertions.
- `packages/agent/tests/conversation/syncTools.test.ts` — fixed require-await, unbound-method, and unsafe partial-error assertion lint issues in test scaffolding.
- `packages/domain/src/cacheFreshness.ts` — added operational evidence freshness/completeness metadata and confidence helpers.
- `packages/domain/src/domain.test.ts` — added stale operational evidence coverage.
- `packages/memory/src/operationalReadModel.ts` — added minimal operational read-model interfaces only.
- `packages/memory/src/cortex/feedback.ts` — added delegation feedback contracts and Cortex snapshot-storage boundary helper.
- `packages/memory/src/cortex/index.ts` — exported Cortex feedback contracts/helpers.
- `packages/memory/src/index.ts` — exported operational read-model and Cortex feedback contracts/helpers.
- `packages/memory/src/memory.test.ts` — added read-model boundary and Cortex full-catalog rejection coverage.
