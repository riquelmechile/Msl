# Design: Multi-Agent Evidence Response Handling

## Technical Approach

Layered integration — new domain types feed a new SQLite store. The planner persists requests to the store + emits to the bus. A router dispatches to stateless responders (CostSupplier, MarketCatalog, CreativeAssets, AccountBrain, SupplierManager). Responses enrich candidates via aggregator; daemon re-evaluates on response arrival.

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│  Domain  │→│  Memory  │→│  Agent   │→ daemon re-eval
│  types   │  │  store   │  │ router + │
│          │  │  (3 tbl) │  │ 5 resp.  │
└──────────┘  └──────────┘  └──────────┘
                                   ↑
                             bus (evidence-request | evidence-response)
```

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Store engine | SQLite via better-sqlite3, CREATE TABLE IF NOT EXISTS | PostgreSQL, in-memory object | Matches all other stores; non-destructive; in-memory for tests |
| Router dispatch | `EvidenceResponseRouter` with explicit responder registry | Generic message handler, chain-of-responsibility | Wrong responder must not process — registry is explicit contract |
| Responder interface | `canHandle(request): boolean` + `answer(request): EvidenceResponsePayload` | Single `process()` method | `canHandle` enables router to guarantee correct dispatch |
| Dedupe | `dedupeKey = sha256(candidateId + kind + window)` checked before insert | DB UNIQUE constraint, timestamp-only | Hash covers new duplicates even across multi-window; store validates |
| Bus integration | Planner persists first (store is source of truth), then emits fire-and-forget | Bus as primary, store as cache | Store is durable; bus delivery is best-effort |
| Candidate state | `waiting_for_evidence` status flag in OwnedEcommerceStore | Separate state machine table, in-memory map | Matches existing store pattern; single upsert updates state |

## Domain Type Enumeration

### Evidence Kinds (9 + unknown fallback)

| Kind | Target Agent | Description |
|------|-------------|-------------|
| `cost-margin` | cost-supplier | Cost and margin data from supplier mirror |
| `supplier-stock` | supplier-manager | Stock levels, restock dates, supplier availability |
| `market-demand` | market-catalog | Demand signals, search volume, category trends |
| `market-competition` | market-catalog | Competitor pricing, listing count, market share |
| `creative-assets` | creative-assets | Image readiness, moderation status, asset quality |
| `account-channel-fit` | account-brain | Channel suitability, account health, reputation fit |
| `supplier-freshness` | supplier-manager | Data staleness, last sync timestamp, freshness score |
| `listing-performance` | market-catalog | Views, conversion rate, sales velocity, CTR |
| `claim-support` | account-brain | Claim history, resolution patterns, dispute support |
| `unknown` | (fallback) | Unrecognized kind — router marks `unsupported` |

### Evidence Statuses (7)

| Status | Meaning |
|--------|---------|
| `queued` | Request persisted, awaiting agent claim |
| `claimed` | Agent has taken ownership, answering in progress |
| `answered` | Response written, ready for aggregation |
| `failed` | Agent attempted but could not produce evidence |
| `expired` | Request exceeded TTL without being claimed |
| `duplicate` | dedupeKey matched existing pending request |
| `unsupported` | No registered responder can handle this kind |

## Data Flow

```
Planner.planRequests()
  │  generates EvidenceRequestPayload + dedupeKey
  ├→ EvidenceRequestStore.enqueueRequest()   [persist]
  └→ AgentMessageBus.enqueue()               [fire-and-forget]

Router.processPendingForAgent("cost-supplier")
  │  store.listPendingRequestsForAgent()
  ├→ CostSupplierEvidenceResponder.canHandle() → true
  ├→ CostSupplierEvidenceResponder.answer()
  ├→ EvidenceRequestStore.answerRequest()     [persist response]
  └→ bus.enqueue({ messageType: "evidence-response" })

Daemon tick: check pending responses
  ├→ Aggregator.aggregateCandidateEvidence(candidateId)
  ├→ OwnedEcommerceStore.upsertCandidate(enriched)
  ├→ Scorer.reScore(candidate)               [optionally re-run]
  └→ Advisor → CEO proposal                   [deduped by hour]
```

## Work Sessions & Cortex

The daemon handler already receives `sessionStore` (AgentWorkSessionStore) and `cortex` (GraphEngine). Evidence lifecycle events record non-blocking observations and cortex nodes for observability and future retrieval.

### Lifecycle Hooks

| Event | `sessionStore.addObservation()` | Cortex |
|-------|-------------------------------|--------|
| Request enqueued | `kind: "opportunity"`, summary includes `kind` + `targetAgentId`, `severity: "info"` | `createNode("evidence-request", {requestId, kind, candidateId, sellerId})` |
| Request claimed | `kind: "new_signal"`, summary with claim timestamp, `severity: "info"` | — |
| Request answered | `kind: "opportunity"`, summary with confidence + blockers, `severity` mirrors response confidence | `createNode("evidence-response", {responseId, requestId, confidence, kind, sellerId})` + `createEdge(requestNode, responseNode)` |
| Response aggregated | — | Update request node metadata with `aggregated: true, appliedAt` |
| Request failed / expired | `kind: "missing_data"`, summary with failure reason, `severity: "warning"` | — |
| Request unsupported | `kind: "missing_data"`, summary records unsupported kind, `severity: "info"` | — |

### Trigger Points

- **Planner** (request enqueued): After `store.enqueueRequest()` succeeds — fire observation + cortex node.
- **Router** (claimed, answered, failed, unsupported): After each state transition in `processRequest()`.
- **Aggregator** (response aggregated): After `aggregateCandidateEvidence()` merges responses into the candidate.

### Non-Blocking Contract

All `sessionStore` and `cortex` calls are wrapped in try/catch. If either dependency is unavailable (`undefined` or throws), evidence processing continues without interruption. These hooks are observability-only — they never gate evidence delivery or candidate enrichment.

### Observation Shapes

```typescript
// Request enqueued
{
  kind: "opportunity",
  summary: `Evidence request enqueued: ${kind} → ${targetAgentId} for candidate ${candidateId}`,
  severity: "info",
  metadataJson: JSON.stringify({
    requestId, correlationId, kind, targetAgentId, candidateId, sellerId,
    noMutationExecuted: true,
  }),
}

// Response answered
{
  kind: "opportunity",
  summary: `Evidence response: ${kind} from ${sourceAgentId} (confidence: ${confidence})`,
  severity: confidence >= 0.7 ? "info" : "warning",
  metadataJson: JSON.stringify({
    responseId, requestId, kind, confidence, blockers, sellerId,
    noMutationExecuted: true,
  }),
}
```

## File Changes

| File | Action | Purpose |
|------|--------|---------|
| `packages/domain/src/interAgentEvidence.ts` | New | `EvidenceRequestPayload`, `EvidenceResponsePayload`, enums |
| `packages/domain/src/index.ts` | Modify | Add `export * from "./interAgentEvidence.js"` |
| `packages/memory/src/evidenceRequestStore.ts` | New | `EvidenceRequestStore` with SQLite factory + migration |
| `packages/memory/src/index.ts` | Modify | Export store type + factory |
| `packages/agent/src/ecommerce/ecommerceEvidenceRequestPlanner.ts` | Modify | Add store+bus deps; persist + emit flow |
| `packages/agent/src/evidence/evidenceResponseRouter.ts` | New | Router with responder registry |
| `packages/agent/src/evidence/responders/*.ts` | New | 5 responder implementations |
| `packages/agent/src/ecommerce/ownedEcommerceEvidenceAggregator.ts` | New | Aggregates responses into candidate evidence |
| `packages/agent/src/ecommerce/ownedEcommerceIntelligenceService.ts` | Modify | Wire aggregator, mark waiting_for_evidence |
| `packages/agent/src/workers/ownedEcommerceDaemon.ts` | Modify | Check pending responses, re-score, re-run advisor |
| `packages/agent/src/conversation/tools/evidenceTools.ts` | New | 2 read-only CEO tools |
| `packages/agent/src/index.ts` | Modify | Export new classes and types |

## Store Schema (SQL DDL)

```sql
CREATE TABLE IF NOT EXISTS evidence_requests (
  request_id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  source_agent_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  seller_id TEXT, candidate_id TEXT,
  kind TEXT NOT NULL, question TEXT NOT NULL,
  reason TEXT, priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'queued',
  dedupe_key TEXT NOT NULL UNIQUE,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  claimed_by TEXT, claimed_at TEXT,
  expires_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_responses (
  response_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES evidence_requests(request_id),
  correlation_id TEXT NOT NULL,
  source_agent_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  seller_id TEXT, candidate_id TEXT,
  status TEXT NOT NULL,
  answer TEXT, structured_evidence_json TEXT NOT NULL DEFAULT '{}',
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL, blockers_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_request_links (
  request_id TEXT NOT NULL,
  linked_entity_type TEXT NOT NULL,  -- "candidate" | "projection" | "proposal"
  linked_entity_id TEXT NOT NULL,
  PRIMARY KEY (request_id, linked_entity_type, linked_entity_id)
);
```

Key indexes: `request_id`, `correlation_id`, `target_agent_id`, `seller_id`, `candidate_id`, `dedupe_key`, `status`, `created_at`.

## Interfaces

```typescript
// EvidenceResponseRouter
interface EvidenceResponder {
  agentId: EvidenceTargetAgentId;
  canHandle(request: EvidenceRequestPayload): boolean;
  answer(request: EvidenceRequestPayload): Promise<EvidenceResponsePayload>;
}
// Router methods
class EvidenceResponseRouter {
  registerResponder(responder: EvidenceResponder): void;
  processPendingForAgent(agentId: string, limit?: number): Promise<EvidenceResponsePayload[]>;
  processRequest(requestId: string): Promise<EvidenceResponsePayload>;
}
// Aggregator
class OwnedEcommerceEvidenceAggregator {
  aggregateCandidateEvidence(candidateId: string): Promise<EvidenceSummary>;
  applyEvidenceResponsesToCandidate(candidateId: string): Promise<StorefrontCandidate>;
  shouldReRunAdvisor(candidateId: string): boolean;
}
```

## Test Strategy (32 tests)

| Component | Count | Focus |
|-----------|-------|-------|
| EvidenceRequestStore | 8 | Enqueue, claim, answer, fail, expire, dedupe, seller isolation, in-memory SQLite |
| EcommerceEvidenceRequestPlanner | 4 | Persists to store, emits to bus, dedupe hash, graceful degradation |
| EvidenceResponseRouter | 4 | Correct dispatch, unsupported → unsupported, failure → failed, responder reg |
| Responders (5×2) | 10 | Each: handles correct kind, returns structured evidence, marks insufficient_evidence |
| OwnedEcommerceEvidenceAggregator | 3 | Aggregate, enrich candidate, shouldReRun |
| Daemon integration | 2 | waiting_for_evidence cycle, CEO dedupe on re-eval |
| CEO tools | 1 | Read-only inspection, noMutationExecuted |

## PR Plan (3 PRs)

1. **Domain + Memory** — `interAgentEvidence.ts`, `evidenceRequestStore.ts`, exports (pure types + store, ~10 tests)
2. **Router + Responders** — `evidenceResponseRouter.ts`, 5 responders, test suites (~18 tests)
3. **Integration** — Planner mods, aggregator, daemon mods, tools, wire everything (~4 tests). Depends on PR #2.

## Rollback Plan

Store and types are additive. Remove router/responder wiring from planner + daemon (3 lines each). Existing `planRequests()` fallback path (returns structured messages without store) untouched. Drop tables: `evidence_responses`, `evidence_requests`, `evidence_request_links`.

## Security / Safety

- **Seller isolation**: All queries scoped by `seller_id` WHERE clause; cross-seller requests never returned.
- **`noMutationExecuted: true`** on every payload (enforced in types, validated in tests).
- **No external writes**: Responders use injected fake transports (SupplierMirrorStore, OperationalReadModel); 0 HTTP calls.
- **No secrets**: 0 API keys, 0 environment variables beyond feature flags.
