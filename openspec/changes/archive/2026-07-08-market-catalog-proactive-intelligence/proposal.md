# Proposal: AI Enrichment for Market Catalog Signals

## Intent

`marketCatalogDaemon` detects 4 rule-based signals (low-visit, above-market pricing, paused-with-history, relist-expiring) but enqueues raw CEO proposals with no reasoning. Follow the same hybrid pattern used by supplier-manager and operations-manager: add a `CatalogDeepSeekAdvisor` that enriches critical/warning signals with AI reasoning before the proposal reaches the CEO.

## Scope

### In Scope
- `CatalogDeepSeekAdvisor` class — mirrors `SupplierMirrorDeepSeekAdvisor` pattern, uses `DeepSeekReasoningGateway`
- Daemon calls advisor for **low-visit** (warning), **above-market** (warning), and **relist-expiring** (critical) signals
- Append `aiEnrichment` with advisor findings to CEO proposal payloads
- Graceful fallback: advisor unavailability/failure → rule-only proposals still fire
- Wire advisor as optional dependency through `daemonTypes.ts` → `daemonScheduler.ts` → `agentLoop.ts`

### Out of Scope
- Enriching paused-with-history (info) signals — those stay rule-only
- Changing detection thresholds, daemon cadence, or signal logic
- Modifying `DeepSeekReasoningGateway` or `OperationalReadModelReader`
- Adding reasoning to any other daemon

## Capabilities

### New Capabilities
- `market-catalog-ai-advisor`: proactive AI analysis of catalog health signals (visibility, pricing, relist prioritization) via DeepSeek

### Modified Capabilities
- `market-catalog-daemon`: daemon acquires optional `catalogAdvisor` input, enriches critical + warning proposals with `aiEnrichment`

## Approach

**Hybrid: rule detection + AI enrichment for critical + warning signals only.**

After the daemon detects low-visit, above-market, or relist-expiring signals:
1. Build focused evidence context (affected listings, visits, category medians, signal severity)
2. Call `CatalogDeepSeekAdvisor.analyze()` — `ReasoningLevel.Classification` (~$0.01/call)
3. On success: merge findings into `aiEnrichment` on the proposal payload
4. On failure: log, skip enrichment, proceed with rule-only proposal

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/catalogDeepSeekAdvisor.ts` | New | Advisor class + types, ~130 loc |
| `packages/agent/src/workers/marketCatalogDaemon.ts` | Modified | Call advisor before enqueue, append `aiEnrichment` |
| `packages/agent/src/workers/daemonTypes.ts` | Modified | Add `catalogAdvisor` to `DaemonHandler` input |
| `packages/agent/src/workers/daemonScheduler.ts` | Modified | Add `catalogAdvisor` to config, pass to handler |
| `packages/agent/src/conversation/agentLoop.ts` | Modified | Instantiate `CatalogDeepSeekAdvisor` |
| `packages/agent/src/index.ts` | Modified | Export advisor + types |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| API cost runaway | Low | Classification level only; 3 signal types; daemon runs every 15 min but findings are low-volume |
| Advisor latency blocks daemon | Low | Gateway has 5s timeout; isolated try/catch per signal group |
| Low-quality findings | Medium | Rule-only baseline always delivered; CEO sees both; advisor improves with usage |
| No advisor instance available | Low | Optional dependency; daemon skips enrichment gracefully |

## Rollback Plan

Remove `catalogAdvisor` from `DaemonSchedulerConfig` + handler call (2 lines). Daemon reverts to rule-only proposals. `aiEnrichment` field is optional and ignored when absent.

## Dependencies

- `DeepSeekReasoningGateway` (already deployed, used by 2 other advisors)
- `OperationalReadModelReader` (already in daemon context)

## Success Criteria

- [ ] Low-visit, above-market, and relist-expiring proposals include `aiEnrichment` when advisor is available
- [ ] Advisor failures never block proposal enqueue
- [ ] Paused-with-history (info) proposals remain unchanged (no AI enrichment)
- [ ] Advisor class follows the same lazy-gateway, telemetry-output pattern as `SupplierMirrorDeepSeekAdvisor`
