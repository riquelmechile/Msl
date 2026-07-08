# Tasks: Creative Proactive Intelligence

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 280-350 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR with work-unit commits |
| Delivery strategy | auto-forecast |

Decision needed before apply: No
Chained PRs recommended: No
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Create CreativeDeepSeekAdvisor | PR 1 | Follow catalogDeepSeekAdvisor pattern exactly |
| 2 | Wire through types, scheduler, agentLoop, index | PR 1 | Keep all wiring in one commit |
| 3 | Enrich creativeAssetsDaemon | PR 1 | Use same aiEnrichment pattern as operations |
| 4 | Enrich creativeCommercialDaemon | PR 1 | Use same aiEnrichment pattern as operations |
| 5 | Write verify report | PR 1 | Test and document |

## Phase 1: Foundation

- [x] 1.1 Create `packages/agent/src/conversation/creativeDeepSeekAdvisor.ts` with `CreativeDeepSeekAdvisor` class following the exact pattern of `CatalogDeepSeekAdvisor` (lazy gateway, Spanish system prompt, JSON parse, cost telemetry, try/catch isolation).
- [x] 1.2 Define input types (`CreativeEnrichmentInput`) and output types (`CreativeEnrichmentOutput`) with finding kinds: `creative-quality`, `conversion-risk`, `campaign-risk`, `priority-action`.

## Phase 2: Wiring

- [x] 2.1 In `packages/agent/src/workers/daemonTypes.ts`, import `CreativeDeepSeekAdvisor` and add `creativeAdvisor?: CreativeDeepSeekAdvisor` to `DaemonHandler` input type.
- [x] 2.2 In `packages/agent/src/workers/daemonScheduler.ts`, import `CreativeDeepSeekAdvisor`, add to `DaemonSchedulerConfig`, and pass to handlers via `creativeAdvisor: config.creativeAdvisor`.
- [x] 2.3 In `packages/agent/src/conversation/agentLoop.ts`, import and create `CreativeDeepSeekAdvisor` instance (same conditional pattern as `CatalogDeepSeekAdvisor`), then add `creativeDeepSeekAdvisor` to the return object.
- [x] 2.4 In `packages/agent/src/index.ts`, export `CreativeDeepSeekAdvisor` class and all related types.

## Phase 3: Daemon Enrichment

- [x] 3.1 In `creativeAssetsDaemon.ts`, after rule-based detection: if `advisor` present and critical + warning findings exist, call `advisor.analyze()` with actionable findings. Attach `aiEnrichment` to critical and warning proposal payloads. Wrap in isolated try/catch.
- [x] 3.2 In `creativeCommercialDaemon.ts`, after rule-based detection: if `advisor` present and warning findings exist, call `advisor.analyze()` with actionable findings. Attach `aiEnrichment` to warning proposal payload only (info stays rule-based). Wrap in isolated try/catch.

## Phase 4: Verification

- [x] 4.1 Run `cd packages/agent && npx vitest run 2>&1 | tail -5` to confirm tests pass.
- [x] 4.2 Write verify report to `openspec/changes/creative-proactive-intelligence/verify-report.md`.
