# Design: CEO Operational Intelligence Bridge

## Technical Approach

Three composable units, same package, no new dependencies:

1. **`OperationalDailyDataSource`** wraps `OperationalReadModelReader` to implement `DailyDataSource`. Background ingestion writes pre-aggregated snapshot arrays per kind — a single `readSnapshot` call per `getCategoryStats`/`getVolume`/`getReputation` suffices.

2. **`OperationalEvidenceProvider`** holds a hardcoded mapping from lane `requiredEvidenceKinds` strings to `BusinessSignalKind[]`, queries `findEvidence`, and formats compact one-line-per-item context.

3. **Agent loop integration** adds optional `blockC` param to `buildMessages()` and config fields to `AgentLoopConfig`. Evidence injected into user message — outside the cacheable prefix — preserving DeepSeek token-0 cache economics.

## Architecture Decisions

| Decision | Choice | Tradeoff | Rationale |
|---|---|---|---|
| Aggregation model | Single `readSnapshot` per kind (pre-aggregated arrays in `data_json`) | Background ingestion must store arrays, not individual rows | Existing `OperationalReadModelReader` has no bulk query — adopting its contract avoids interface changes |
| Evidence mapping storage | Hardcoded `Map<string, BusinessSignalKind[]>` in `OperationalEvidenceProvider` | Must change code to add lanes; config file later | Proposal scopes config-driven mapping out; hardcoding is small (~9 entries) and reviewable |
| Block C injection point | Append evidence + Cortex to user message in `buildMessages()` via optional `blockC` param | Evidence NOT cacheable (per-turn query); Cortex already per-turn | Keeps Blocks A+B immutable → preserves >90% cache hit rate |
| `buildDailyAggregates` wiring | Caller passes `OperationalDailyDataSource`; function already accepts optional `source` | Caller must own the reader lifecycle | Zero signature changes to cacheBlocks.ts; graceful fallback to hardcoded defaults when no reader configured |

## Data Flow

```
                         ┌─── ──┐
backgroundIngestion.ts   │  ops  │
  (6h cycle, writes       │  DB   │
   aggregated snapshots)  │       │
                         └─── ──┘
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
   OperationalDailyDataSource   OperationalEvidenceProvider
   (readSnapshot per kind)      (findEvidence per signal)
             │                                 │
             ▼                                 │
   buildDailyAggregates()                      │
   → Block B (cached, 24h TTL)                 │
             │                                 │
             ▼                                 ▼
   buildMessages(systemPrompt, state, userMsg, blockC?)
             │
             ▼
   [system: BlockA + BlockB] [history...] [user: msg + BlockC]
    └── token-0 cached ──┘                   └─ per-turn ─┘
```

Block A = immutable identity + rules. Block B = daily ops aggregates (24h TTL, cached). Block C = Cortex traversal + per-lane operational evidence (per-turn, volatile).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/operationalDataSource.ts` | Create | `OperationalDailyDataSource` class implementing `DailyDataSource` via `OperationalReadModelReader` |
| `packages/agent/src/conversation/operationalEvidenceProvider.ts` | Create | `OperationalEvidenceProvider` with hardcoded lane→signal mapping and `getEvidenceForLane()` |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | `buildMessages()` gains optional `blockC`; `AgentLoopConfig` gains `operationalReader?`, `evidenceProvider?`, `laneId?`; `converse()` and `converseStream()` query evidence when config present |

## Interfaces / Contracts

```typescript
// OperationalDailyDataSource — implements existing DailyDataSource
class OperationalDailyDataSource implements DailyDataSource {
  constructor(reader: OperationalReadModelReader, sellerId: SellerId);
  getCategoryStats(): Array<{ name, activeProducts, monthlySales?, marginAvg? }>;
  getMonthlyVolume(): number;
  getReputation(): { level, rating, openClaims, ... };
}

// OperationalEvidenceProvider — new type
type LaneEvidenceMap = Map<string, BusinessSignalKind[]>;

class OperationalEvidenceProvider {
  constructor(reader: OperationalReadModelReader);
  getEvidenceForLane(laneId: LaneId, sellerId: SellerId): Promise<string>;
  // Returns multi-line string with evidence per signal, or "" when no mapping/snapshots
}

// Freshness format per evidence line:
// "[listing] evt-42 captured=2026-07-02T10:00:00Z (fresh, 3h ago)"
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `OperationalDailyDataSource` — each method with mock reader returning snapshot arrays | Vitest, mock `OperationalReadModelReader` |
| Unit | `OperationalEvidenceProvider` — mapping correctness, unknown lane→empty, no data→empty | Vitest, mock reader |
| Unit | `buildMessages()` with blockC — injects evidence into user message, missing blockC works as before | Vitest, no I/O |
| Integration | Full flow: operational DB → data source → formatted Block B | Vitest with in-memory SQLite + real `createSqliteOperationalReadModel` |
| Regression | Existing mock/noop agent paths — `converse()` without operational config | Existing test suite (`npm test`) |

## Migration / Rollout

No migration required. All changes are additive wiring behind optional config fields. Rollback: remove `operationalReader`/`evidenceProvider`/`laneId` from `AgentLoopConfig`; `buildDailyAggregates()` falls back to hardcoded `defaultDataSource` when no source passed.

## Open Questions

- None
