## Exploration: CEO Operational Intelligence Bridge

### Current State

The codebase has three layers that EXIST but are NOT connected:

1. **Cache blocks** (`packages/agent/src/conversation/cacheBlocks.ts`): Defines a 3-block prefix-anchored cache strategy (Block A = system prompt, Block B = daily aggregates, Block C = Cortex context). Block B is entirely hardcoded placeholder data via `defaultDataSource` — fixed category stats, monthly volume, and reputation. The `DailyDataSource` interface is designed for injection but no operational implementation exists.

2. **Operational read model** (`packages/memory/src/operationalReadModel.ts`): SQLite store with 8 snapshot kinds (listing, order, claim, question, message, reputation, listing-prices, product-ads-insights) plus ingestion checkpoints. Background ingestion (`packages/agent/src/conversation/backgroundIngestion.ts`) dual-writes to BOTH Cortex and the operational DB. But nothing READS from the operational DB — it's a write-only sink.

3. **Agent loop** (`packages/agent/src/conversation/agentLoop.ts`): Uses its own `buildMessages()` that crafts a simple system prompt + history + user message. Does NOT use `assembleMessages()` from cacheBlocks. The 3-block cache architecture exists in parallel, unused in the production conversation path.

The `get_business_context` tool reads from Cortex (graph engine), not the operational DB. Cortex has historical/relational data, while the operational DB has freshness-tracked snapshots. They are complementary.

### Affected Areas

- `packages/agent/src/conversation/cacheBlocks.ts` — Block B (`buildDailyAggregates`) and `DailyDataSource` interface need an operational implementation
- `packages/memory/src/operationalReadModel.ts` — Reader interface is ready but unused; may need aggregate query helpers
- `packages/agent/src/conversation/lanes.ts` — Lane contracts define `requiredEvidenceKinds` (abstract concepts) that don't map to `BusinessSignalKind` (concrete)
- `packages/agent/src/conversation/backgroundIngestion.ts` — Already dual-writes to operational DB; no changes needed for the write side
- `packages/agent/src/conversation/agentLoop.ts` — `buildMessages()` needs to adopt the 3-block cache strategy OR the operational bridge feeds into the existing system prompt assembly
- `packages/agent/src/conversation/tools.ts` — `get_business_context` reads from Cortex only; may need operational DB awareness or a separate tool
- `packages/domain/src/cacheFreshness.ts` — `BusinessSignalKind` values define the queryable snapshot kinds

### Approaches

1. **Minimal wiring: OperationalDailyDataSource**
   — Implement `DailyDataSource` backed by `OperationalReadModelReader`. Query listing/reputation/order snapshots, aggregate them into the daily-aggregate format, and inject into `buildDailyAggregates()`.
   - Pros: Smallest change; clean injection through existing interface; Block B becomes real
   - Cons: Only fixes the CEO lane's daily summary; doesn't give specialist lanes their own evidence subsets; doesn't solve the agent loop's lack of cache-block usage
   - Effort: Low

2. **Bridge module: OperationalEvidenceProvider**
   — Create a new module that maps `requiredEvidenceKinds` (from lanes) → `BusinessSignalKind` queries → formatted per-lane evidence blocks. Wire into both cache blocks AND an updated `buildMessages()` in the agent loop.
   - Pros: Solves the full problem — CEO gets aggregated daily view, specialist lanes get role-specific evidence; integrates the 3-block cache strategy into the real conversation path; clean separation of concerns
   - Cons: More design work; needs the evidence-kind mapping table; touches the agent loop's message assembly
   - Effort: Medium

3. **Read-model-first replacement**
   — Deprecate `get_business_context`'s Cortex dependency for operational queries. Add a new `get_operational_context` tool that reads from `OperationalReadModelReader` directly, and wire Block B through an operational data source.
   - Pros: Operational DB becomes authoritative for freshness-aware queries; clear separation from Cortex's historical/graph role
   - Cons: Breaks existing tool contract; Cortex loses its main reader (already `buildDailyContext` and `get_business_context` both use it); high risk of regression
   - Effort: High

### Recommendation

**Approach 2: Bridge module (OperationalEvidenceProvider)** — with Approach 1 as the first deliverable.

Rationale:
- The `DailyDataSource` interface is already designed for injection — implementing it against the operational DB is straightforward and immediately makes Block B real.
- The lane contracts' `requiredEvidenceKinds` are the RIGHT abstraction for per-lane filtering, but they need a mapping to concrete signal kinds. This is a design task, not a code volume problem.
- The agent loop's `buildMessages()` not using cache blocks is a separate concern — the bridge should produce formatted context strings that the agent loop CAN consume, without forcing a full message-assembly refactor in the first slice.
- `get_business_context` (Cortex) should be kept for deep/historical queries. The operational bridge handles daily freshness-tracked data.

**Deliverable 1 (Approach 1):** Implement `OperationalDailyDataSource` in `packages/agent/src/bridge/` that reads from `OperationalReadModelReader` and builds the same contract as `defaultDataSource`. Inject it into `buildDailyAggregates()`. This unblocks CEO daily intelligence immediately.

**Deliverable 2 (Approach 2):** Create `OperationalEvidenceProvider` with:
- A mapping table: `LaneEvidenceKind → BusinessSignalKind[]`
- `getEvidenceForLane(laneId, sellerId) → formatted context string`
- Integration into the agent loop: pre-pend lane-specific operational context to the system prompt (separate from the token-0 stable prefix to preserve cache hit rate)

### Risks

- **Evidence-kind mapping ambiguity**: Lane evidence kinds ("cost", "supplier", "catalog") are abstract and don't map 1:1 to concrete signal kinds. The mapping will need to be designed carefully and may need per-lane customization beyond a simple table.
- **Cache hit rate regression**: Adding volatile operational data to the token-0 prefix (Block B) WILL break the DeepSeek prefix cache. The current 24h TTL on Block B is key — as long as the operational data changes at most daily, cache hit rate stays >90%. If we inject more volatile data (e.g., per-lane evidence blocks updated every turn), those must go outside the stable prefix.
- **Operational DB write timing**: Background ingestion runs every 6h. The operational DB may be stale for up to 6h unless we also add on-demand refresh paths.

### Ready for Proposal

**Yes.** The exploration confirms the gap and identifies a clean two-phase approach. The orchestrator should proceed to proposal phase with the following scope:

- Phase 1 (minimal bridge): `OperationalDailyDataSource` replacing placeholder daily aggregates
- Phase 2 (per-lane evidence): `OperationalEvidenceProvider` with lane-specific evidence subsets
- Phase 3 (integration): Wire bridge output into the agent loop's message assembly
- Explicitly out of scope: replacing `get_business_context`'s Cortex dependency
