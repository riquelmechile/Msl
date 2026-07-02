# Proposal: Operational Read Model Ingestion

## Intent

Create the first durable, local-first operational read model so CEO/seller lanes can cite fresh catalog evidence without repeatedly calling MercadoLibre or spending LLM tokens on raw API payloads.

## Problem

Operational facts are currently mixed into Cortex learning nodes or fetched ad hoc. That makes evidence IDs, freshness, completeness, and API/cache economics hard to audit.

## Goals / Non-Goals

### In Scope
- SQLite-backed operational read model in `@msl/memory` for listing/catalog snapshots and refresh checkpoints only.
- Three partitions: Plasticov lane, Maustian lane, and CEO aggregate/orchestration view.
- Stable evidence IDs, freshness, completeness, confidence, and source-of-truth boundaries.
- Compact summaries/aggregates shaped for DeepSeek 1M-context cached prefixes without treating provider cache as memory.

### Out of Scope
- ML mutations, publishing, approval execution, and durable DeepSeek memory.
- Orders, messages, claims, payments, SII, reputation, or customer workflows beyond deferred read-only future slices.
- Hardcoded universal business utility formulas; utility remains user-defined and learned over time.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `business-memory-cache`: persist listing/catalog operational snapshots, checkpoints, evidence metadata, and local-first read semantics.
- `multi-agent-orchestration`: define seller-lane partitions plus CEO aggregate/orchestration read view.
- `neural-graph-memory`: preserve Cortex as learned judgment, not catalog source of truth.
- `mercadolibre-account-integration`: enforce seller-scoped protected reads for each lane.

## Proposed First Slice

Implement `createSqliteOperationalReadModel(db)` in `packages/memory/src/operationalReadModel.ts`, dual-write listing snapshots from background ingestion, and expose local read/query helpers before remote refresh.

## Lane Topology

| Lane | Scope | Responsibility |
|------|-------|----------------|
| Plasticov | Seller partition | Own listings/checkpoints/evidence |
| Maustian | Seller partition | Own listings/checkpoints/evidence |
| CEO | Aggregate view | Compare, orchestrate, cite seller evidence |

## Data / Cache Economics

Store normalized JSON plus small aggregate summaries. Prompts should keep stable lane policy/summary prefixes cacheable and place volatile evidence outside immutable prefixes to exploit DeepSeek cached-input pricing safely.

## Safety

MercadoLibre remains source of truth. Local reads must disclose stale/partial evidence and trigger refresh-needed states instead of claiming current truth.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/memory/src/operationalReadModel.ts` | Modified | SQLite implementation |
| `packages/memory/src/index.ts` | Modified | Export factory |
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modified | Listing dual-write |
| `packages/domain/src/cacheFreshness.ts` | Modified | Evidence/checkpoint helpers if needed |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Scope creep | Med | Listing/checkpoints only |
| Stale data misuse | Med | Explicit freshness/completeness states |
| Cache waste | Med | Compact stable summaries, volatile evidence outside prefixes |
| Seller leakage | Low | Seller partition keys and tests |

## Rollback Plan

Disable operational-store wiring and continue existing Cortex/background ingestion. Keep migrations additive; drop new tables only after export/backfill is unnecessary.

## Success Criteria

- [ ] Fresh listing questions can read local evidence IDs before ML API calls.
- [ ] Plasticov, Maustian, and CEO views remain partition-safe.
- [ ] Stale/partial evidence is visible and never presented as authoritative.
- [ ] Prompt summaries reduce raw catalog/context waste for DeepSeek.

## Next Phase

Write delta specs for the modified capabilities, then design the SQLite schema and ingestion flow.
