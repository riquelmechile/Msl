# Exploration: Operational Read Model Ingestion

## Current State

The codebase already has the contracts for an operational read model, but no implementation. `@msl/domain` defines `OperationalEvidence`, freshness evaluation, completeness, and confidence helpers; `@msl/memory` exports `OperationalReadModelReader/Writer` interfaces only. Current background ingestion in `@msl/agent` reads MercadoLibre listings, visits, orders, quality, and relist signals, then stores operational snapshots as Cortex graph nodes. That works for heuristics, but it mixes full catalog facts with learned judgment and does not provide stable indexed read-model evidence IDs for CEO/lane outputs.

SQLite is already an accepted persistence pattern across the repo: Cortex uses `better-sqlite3` with WAL and migrations, chat/session/strategy stores add tables to an injected DB handle, approval queue uses a SQLite repository, and sync state has its own SQLite store. MercadoLibre safe reads already normalize snapshots with source, freshness, completeness, confidence, seller scope, and no-mutation boundaries. The first real operational store should reuse those snapshot contracts instead of inventing a parallel model.

## Affected Areas

- `packages/memory/src/operationalReadModel.ts` — currently only interfaces; best home for the SQLite-backed operational read model because it is persistence/business-memory infrastructure and must stay separate from agent orchestration and Cortex learning.
- `packages/memory/src/index.ts` — should export the implementation factory once added, alongside `getSharedDb`, Cortex, and read-model types.
- `packages/domain/src/cacheFreshness.ts` — already defines `OperationalEvidence`; may need only small helper additions for deterministic evidence IDs/checkpoint metadata, not a broad type expansion.
- `packages/domain/src/readSnapshot.ts` — provides `ReadSnapshot` metadata used by MercadoLibre reads and should remain the normalized snapshot boundary.
- `packages/agent/src/conversation/backgroundIngestion.ts` — current ingestion loop persists listing/visit/order snapshots directly into Cortex; the first slice should dual-write catalog/listing snapshots to the operational store first and leave Cortex writes as distilled/legacy signals.
- `packages/agent/src/conversation/lanes.ts` and `agentLoop.ts` — CEO/Market lane contracts already require local catalog evidence and evidence IDs; later slices can read from the operational store before remote reads.
- `packages/mercadolibre/src/index.ts` — safe read methods such as `getListings`, `getItemVisits`, `getOrders`, and related normalizers already return `ReadSnapshot`-compatible metadata.
- `packages/memory/tests/**` and `packages/agent/tests/conversation/**` — best places for store contract tests and ingestion integration tests.

## Approaches

1. **Implement the SQLite operational store in `@msl/memory` and dual-write listings from ingestion** — Add a `createSqliteOperationalReadModel(db)` factory with tables for snapshots, evidence, and ingestion checkpoints; wire only listing/catalog snapshots in the first ingestion slice.
   - Pros: Aligns with existing memory package responsibility, reuses current SQLite dependency, keeps Cortex separate, gives CEO/lane system stable evidence IDs quickly, and keeps PR size reviewable.
   - Cons: Requires careful schema design and a small dependency injection change in background ingestion.
   - Effort: Medium

2. **Keep operational snapshots in Cortex nodes and add query helpers** — Treat current `listing_snapshot_*` Cortex nodes as the read model and expose adapter methods over `GraphEngine.queryByMetadata()`.
   - Pros: Lowest implementation cost and no new schema.
   - Cons: Violates the archived design boundary, preserves poor indexing/checkpoint semantics, keeps full catalog facts mixed with learned judgment, and makes evidence IDs unstable/graph-shaped.
   - Effort: Low

3. **Create a new `@msl/operational-store` package** — Isolate operational persistence in a new workspace package.
   - Pros: Clean boundary if the store grows substantially.
   - Cons: Adds package/build/review overhead before the domain model has proven it needs a separate package; likely exceeds the safest first slice.
   - Effort: High

## Recommendation

Use Approach 1: implement the first real operational read model inside `@msl/memory`, backed by `better-sqlite3`, with a factory that accepts an existing `Database.Database` handle. The first persisted scope should be catalog/listing snapshots only: seller ID, item ID, snapshot kind `listing`, normalized listing data JSON, source `mercadolibre-api`, captured time, freshness status, completeness, confidence, deterministic evidence ID, and an ingestion checkpoint per seller/kind/status filter. This is the smallest useful slice because Market/Catalog lanes already depend on catalog evidence, listings are medium-risk rather than customer/payment-critical, and the ingestion code already calls `mlcClient.getListings()`.

Freshness should be local-first: read from the operational store when `fresh + complete + non-low confidence`; mark stale/partial evidence explicitly when not sufficient; refresh only by scheduled/background ingestion or explicit refresh-needed paths. MercadoLibre remains the source of truth, but the agent should cite local snapshot evidence IDs and avoid repeated API calls for fresh-enough catalog questions. No slice should add ML mutations, publishing, customer messages, payments, SII operations, or approval execution.

Expected PR size: roughly 500–750 changed lines if limited to store implementation, listing-only ingestion wiring, and focused tests. This is inside the 800-line review budget but should avoid adding orders/messages/reputation until a follow-up PR.

## Risks

- Schema creep: adding orders, messages, claims, payments, or reputation in the first slice will push review size and safety risk too high.
- Evidence ID stability: IDs must be deterministic enough for audit (`orm:listing:{sellerId}:{itemId}:{capturedAt-or-checkpoint}` or equivalent) but not leak secrets.
- Freshness ambiguity: stale local data must not be presented as current MercadoLibre truth; consumers need explicit `refresh-required` or stale warnings.
- Duplicate SQLite handles: prefer injected/shared DB patterns (`getSharedDb` or caller-owned handle) rather than each feature opening its own file path.
- Cortex migration: existing ingestion still writes operational facts into Cortex; first slice should dual-write and avoid destructive migration until the read model proves stable.

## Ready for Proposal

Yes — propose a first slice named `operational-read-model-ingestion` that adds a SQLite `@msl/memory` operational read-model implementation and wires listing/catalog snapshot ingestion only. Keep the proposal explicit that orders, messages, claims, payments, SII, publishing, customer messaging, and ML mutations are out of scope.
