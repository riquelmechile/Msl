# Proposal: AI Reasoning for Operations Manager Signals

## Intent

The operations daemon detects claims, reputation drops, unanswered questions, and delayed orders — but all findings are rule-based with zero reasoning. 14 claim/message/reputation tools exist but are never used proactively. Add AI enrichment for critical signals (claims + reputation) following the same hybrid pattern used in supplier-mirror-proactive-intelligence.

## Scope

### In Scope
- `OperationsDeepSeekAdvisor` class (mirrors `SupplierMirrorDeepSeekAdvisor` pattern) using `DeepSeekReasoningGateway`
- Daemon calls advisor for **claims** (critical) and **reputation** (warning) signals after rule detection
- Append `aiEnrichment` field to CEO proposals with advisor findings
- Unify `unansweredQuestionsWatcher` logic into the advisor (remove standalone watcher)
- Graceful fallback: advisor unavailable → rule-only proposals

### Out of Scope
- Enriching delayed-order or unanswered-question signals with AI (rule-only stays rule-only)
- Modifying `DeepSeekReasoningGateway` or `OperationalReadModelReader`
- Changing daemon cadence or detection thresholds
- Adding reasoning to any other daemon

## Capabilities

### New Capabilities
- `operations-ai-advisor`: proactive AI analysis for claim and reputation signals via DeepSeek, with unified question-watching

### Modified Capabilities
- `daemon-scheduler`: operations-manager daemon gains optional advisor dependency; unanswered-questions lane removed

## Approach

**Hybrid: rule detection + AI enrichment for claims and reputation only.**

After the operations daemon detects open claims or low reputation, inject an advisor call before enqueue:

1. Build focused evidence context (claim snapshots, reputation history, recent notices, Cortex metadata)
2. Call `OperationsDeepSeekAdvisor.analyze()` — `ReasoningLevel.Classification` (~$0.01/call)
3. On success: merge findings into `aiEnrichment` on proposal payload
4. On failure: log, skip, proceed with rule-only proposal

Unanswered-questions watcher is absorbed as a secondary concern of the advisor, removing a redundant class.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/operationsDeepSeekAdvisor.ts` | New | Advisor class, ~150 loc |
| `packages/agent/src/workers/operationsManagerDaemon.ts` | Modified | Inject advisor call after claim/reputation detection |
| `packages/agent/src/workers/unansweredQuestionsWatcher.ts` | Removed | Logic unified into advisor |
| `packages/agent/src/workers/daemonTypes.ts` | Modified | `DaemonHandler` gains optional `operationsAdvisor` |
| Proposal payload shape | Modified | New `aiEnrichment` optional field |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| API cost runaway | Low | Classification level only; claims + reputation signals are low-frequency |
| Advisor latency blocks daemon | Low | Gateway has 5s timeout; isolated try/catch per signal |
| Low-quality findings | Medium | Rule-only baseline always delivered; CEO sees both |

## Rollback Plan

Remove `operationsAdvisor` from daemon context (1 line). Daemon reverts to rule-only proposals. `aiEnrichment` is optional and ignored when absent.

## Dependencies

- `DeepSeekReasoningGateway` (deployed)
- `OperationalReadModelReader` (already in daemon context)
- `Cortex` / `GraphEngine` (already in daemon context)

## Success Criteria

- [ ] Claim and reputation proposals include `aiEnrichment` when advisor is available
- [ ] Advisor failures never block proposal enqueue
- [ ] `unansweredQuestionsWatcher` is removed; question alerts still fire via advisor
- [ ] Delayed-order proposals remain unchanged (no AI enrichment)
