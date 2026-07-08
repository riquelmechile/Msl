# Proposal: Proactive AI Enrichment for Stock-Gap Signals

## Intent

The daemon detects cross-account stock discrepancies but enqueues raw CEO proposals with no reasoning. The advisor CAN reason but only runs on-demand. Connect them so stock-gap signals get automated AI enrichment before reaching the CEO.

## Scope

### In Scope
- Daemon calls `SupplierMirrorDeepSeekAdvisor.analyze()` after detecting a stock-gap signal
- Append advisor findings as `aiEnrichment` field on the proposal payload
- Load extra context (policies, notifications, fallback policies) for critical signals only
- Graceful fallback: advisor failure → rule-only proposal (daemon already has try/catch per signal)
- Hourly deduplication for advisor calls to control API costs

### Out of Scope
- Enriching price-change or unfilled-mirror signals (rule-only stays rule-only)
- Vision AI, new advisor capabilities, or advisor-side changes
- Changing the 15-min daemon cadence or signal detection logic
- Adding reasoning to any other daemon

## Capabilities

### New Capabilities
None — this extends existing capabilities.

### Modified Capabilities
- `supplier-mirror`: new requirement for daemon-initiated proactive AI analysis and `aiEnrichment` payload contract
- `supplier-manager-daemon`: daemon acquires an optional advisor dependency and enriches stock-gap proposals

## Approach

**Hybrid: rule-based detection + AI enrichment for critical signals only.**

After the daemon detects a stock gap and creates the finding (line 177), inject an advisor call before the proposal enqueue phase:

1. Build a focused `SupplierMirrorAnalysisInput` with supplier ID, name, and a stock-gap-specific question
2. Call `advisor.analyze()` — same gateway, same `ReasoningLevel.Classification` (Flash, ~$0.01/call)
3. On success: merge findings into `aiEnrichment` on the proposal payload
4. On failure: log, skip enrichment, proceed with rule-only proposal
5. Deduplicate: one advisor call per (supplier, supplierItemId, hourKey) using the same idempotency key pattern

No advisor changes needed — `analyze()` already accepts `question` and gathers all five evidence sources.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/workers/supplierManagerDaemon.ts` | Modified | Inject advisor call after stock-gap detection, enrich proposal payload |
| `packages/agent/src/conversation/supplierMirrorDeepSeekAdvisor.ts` | None | Used as-is; no changes required |
| Proposal payload shape | Modified | New `aiEnrichment` optional field |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| API cost runaway | Low | Deduped hourly per item; Flash model (~$0.01/call); only stock-gap signals (rarest of three) |
| Advisor latency blocks daemon | Low | Advisor already has 5s timeout; isolated try/catch; daemon stays responsive |
| Advisor returns low-quality findings | Medium | Rule-only baseline always delivered; CEO sees both; advisor quality improves with usage |
| No advisor instance available | Low | Optional dependency; daemon skips enrichment gracefully |

## Rollback Plan

Remove the advisor call block from the daemon (3 lines). Daemon reverts to rule-only proposals. No data migration needed — `aiEnrichment` field is optional and ignored when absent.

## Dependencies

- `DeepSeekReasoningGateway` (already deployed, already used by advisor)
- `SupplierMirrorDeepSeekAdvisor` (no changes needed)
- `SupplierMirrorStore` (already available in daemon context)

## Success Criteria

- [ ] Stock-gap CEO proposals include `aiEnrichment` with advisor findings when advisor is available
- [ ] Advisor failures do not block proposal enqueue
- [ ] Hourly deduplication prevents duplicate advisor calls for the same signal
- [ ] Price-change and unfilled-mirror proposals remain unchanged (no enrichment)
