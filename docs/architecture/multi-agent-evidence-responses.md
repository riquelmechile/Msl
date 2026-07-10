# Multi-Agent Evidence Response Handling

## Why this exists

The `OwnedEcommerceMerchandisingAdvisor` and `EcommerceEvidenceRequestPlanner` can detect evidence gaps (margin, stock, demand, images, account fit, supplier freshness) but those requests used to remain as text descriptors. No other agent could respond to them, so candidates stayed blocked waiting for evidence that never arrived.

This system makes evidence requests wake specialized agents, receive structured responses, and enrich CEO candidates with real multi-agent evidence — turning MSL from individual intelligent agents into a collaborating team.

## Evidence Flow

```text
Planner detects gaps
  │  generates EvidenceRequestPayload + dedupeKey
  ├─→ EvidenceRequestStore.enqueueRequest()       [persist]
  └─→ AgentMessageBus (evidence-request)          [fire-and-forget]

Router.processPendingForAgent("cost-supplier")
  │  store.listPendingRequestsForAgent()
  ├─→ CostSupplier.canHandle() → true
  ├─→ CostSupplier.answer()
  │     → { confidence: "high", marginPct: 38, costKnown: true }
  ├─→ EvidenceRequestStore.answerRequest()        [persist response]
  └─→ AgentMessageBus (evidence-response)         [fire-and-forget]

Daemon tick: check pending responses
  ├─→ Aggregator.aggregateCandidateEvidence()
  ├─→ OwnedEcommerceStore.upsertCandidate(enriched)
  ├─→ Scorer.reScore(candidate)
  └─→ Advisor → CEO proposal (deduped by hour)
```

## CorrelationId

Every request carries a `correlationId` that connects the entire chain:

```text
Planner (corr-abc)
  → evidence-request bus message (corr-abc)
  → CostSupplier response (corr-abc)
  → evidence-response bus message (corr-abc)
  → Aggregator summary (corr-abc)
  → CEO proposal (corr-abc)
```

This makes the evidence trail traceable from gap detection through response to final proposal.

## Domain Types

| Concept             | Values                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence Kinds (10) | `cost-margin`, `supplier-stock`, `market-demand`, `market-competition`, `creative-assets`, `account-channel-fit`, `supplier-freshness`, `listing-performance`, `claim-support`, `unknown` |
| Target Agents (7)   | `cost-supplier`, `market-catalog`, `creative-assets`, `account-brain`, `supplier-manager`, `owned-ecommerce`, `operations-manager`                                                        |
| Statuses (7)        | `queued`, `claimed`, `answered`, `failed`, `expired`, `duplicate`, `unsupported`                                                                                                          |
| Confidence (3)      | `low`, `medium`, `high`                                                                                                                                                                   |

All payloads carry `noMutationExecuted: true`.

## Evidence Request Store

SQLite-backed store with three tables:

- **`evidence_requests`** — request lifecycle from enqueue through claim to answer/fail/expire
- **`evidence_responses`** — structured responses with confidence, evidence IDs, blockers, warnings
- **`evidence_request_links`** — connects requests to candidates, projections, and proposals

Key features:

- Deduplication via `dedupe_key` UNIQUE constraint (hash of candidateId + kind + hourly window)
- Seller isolation: all queries scoped by `seller_id` WHERE clause
- Non-destructive migrations: `CREATE TABLE IF NOT EXISTS`
- In-memory SQLite for tests, file-based SQLite for production

## Evidence Response Router

Dispatcher that routes pending requests to the correct responder agent:

```typescript
interface EvidenceResponder {
  agentId: EvidenceTargetAgentId;
  canHandle(request: EvidenceRequestPayload): boolean;
  answer(request: EvidenceRequestPayload): Promise<EvidenceResponsePayload>;
}
```

| Rule             | Behavior                                        |
| ---------------- | ----------------------------------------------- |
| Wrong responder  | Not dispatched — `canHandle()` returns false    |
| Unsupported kind | Status `unsupported`, no delegation             |
| Responder throws | Status `failed` with error evidence stored      |
| After answer     | Response persisted, optionally published to bus |
| Work sessions    | Observation recorded in non-blocking try/catch  |
| Cortex           | Node created/linked in non-blocking try/catch   |

## Responders

Five specialized agents, each responsible for specific evidence kinds:

| Responder           | Kinds                                                        | Structured Evidence Output                                                                                       |
| ------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **CostSupplier**    | `cost-margin`                                                | `costKnown`, `estimatedCost`, `suggestedPrice`, `marginPct`, `stockKnown`, `stockAvailable`, `supplierFreshness` |
| **MarketCatalog**   | `market-demand`, `market-competition`, `listing-performance` | `demandSignal`, `competitorCount`, `averageObservedPrice`, `priceRange`, `listingPerformance`                    |
| **CreativeAssets**  | `creative-assets`                                            | `imageReady`, `imageCount`, `missingImages`, `creativeRequestId`, `constraints`                                  |
| **AccountBrain**    | `account-channel-fit`, `claim-support`                       | `recommendedSellerId`, `recommendedAccountName`, `ranking`, `decisionLogic`                                      |
| **SupplierManager** | `supplier-stock`, `supplier-freshness`                       | `supplierId`, `supplierItemId`, `lastSeenAt`, `priceFreshness`, `stockFreshness`, `reliability`                  |

All responders:

- Use injected fake transports (no real HTTP)
- Return `noMutationExecuted: true`
- Mark `insufficient_evidence` when data is missing
- Lower confidence when data is stale

## Evidence Aggregator

Joins responses from all responders and enriches candidates:

| Method                                         | Purpose                                                  |
| ---------------------------------------------- | -------------------------------------------------------- |
| `aggregateCandidateEvidence(candidateId)`      | Build evidence summary from all responses                |
| `applyEvidenceResponsesToCandidate(candidate)` | Enrich candidate with evidence IDs, blockers, confidence |
| `checkReadiness(candidateId)`                  | Returns `ready`, `waiting_for_evidence`, or `blocked`    |
| `shouldReRunAdvisor()`                         | True when new evidence should trigger advisor re-run     |

Confidence calculation: **minimum** across all response confidences. If one responder says `low`, the overall is `low`.

## Owned Ecommerce Integration

1. **Planner**: persists evidence requests to store + emits `evidence-request` bus messages
2. **Intelligence Service**: marks candidates `waiting_for_evidence` when requests are outstanding
3. **Daemon**: checks pending responses → aggregates → re-scores → optionally re-runs advisor → creates enriched CEO proposal
4. **CEO dedupe**: no duplicate proposals within 1-hour window per candidate

## CEO Tools (Read-Only)

| Tool                             | Purpose                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `get_evidence_request_status`    | Query one request by correlationId — status, responder, confidence         |
| `list_pending_evidence_requests` | List queued/claimed requests per seller with kind, priority, age           |
| `inspect_candidate_evidence`     | Show aggregated evidence for a candidate — confidence, blockers, readiness |

All tools carry `noMutationExecuted: true` and enforce seller isolation.

## Safety

| Guard                      | Mechanism                                                                   |
| -------------------------- | --------------------------------------------------------------------------- |
| `noMutationExecuted: true` | Type-enforced literal on all payloads; verified in 32 tests                 |
| Seller isolation           | SQL WHERE clause on all queries; cross-seller reads impossible              |
| 0 HTTP real                | All transports are injected fake implementations                            |
| 0 secrets                  | No API keys, no env vars beyond feature flags                               |
| Graceful degradation       | Planner, aggregator, daemon — all deps optional; absent = skipped           |
| Deduplication              | Hash-based dedupe keys prevent duplicate requests per candidate+kind+window |

## Example: Full Evidence Cycle

```text
Advisor identifies gap:
  "Necesito margen, stock, demanda, imagen y mejor cuenta/canal."

Planner enqueues 5 requests:
  cost-margin → cost-supplier
  supplier-stock → supplier-manager
  market-demand → market-catalog
  creative-assets → creative-assets
  account-channel-fit → account-brain

CostSupplier responds:
  { confidence: "high", marginPct: 38, costKnown: true }

MarketCatalog responds:
  { confidence: "medium", demandSignal: "high", competitorCount: 4 }

CreativeAssets responds:
  { confidence: "low", missingImages: true, constraints: ["falta foto principal"] }

AccountBrain responds:
  { confidence: "high", recommendedSellerId: "plasticov" }

SupplierManager responds:
  { confidence: "medium", stockFreshness: "2h", reliability: "high" }

Aggregator builds summary:
  { overallConfidence: "low", missingKinds: [], blockers: ["missing-images"] }

Daemon re-evaluates candidate:
  enriched with evidence IDs, "incomplete-evidence" removed (responses received)
  but "missing-images" blocker remains from CreativeAssets response

CEO proposal:
  "Candidate X: ready except for missing images.
   Margin OK (38%), demand high, Plasticov preferred.
   Blocked by: creative-assets — crear request de imágenes."
```
