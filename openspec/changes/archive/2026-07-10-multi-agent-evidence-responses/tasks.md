# Tasks: Multi-Agent Evidence Response Handling

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~3100 total (PR1: ~900, PR2: ~1300, PR3: ~900) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → PR3 (stacked to main) |
| Delivery strategy | auto-forecast → auto-chain |
| Decision needed before apply | No |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base | Tests |
|------|------|-----------|------|-------|
| 1 | Domain types + EvidenceRequestStore + tests | PR 1 | main | 8 |
| 2 | Router + 5 responders + tests | PR 2 | main (after PR1) | 14 |
| 3 | Planner + aggregator + daemon + tools + wire | PR 3 | main (after PR2) | 10 |

## PR1: Domain + Memory (8 tests)

- [x] 1.1 Create `packages/domain/src/interAgentEvidence.ts` — `EvidenceKind` enum (9 kinds + `unknown`), `EvidenceStatus` (7 statuses), `Priority`, `ConfidenceLevel`, `EvidenceRequestPayload` (noMutationExecuted: true), `EvidenceResponsePayload`, link + summary types.
- [x] 1.2 Add `export * from "./interAgentEvidence.js"` to `packages/domain/src/index.ts`.
- [x] 1.3 Create `packages/memory/src/evidenceRequestStore.ts` — DDL for `evidence_requests`, `evidence_responses`, `evidence_request_links` (CREATE TABLE IF NOT EXISTS), indexes on `request_id`, `correlation_id`, `target_agent_id`, `seller_id`, `candidate_id`, `dedupe_key`, `status`, `created_at`. Export `migrateEvidenceStore(db)`, `createSqliteEvidenceRequestStore(db)`, store type.
- [x] 1.4 Implement CRUD: `enqueueRequest` (dedupe via UNIQUE on dedupe_key → duplicate status on conflict), `claimRequest` (CAS queued→claimed), `answerRequest` (insert response + transition→answered), `failRequest` (→failed with error evidence), `expireRequests` (TTL check), `listPendingForAgent(agentId, sellerId?, limit?)`, `getRequestByCorrelationId`, `getResponsesForCandidate`.
- [x] 1.5 Add store type + factory exports to `packages/memory/src/index.ts`.
- [x] 1.6 Write `packages/memory/src/evidenceRequestStore.test.ts` — 8 tests: enqueue→queued, claim acquires, answer persists response with confidence + noMutationExecuted, fail transition, expire marks unclaimable, dedupe returns existing ID as duplicate, seller isolation (Plasticov / Maustian separation), in-memory SQLite factory. 0 HTTP, 0 secrets.

## PR2: Router + Responders (14 tests)

- [x] 2.1 Create `packages/agent/src/evidence/evidenceResponseRouter.ts` — `EvidenceResponder` interface (`agentId`, `canHandle(request): boolean`, `answer(request): Promise<EvidenceResponsePayload>`). `EvidenceResponseRouter` class: `registerResponder`, `processPendingForAgent(agentId, limit?)`, `processRequest(requestId)` lifecycle (claim→answer/fail). Cortex + session observations in non-blocking try/catch. Exports.
- [x] 2.2 Router tests in `packages/agent/src/evidence/evidenceResponseRouter.test.ts` — 4 tests: delegates cost-margin→CostSupplier→answered, unsupported kind→unsupported, responder throws→failed with error evidence, registerResponder wiring.
- [x] 2.3 Create `packages/agent/src/evidence/responders/costSupplierEvidenceResponder.ts` — `agentId: "cost-supplier"`, `canHandle` matches `cost-margin`, `answer` via fake SupplierMirrorStore.
- [x] 2.4 Create `packages/agent/src/evidence/responders/marketCatalogEvidenceResponder.ts` — `agentId: "market-catalog"`, `canHandle` matches `market-demand|market-competition|listing-performance`, fake OperationalReadModel.
- [x] 2.5 Create `packages/agent/src/evidence/responders/creativeAssetsEvidenceResponder.ts` — `agentId: "creative-assets"`, `canHandle` matches `creative-assets`, fake asset store.
- [x] 2.6 Create `packages/agent/src/evidence/responders/accountBrainEvidenceResponder.ts` — `agentId: "account-brain"`, `canHandle` matches `account-channel-fit|claim-support`, fake reputation/channel transport.
- [x] 2.7 Create `packages/agent/src/evidence/responders/supplierManagerEvidenceResponder.ts` — `agentId: "supplier-manager"`, `canHandle` matches `supplier-stock|supplier-freshness`, fake supplier mirror transport.
- [x] 2.8 Responder tests — 10 total (2 per responder): `canHandle` matches correct kinds, `answer` returns structured evidence with `confidence` + `noMutationExecuted: true`. 0 HTTP, fake transports only.

## PR3: Integration (10 tests)

- [x] 3.1 Modify `EcommerceEvidenceRequestPlanner` — add `EvidenceRequestStore` dep. In `planRequests()`: call `store.enqueueRequest()` before bus emit. DedupeKey = sha256(candidateId+kind+window). Fire-and-forget: store failures logged, never thrown. Emit `evidence-request` bus message with `correlationId`.
- [x] 3.2 Planner integration tests — 4 tests: persists to store, emits to bus with correlationId, dedupe hash key matches, graceful degradation on store unavailable.
- [x] 3.3 Create `packages/agent/src/ecommerce/ownedEcommerceEvidenceAggregator.ts` — `aggregateCandidateEvidence(candidateId)` → EvidenceSummary (confidence = min across responses), `applyEvidenceResponsesToCandidate(candidateId)` → enriched StorefrontCandidate, `shouldReRunAdvisor(candidateId): boolean`. Missing required kind → `waiting_for_evidence`, expired → downgrade + blocker.
- [x] 3.4 Aggregator tests — 3 tests: joins responses with min confidence, missing kind→waiting_for_evidence, expired response→downgrade+blocker.
- [x] 3.5 Modify `ownedEcommerceIntelligenceService.ts` — wire aggregator. Mark candidate `waiting_for_evidence` when requests outstanding.
- [x] 3.6 Modify `ownedEcommerceDaemon.ts` — tick: check pending responses, call aggregator, re-score, re-run advisor. CEO dedupe by hour on re-eval.
- [x] 3.7 Daemon integration tests — 2 tests: `waiting_for_evidence` → re-eval cycle end-to-end, CEO dedupe on re-eval.
- [x] 3.8 Create `packages/agent/src/conversation/tools/evidenceTools.ts` — 3 read-only tools: `get_evidence_request_status`, `list_pending_evidence_requests`, `inspect_candidate_evidence`. All `noMutationExecuted: true`, seller isolation, nonexistent→controlled response (no throw).
- [x] 3.9 CEO tools test — 1 test: read-only inspection, `noMutationExecuted: true`, seller isolation enforced.
- [x] 3.10 Wire exports in `packages/agent/src/index.ts` or barrel files.
