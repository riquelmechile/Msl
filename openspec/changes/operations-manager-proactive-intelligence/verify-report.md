# Verification Report: AI Reasoning for Operations Manager Signals

**Change**: `operations-manager-proactive-intelligence`  
**Verified**: 2026-07-08  
**Mode**: Full artifact verification (proposal + specs + design + tasks + implementation)  
**Verdict**: **FAIL** — 1 critical issue blocks production readiness

---

## Completeness

| Dimension | Status | Notes |
|---|---|---|
| Tasks complete | **9/11** | 5.1, 5.2 unchecked — no test files created |
| Spec compliance | **Partial** | `prioritizedActions` field name mismatch with implementation (uses `findings`) |
| Design coherence | **Partial** | `OperationsAnalysisInput` simplified vs design; `cortex` + `unansweredQuestions` removed |
| Tests passing | **1726/1728** | 2 pre-existing agentLoop streaming timeouts, not from this change |

---

## Build / Tests / Coverage

```json
{
  "build": "not run (typecheck-only project)",
  "tests": {
    "files": 68,
    "passed_files": 67,
    "failed_files": 1,
    "total_tests": 1728,
    "passed_tests": 1726,
    "failed_tests": 2,
    "failures_pre_existing": true,
    "failure_detail": "agentLoop.test.ts — 2 DeepSeek streaming/channel timeout tests (pre-existing)"
  },
  "coverage": "not measured"
}
```

**Pre-existing failures** (not introduced by this change):

| Test | File | Root Cause |
|------|------|------------|
| "passes lane and seller user_id to OpenAI SDK chat completions" | `agentLoop.test.ts` | 5000ms timeout |
| "passes lane and seller user_id to OpenAI SDK streaming completions" | `agentLoop.test.ts` | 5000ms timeout |

---

## Task Completion Table

| Task | Status | Evidence |
|------|--------|----------|
| 1.1 Create `operationsDeepSeekAdvisor.ts` | ✅ | File exists, ~138 loc, mirrors supplier pattern |
| 2.1 Add `operationsAdvisor` to `DaemonHandler` | ✅ | `daemonTypes.ts` line 85 |
| 2.2 Add `operationsAdvisor` to `DaemonSchedulerConfig` + pass to handler | ✅ | `daemonScheduler.ts` lines 45, 138 |
| 2.3 Instantiate advisor in `agentLoop.ts` | ⚠️ **PARTIAL** | Instantiated (lines 359–366) but **NOT returned** from `createAgentLoop` |
| 2.4 Export from `index.ts` | ✅ | Lines 167–172 |
| 3.1 Call `advisor.analyze()` in daemon | ✅ | `operationsManagerDaemon.ts` lines 267–284 |
| 3.2 Append `aiEnrichment` to proposals + try/catch | ✅ | Lines 286–297, 336–338 |
| 4.1 Remove `unansweredQuestionsWatcher` | ✅ | File deleted, all imports removed |
| 4.2 Keep `"unanswered-questions"` in `LaneId` | ✅ | `lanes.ts` line 15 |
| 5.1 Unit test `operationsDeepSeekAdvisor.test.ts` | ❌ | No file exists |
| 5.2 Integration test for daemon + advisor | ❌ | No file exists |

---

## Spec Compliance Matrix

### `specs/operations-manager/spec.md`

| Scenario | GIVEN | Expected | Actual | Status |
|----------|-------|----------|--------|--------|
| Claims enriched with AI | Daemon detects open claims, advisor available | `aiEnrichment` in payload with `prioritizedActions` | `aiEnrichment` present with `findings` (field name mismatch: `findings` ≠ `prioritizedActions`) | **WARNING** |
| Reputation signals enriched with AI | Daemon detects low reputation, advisor available | `aiEnrichment` in payload | Same mismatch — `findings` in payload | **WARNING** |
| Advisor failure → rule-only | `analyze()` throws/times out | Log error, skip enrichment, enqueue rule-only | Try/catch at lines 292–297; log + skip + enqueue | ✅ **PASS** |
| Delayed orders remain rule-only | Daemon detects delayed order | No `aiEnrichment`, no advisor call | Advisor only called when `hasClaims || hasReputationIssues` (line 267) | ✅ **PASS** |
| Unanswered questions remain rule-only | Daemon detects unanswered question >24h | No `aiEnrichment`, no advisor call | Questions processed rule-only (lines 193–214); advisor guard excludes them | ✅ **PASS** |

### `specs/operations-manager-daemon/spec.md`

| Scenario | GIVEN | Expected | Actual | Status |
|----------|-------|----------|--------|--------|
| Signal enrichment with advisor | Advisor present, signals detected | `aiEnrichment` with `prioritizedActions` + `summary` | `findings` + `summary` (field name mismatch) | **WARNING** |
| Graceful fallback on advisor failure | Advisor present, `analyze()` fails | Log error, enqueue rule-only, no crash | Try/catch isolates; daemon continues (line 292–297) | ✅ **PASS** |
| Rule-only when no advisor | No `operationsAdvisor` provided | All proposals rule-only, no `aiEnrichment` | Guard at line 267 checks `operationsAdvisor` falsy → skips | ✅ **PASS** |
| Signal scoping — non-enriched signals excluded | Advisor present, delayed orders or unanswered questions | No advisor call, proposals rule-only | Advisor guard (line 267) excludes non-claim/reputation signals | ✅ **PASS** |

---

## Correctness Table

| Requirement | Status | Detail |
|---|---|---|
| `OperationsDeepSeekAdvisor` mirrors `SupplierMirrorDeepSeekAdvisor` pattern | ✅ | Lazy gateway, `ReasoningLevel.Classification`, JSON parse with fallback, same telemetry shape |
| Advisor analyzes claims + reputation only | ✅ | Guard at line 267: `(hasClaims || hasReputationIssues)` |
| `aiEnrichment` only on critical + warning groups | ✅ | Lines 336–338: enrichment passed only to critical and warning enqueue calls |
| Delayed orders unchanged | ✅ | No advisor call path; rule-only detection preserved |
| Questions detected + rule-only | ✅ | Detection preserved in daemon (lines 193–214); advisor not called for questions |
| `unansweredQuestionsWatcher` fully removed | ✅ | File deleted; zero references in codebase; `LaneId` retains backward compat entry |
| Try/catch isolation per signal | ✅ | Single try/catch wraps advisor call; on failure: log + skip + continue |
| Gate for `ReasoningLevel.Classification` | ✅ | Advisor passes `ReasoningLevel.Classification` to `gateway.reason()` |

---

## Design Coherence Table

| Decision | Design Says | Implementation | Status |
|----------|-------------|----------------|--------|
| Advisor pattern | Mirror `SupplierMirrorDeepSeekAdvisor` exactly | ✅ Lazy gateway, same constructor shape, same telemetry return | ✅ |
| `OperationsAnalysisInput` shape | `{ openClaims, reputationSnapshot, unansweredQuestions, sellerIds, cortex }` | `{ sellerId, openClaims, reputationScore, question? }` | **WARNING** — simplified; `cortex` and `unansweredQuestions` removed |
| `aiEnrichment` payload field | `findings` array | `findings` array | ✅ (but spec says `prioritizedActions`) |
| Daemon data flow | ReadModel → advisor.analyze → merge into proposal → bus.enqueue | Exact flow implemented at lines 40–353 | ✅ |
| `unansweredQuestionsWatcher` removal | Remove standalone daemon + lane entry | File deleted; lane ID kept in type union as spec'd | ✅ |
| Advisor instantiation gate | `openai && config.workforceCostCacheLedgerStore` | Guard at lines 360 matches | ✅ |

---

## Issues

### CRITICAL

| ID | Issue | Evidence |
|----|-------|----------|
| C1 | **`operationsDeepSeekAdvisor` is never returned from `createAgentLoop`**. The advisor is constructed as a local variable (agentLoop.ts:359–366) but the return object (lines 674–987) does not include it. The comment at line 356 says "Lazily passed to the daemon scheduler via createAgentLoop return" — this is dead documentation. Callers of `createAgentLoop` cannot pass the advisor to `startDaemonScheduler`, so the daemon will always run rule-only at runtime. | `agentLoop.ts` return value has `converse`, `converseStream`, `updateStrategy`, `getToolNames` — no `operationsDeepSeekAdvisor` | | **Fix**: Add `operationsDeepSeekAdvisor` to the return object of `createAgentLoop`. E.g.: |
| | | ```typescript return { converse, converseStream, updateStrategy, getToolNames, operationsDeepSeekAdvisor, }; ``` |
| | | Callers then extract it for `startDaemonScheduler({ ..., operationsAdvisor: loop.operationsDeepSeekAdvisor })`. |

### WARNING

| ID | Issue | Detail |
|----|-------|--------|
| W1 | **Spec says `prioritizedActions`, implementation says `findings`** | Both specs (`operations-manager/spec.md`, `operations-manager-daemon/spec.md`) require `aiEnrichment.prioritizedActions`. Design.md and implementation use `aiEnrichment.findings`. Either the spec should be updated or the field renamed. |
| W2 | **`OperationsAnalysisInput` diverges from design** | Design includes `cortex: GraphEngine`, `unansweredQuestions`, and `reputationSnapshot: { score, color }`. Implementation uses `reputationScore: number`, `question?: string`, and no `cortex`. This is a simpler but different contract. |
| W3 | **Tasks 5.1 and 5.2 not completed** | Unit test file `tests/workers/operationsDeepSeekAdvisor.test.ts` and integration test in `operationsManagerDaemon.test.ts` were not created. |
| W4 | **`agentLoop.test.ts` has 2 pre-existing timeout failures** | Not introduced by this change but degrades confidence in CI signal. Worth fixing separately. |

### SUGGESTION

| ID | Issue |
|----|-------|
| S1 | The advisor returns `analysis.modelUsed` and telemetry but the daemon only stores `findings`, `summary`, `modelUsed`, and `enrichedAt` — `costMicros` and token stats are discarded. Consider storing full telemetry for workforce cost tracking. |

---

## Verification Artifact Summary

| Artifact | Path | Status |
|----------|------|--------|
| Advisor class | `packages/agent/src/conversation/operationsDeepSeekAdvisor.ts` | ✅ Created |
| Daemon types wiring | `packages/agent/src/workers/daemonTypes.ts` | ✅ Modified |
| Scheduler wiring | `packages/agent/src/workers/daemonScheduler.ts` | ✅ Modified |
| Agent loop instantiation | `packages/agent/src/conversation/agentLoop.ts` | ⚠️ Created but not returned |
| Index exports | `packages/agent/src/index.ts` | ✅ Modified |
| Daemon enrichment | `packages/agent/src/workers/operationsManagerDaemon.ts` | ✅ Modified |
| Watcher removal | `packages/agent/src/workers/unansweredQuestionsWatcher.ts` | ✅ Deleted |
| Backward compat | `packages/agent/src/conversation/lanes.ts` | ✅ `"unanswered-questions"` retained |
| Advisor unit test | `tests/workers/operationsDeepSeekAdvisor.test.ts` | ❌ Missing |
| Daemon integration test | `tests/workers/operationsManagerDaemon.test.ts` (advisor paths) | ❌ Missing |

---

## Next Steps

1. **Fix C1**: Return `operationsDeepSeekAdvisor` from `createAgentLoop` so callers can inject it into the daemon scheduler.
2. **Resolve W1/W2**: Align spec field names (`prioritizedActions` → `findings`) or align implementation. Same for `OperationsAnalysisInput` shape.
3. **Implement 5.1**: Add unit tests for prompt construction, JSON parse fallback, and empty findings on invalid response.
4. **Implement 5.2**: Add integration tests for daemon with mock advisor, verifying `aiEnrichment` presence and rule-only fallback.
