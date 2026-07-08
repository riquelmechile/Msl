# Proposal: Creative Proactive Intelligence

## Intent

Add proactive AI enrichment to the creative daemon signals so the CEO receives contextual, prioritized recommendations instead of raw rule-based findings. The `CreativeDeepSeekAdvisor` will analyze detected signals from both `creativeAssetsDaemon` and `creativeCommercialDaemon` and produce structured, prioritized insight.

## Scope

### In Scope
- Create `CreativeDeepSeekAdvisor` class covering both creative daemons
- Enrich `creativeAssetsDaemon` critical + warning signals (moderated-in-campaign, low image count, moderation blocked, poor PICTURES score, high-traffic poor creative)
- Enrich `creativeCommercialDaemon` warning signal (high-visit low-conversion)
- Wire advisor through `daemonTypes.ts`, `daemonScheduler.ts`, `agentLoop.ts`, `index.ts`
- Follow exact same hybrid pattern as supplier/operations/market-catalog advisors

### Out of Scope
- Vision AI or image generation
- New daemon handler signals or rule changes
- Creative candidate or stagnant stock enrichment (info-only stays rule-based)
- Background ingestion changes
- MercadoLibre write APIs or mutation paths

## Capabilities

### New Capabilities
- `creative-proactive-intelligence/creative-assets-enrichment`: AI enrichment for creative asset quality signals
- `creative-proactive-intelligence/creative-commercial-enrichment`: AI enrichment for commercial conversion signals

### Modified Capabilities
- `daemon-scheduler`: Accept `creativeAdvisor` in config and pass to handlers
- `agent-loop`: Create and return `CreativeDeepSeekAdvisor` from `createAgentLoop()`

## Approach

Create a `CreativeDeepSeekAdvisor` class following the exact pattern of `CatalogDeepSeekAdvisor` and `OperationsDeepSeekAdvisor`:
- Lazy `DeepSeekReasoningGateway` initialization
- Spanish system prompt defining the creative analyst role
- Structured JSON output with findings, summary, and cost telemetry
- Isolated try/catch — enrichment failure falls back to rule-only proposal

Each daemon calls `advisor.analyze()` with its critical + warning findings, then attaches the enrichment to the proposal payload as `aiEnrichment`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/creativeDeepSeekAdvisor.ts` | New | Advisor class for creative signal enrichment |
| `packages/agent/src/workers/daemonTypes.ts` | Modify | Add `creativeAdvisor` optional field |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Accept and pass `creativeAdvisor` |
| `packages/agent/src/workers/creativeAssetsDaemon.ts` | Modify | Call advisor for critical + warning findings |
| `packages/agent/src/workers/creativeCommercialDaemon.ts` | Modify | Call advisor for warning findings |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | Create and return `CreativeDeepSeekAdvisor` |
| `packages/agent/src/index.ts` | Modify | Export advisor class and types |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| DeepSeek API failure delays daemon cycle | Low | Isolated try/catch — rule-only fallback |
| Cost overrun from AI enrichment | Low | Only critical + warning signals enriched |
| Review size exceeds 400 lines | Low | ~300 lines total with focused changes |

## Rollback Plan

Remove the `creativeAdvisor` parameter from `daemonTypes.ts`, revert daemon changes, remove advisor creation from `agentLoop.ts`, and delete `creativeDeepSeekAdvisor.ts`. Existing rule-based findings continue working.

## Dependencies

- Existing `DeepSeekReasoningGateway` and `ReasoningLevel`
- Existing `WorkforceCostCacheLedgerStore` for cost tracking

## Success Criteria

- [ ] `CreativeDeepSeekAdvisor` produces structured enrichment JSON for creative asset signals
- [ ] `CreativeDeepSeekAdvisor` produces structured enrichment JSON for commercial signals
- [ ] Enrichment is attached to CEO proposals only for critical + warning severity
- [ ] Advisor failure does not block the daemon cycle (rule-only fallback)
- [ ] Advisor is created in `createAgentLoop()` and returned for scheduler consumption
