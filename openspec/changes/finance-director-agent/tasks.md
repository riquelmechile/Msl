# Tasks: Finance Director Agent (PR 2/3 Financial Truth)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2160 total across 4 PRs |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 (feature-branch-chain) |
| Delivery strategy | auto-forecast |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Est. Lines | Notes |
|------|------|-----------|------------|-------|
| 1 | Domain + Registration | PR 1 | ~110 | base: `feature/financial-truth`; standalone |
| 2 | Store + Evidence Assembler | PR 2 | ~550 | base: PR 1 branch; depends on domain types |
| 3 | Advisor + Prompt + Validator + Fallback + Tools | PR 3 | ~1100 | base: PR 2 branch; over 800 — consider splitting or accept size exception |
| 4 | Work Sessions + Evidence Requests + Docs | PR 4 | ~400 | base: PR 3 branch; integration closure |

## Phase 1: Domain Types + Lane Registration (PR 1)

- [x] 1.1 Create `packages/domain/src/financialAssessment.ts` — `AssessmentType` enum (9 members: `account-health`, `order-profitability`, `product-profitability`, `ads-profitability`, `proposal-review`, `outcome-review`, `missing-cost-review`, `cross-account-comparison`, `cash-risk-indicator`) + `FinancialAssessment` type (assessmentId, sellerId, type, outcome, confidence, completeness, evidenceIds, gaps, reasoningTrace, source, correlationId?, sessionId?, createdAt)
- [x] 1.2 Add `export * from "./financialAssessment.js"` to `packages/domain/src/index.ts`
- [x] 1.3 Extend `CompanyDepartmentId` union in `packages/agent/src/conversation/companyAgents.ts` with `"finance"`
- [x] 1.4 Add `"finance-director"` to `LaneId` union in `packages/agent/src/conversation/lanes.ts`
- [x] 1.5 Add `FINANCE_DIRECTOR_LANE: LaneContract` in `packages/agent/src/conversation/lanes.ts` — label "Finance Director", 15 `requiredEvidenceKinds`, `credentialScope: "provider-default"`, stable prefix declaring: Finance Director role, read-only financial reasoning, no fabrication, Phase-1 proposal-only, 15 evidence kinds
- [x] 1.6 Add `FINANCE_DIRECTOR_LANE` to `LANE_CONTRACTS` array in `packages/agent/src/conversation/lanes.ts`
- [x] 1.7 Add `"finance-director": "finance"` to `laneDepartments` mapping in `packages/agent/src/conversation/companyAgents.ts`
- [ ] 1.8 Verify: TypeScript typecheck passes (`npm run typecheck`); `listCompanyAgents()` includes finance-director with source `lane-contract` and department `finance`; `getLaneContract("finance-director")` returns valid contract with exactly 15 evidence kinds

## Phase 2: Assessment Store + Evidence Assembler (PR 2)

- [x] 2.1 Create `FinanceDirectorAssessmentStore` interface in `packages/memory/src/financeDirectorAssessmentStore.ts` — methods: `insert(assessment)`, `getAssessment(id, sellerId)`, `listBySeller(sellerId, opts)`, `listByOutcome(sellerId, outcome)`, `listByProposal(sellerId, proposalId)`, `listBySession(sellerId, sessionId)`, `listByCorrelationId(sellerId, correlationId)`, `latestByType(sellerId, type)`
- [x] 2.2 Implement `createSqliteFinanceDirectorAssessmentStore(db)` — SQLite table `finance_director_assessments` (columns: assessment_id, seller_id, type, outcome, confidence, completeness, evidence_ids_json, gaps_json, reasoning_trace, source, correlation_id, session_id, created_at); `insert` idempotent upsert by `assessment_id`; all queries scoped to `seller_id`; `limit=50` default; black `no_mutation_executed` boolean; reject writes without `seller_id`
- [x] 2.3 Implement `migrateFinanceDirectorAssessmentStore(db)` — CREATE TABLE IF NOT EXISTS, indexes on `(seller_id, type)`, `(seller_id, outcome)`, `(seller_id, created_at DESC)`
- [x] 2.4 Add type-only export + factory/migrate exports to `packages/memory/src/index.ts`
- [x] 2.5 Create `packages/agent/src/finance/FinanceDirectorEvidenceAssembler.ts` — constructor takes `EconomicOutcomeStore` + `sellerId`; `assembleEvidence(opts)` queries snapshots (max 50), outcomes (max 25), profit summary; bounds by `maxAge` (default 90d); returns `FinanceDirectorEvidence` with `metadata.bounded: boolean` when limits hit; `missingInputs` list from store
- [x] 2.6 Write `packages/memory/src/financeDirectorAssessmentStore.test.ts` — seller isolation (A cannot see B), idempotent upsert (same assessmentId twice → updated, not duplicated), corrupt data rejection (missing sellerId throws), all 7 query methods with edge cases, limit enforcement
- [x] 2.7 Write `packages/agent/src/finance/FinanceDirectorEvidenceAssembler.test.ts` — respects snapshot limit (50), respects outcome limit (25), respects maxAge (90d), sets `bounded: true` when over limits, includes `profitSummary`, empty store returns empty evidence, seller-scoped

## Phase 3: Advisor + Prompt + Validator + Fallback + Tools (PR 3)

- [x] 3.1 Create `packages/agent/src/finance/FinanceDirectorPromptBuilder.ts` — `buildSystemPrompt()` returns cache-stable block A (identity+rules, constant), block B (company context, seller-scoped), block C (session context, correlation-scoped); `buildUserPrompt(evidence, question)` returns block D (dynamic evidence, uncached); uses `cacheBlocks` pattern from `DeepSeekReasoningGateway`
- [x] 3.2 Create `packages/agent/src/finance/FinanceDirectorValidator.ts` — 16 rejection rules covering: hallucinated numbers (figure present with 0 evidence IDs), hallucinated causality (cause without evidence linkage), currency mixing (CLP vs USD in same claim), missing→zero conversion, observed→verified without verification timestamp, guaranteed profit claims, deceptive ROAS (revenue-only, ignoring costs), stale costs (>30d without staleness warning), cross-account leakage, negative confidence, missing outcome field, duplicate evidence IDs, overconfident certainty in partial data, fabricated evidence IDs, unsupported currency, invented seller names
- [x] 3.3 Create `packages/agent/src/finance/FinanceDirectorFallback.ts` — `buildFallbackAssessment(evidence)` returns `FinancialAssessment` with outcome `"unknown"`, `confidence: 0`, factual summary of available evidence, enumerated gaps, risks list, `source: "deterministic-fallback"`, all evidence IDs present, no invention
- [x] 3.4 Create `packages/agent/src/finance/FinanceDirectorAdvisor.ts` — lazy `DeepSeekReasoningGateway` via transport; `analyze(evidence, question)` flow: prompt → reason → validate → fallback; returns `FinancialAssessment` with cost telemetry; follows `CostSupplierDeepSeekAdvisor` pattern (constructor signature: `{ transport, sellerIds, ledger? }`)
- [x] 3.5 Create `packages/agent/src/conversation/tools/financeDirectorTools.ts` — 4 tools (all `noExternalMutationExecuted: true`):
  - `ask_finance_director({ sellerId, question })` → assembles evidence → advisor.analyze() → assessment
  - `review_financial_health({ sellerId, timeWindow? })` → assembles broad evidence → advisor.analyze() → type `"health"`
  - `explain_economic_outcome({ outcomeId, sellerId })` → fetches specific outcome → advisor.analyze() → type `"outcome"`
  - `review_proposal_profitability({ proposalId, sellerId })` → fetches linked outcomes → advisor.analyze() → type `"proposal"`, never changes approval state
  - All tools: reject missing `sellerId`, return error when store unavailable, scope all queries to seller
- [x] 3.6 Wire tools into agent loop — register in tool registry with `noMutationExecuted: true`; dependency injection of `FinanceDirectorAdvisor` factory + `EconomicOutcomeStore` + `FinanceDirectorAssessmentStore`
- [x] 3.7 Write `packages/agent/src/finance/FinanceDirectorAdvisor.test.ts` — 8+ behaviors: profit interpretation (complete evidence → confidence ≥ 0.7), revenue without profit (missing costs → outcome `unknown`, confidence ≤ 0.3), missing inputs (3 of 15 kinds → completeness `partial`), observed vs verified (no timestamp → flagged), currency mismatch (CLP context + USD question → rejected), stale costs (>30d → staleness warning), cross-account isolation, deceptive ROAS (revenue-only → flagged `incomplete`)
- [x] 3.8 Write `packages/agent/src/finance/FinanceDirectorValidator.test.ts` — 10+ rejection cases covering the most critical 10 rules from the 16
- [x] 3.9 Write `packages/agent/src/conversation/tools/financeDirectorTools.test.ts` — all 4 tools: missing store returns error + `noExternalMutationExecuted: true`, missing DeepSeek factory returns error without crash, seller isolation (plasticov cannot see maustian), `noExternalMutationExecuted: true` on every response, `review_proposal_profitability` does not change approval state
- [ ] 3.10 Write `packages/agent/src/finance/FinanceDirectorPromptBuilder.test.ts` — block A+B hash stability across calls, block D changes with different evidence, cache block counts correct

## Phase 4: Work Sessions + Evidence Requests + Docs (PR 4)

- [x] 4.1 Add `"finance-director"` to sessionized lanes in `packages/agent/src/sessions/AgentWorkSessionRunner.ts` (or equivalent session lane registry)
- [x] 4.2 Add finance-director wake reasons in `packages/agent/src/sessions/agentWakePolicy.ts` — triggers: new economic outcome observed/verified, cost evidence update, proposal review requested
- [ ] 4.3 Wire `FinanceDirectorEvidenceAssembler` as an evidence responder via `EvidenceResponseRouter` in `packages/agent/src/evidence/` — responds to evidence requests from the Agent Message Bus for `finance-director` lane
- [x] 4.4 Create `docs/architecture/finance-director-agent.md` — architecture overview: lane contract, advisor pipeline (assembler → prompt → reason → validate → fallback), store schema, tool contracts, security boundaries (seller isolation, read-only, no fabricate), data flow diagram, cache strategy
- [x] 4.5 Update `ARCHITECTURE.md` — add Finance Director section under Agents; update `ROADMAP.md` — mark finance-director as implemented; update `docs/README.md` — add link to new doc
- [ ] 4.6 Write `packages/agent/src/finance/finance-director-integration.test.ts` — end-to-end: tool call → assembler → advisor (mock transport) → validator → store persistence; seller isolation across full pipeline; fallback path when DeepSeek returns `status: "fallback"`; evidence request/response via Agent Message Bus
