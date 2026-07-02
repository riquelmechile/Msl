# Proposal: CEO Operational Intelligence Bridge

## Intent

Wire the write-only operational DB to the CEO and specialist lanes via the 3-block cache strategy. Replace hardcoded Block B placeholders with real operational summaries, and feed per-lane operational evidence into Block C alongside Cortex context. Keep volatile evidence outside stable prefixes to preserve DeepSeek cache economics.

## Scope

### In Scope
- `OperationalDailyDataSource` implementing `DailyDataSource` backed by `OperationalReadModelReader` (categories, volume, reputation from operational snapshots)
- `OperationalEvidenceProvider` with hardcoded lane→signal-kind mapping, producing formatted per-lane context strings
- Inject per-lane operational evidence into Block C (refreshable context) in `agentLoop.buildMessages()`
- Surfacing freshness metadata (`captured_at`, staleness) in all operational summaries so the LLM knows when data may be stale

### Out of Scope
- On-demand refresh or real-time snapshot fetching — 6h background cycle accepted as-is
- Config-driven lane→signal mapping — hardcoded table, config-driven later
- Replacing `get_business_context`'s Cortex dependency
- Modifying `backgroundIngestion.ts` (already dual-writes correctly)

## Capabilities

### New Capabilities
- `operational-lane-evidence`: Hardcoded mapping from `LaneContract.requiredEvidenceKinds` to `BusinessSignalKind[]`, querying `OperationalReadModelReader` for formatted per-lane context strings injected into Block C

### Modified Capabilities
- `conversational-business-agent`: Block B daily aggregates are now populated from operational DB (not hardcoded placeholders); Block C now includes both Cortex context AND per-lane operational evidence; all operational summaries include freshness metadata

## Approach

Three units, same package (`packages/agent/src/conversation/`), no new packages:

1. **`OperationalDailyDataSource`** (~80 lines): Implements `DailyDataSource`. `getCategoryStats()` queries listing snapshots grouped by category. `getMonthlyVolume()` sums order totals. `getReputation()` reads reputation snapshots. Injected into `buildDailyAggregates()`.

2. **`OperationalEvidenceProvider`** (~120 lines): Hardcoded lane→signal mapping (`{"cost": ["listing","order"], "supplier": ["listing"], "catalog": ["listing","order","claim"], …}`). `getEvidenceForLane(laneId, sellerId)` queries `findEvidence` per signal kind and formats context with evidence IDs and `captured_at` timestamps.

3. **Agent loop integration** (~100 lines): Extend `buildMessages()` to accept optional operational context, inject it into Block C alongside Cortex output. `AgentLoopConfig` gains optional `operationalReader` and `evidenceProvider` fields.

Total: ~300–350 changed lines, 2 new files.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/cacheBlocks.ts` | Modified | Wire `OperationalDailyDataSource` into `buildDailyAggregates()` |
| `packages/agent/src/conversation/agentLoop.ts` | Modified | Extend `buildMessages()` and `AgentLoopConfig` |
| `packages/agent/src/conversation/` | New file | `operationalDataSource.ts` |
| `packages/agent/src/conversation/` | New file | `operationalEvidenceProvider.ts` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Freshness metadata inflates token budget | Low | Compact format (~20 tokens per snapshot) |
| Lane evidence kinds map poorly to signals | Medium | Hardcoded table is small and reviewable; expand later |
| Cache hit rate regression from Block C expansion | Low | Block C was already per-query; ~500–2K token addition |

## Rollback Plan

Revert `buildDailyAggregates()` to use `defaultDataSource` (no injection). Remove `operationalEvidenceProvider.ts` and `operationalDataSource.ts`. Drop the two new fields from `AgentLoopConfig`. All changes are additive wiring — no existing interfaces broken.

## Dependencies

- `OperationalReadModelReader` (`@msl/memory`) — already exists, no changes needed
- `BusinessSignalKind` (`@msl/domain`) — already exists
- Background ingestion (`backgroundIngestion.ts`) — already dual-writes, no changes needed

## Success Criteria

- [ ] `buildDailyAggregates()` with `OperationalDailyDataSource` returns real category stats, volume, and reputation from operational DB
- [ ] `OperationalEvidenceProvider.getEvidenceForLane()` returns formatted context per lane contract
- [ ] Agent loop injects per-lane operational evidence into Block C without breaking existing conversation flow
- [ ] All operational summaries include `captured_at` timestamps so the LLM can reason about staleness
- [ ] Existing tests pass — no regression in mock/noop agent paths
