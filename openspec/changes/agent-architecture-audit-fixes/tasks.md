# Tasks: Agent Architecture Audit — 15-Gap Remediation

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
800-line budget risk: Low

| Field | Value |
|-------|-------|
| Est. lines | ~2,100 across 6 PRs |
| Max per-PR | PR5 ~450 (< 800 budget) |
| Chained PRs recommended | Yes (6-PR chain per design) |
| Delivery strategy | auto-chain, stacked-to-main |

### Work Units

| PR | Goal | Depends |
|----|------|---------|
| PR1 | Daemon Autonomy + CEO Inbox | — |
| PR2 | Bus Schema + Outcome Persistence | — |
| PR3 | Lane Contract Completeness | PR1, PR2 |
| PR4 | Proposal Router + Durability | PR2 |
| PR5 | Creative Pipeline + Config | PR1, PR4 |
| PR6 | Maturity + E2E | PR2, PR5 |

## PR1: Daemon Autonomy + CEO Inbox (~400 lines)

- [x] 1.1 Create `ceoInboxStore.ts` — `agent_proposals` table + store
- [x] 1.2 Add `enqueueDaemonTick()` before claim loop
- [x] 1.3 Hour-gate `morningReportDaemon.ts` at 9am
- [x] 1.4 Hour-gate `eodSummaryDaemon.ts` at 6pm
- [x] 1.5 Tests: tick dedup, proposal persistence, time-gates

## PR2: Bus Schema + Outcome Persistence (~350 lines)

- [x] 2.1 `migrateBusSchema()` — `PRAGMA table_info` + 9 columns
- [x] 2.2 Wire `resolve/result_json`, `fail/error_json`, `cancel/cancel_reason`
- [x] 2.3 Enqueue opts: `correlationId`, `parentMessageId`, `sellerId`, `actionId`
- [x] 2.4 APIs: `getMessagesByCorrelationId`, `getLearningHistory`, `recordOutcome`
- [x] 2.5 Tests: migration, column writes, correlation queries

## PR3: Lane Contract Completeness (~300 lines)

- [x] 3.1 Add 3 lanes to `LANE_CONTRACTS` in `lanes.ts`
- [x] 3.2 Create `ownedEcommerceDaemon.ts` — investigate → CEO proposals
- [x] 3.3 Create `unansweredQuestionsDaemon.ts` — investigate → aggregated proposals
- [x] 3.4 Register both daemons in `daemonScheduler.ts`
- [x] 3.5 Tests: contracts, DaemonResult contract

## PR4: Proposal Router + Durability (~250 lines)

- [x] 4.1 Add `routeToTelegram()`, `listByStatus()`, `getByStatus()` to store
- [x] 4.2 CEO: `insert()` + inbox before resolve
- [x] 4.3 `request_agent_evidence` enqueues durable msg with correlation ID
- [x] 4.4 Tests: Telegram routing, CEO proposal save, evidence enqueue, correlation chain

## PR5: Creative Pipeline + Config (~450 lines)

- [ ] 5.1 Create `creativeJobQueueStore.ts` — SQLite + status machine + CRUD
- [ ] 5.2 Create `minimaxRetryPolicy.ts` — exp backoff 1s→2s→4s, skip 401/400
- [ ] 5.3 Create `createDaemonAdvisors.ts` — 5 DeepSeek advisor factory
- [ ] 5.4 Replace `creativeTools.ts` stubs with real queue calls
- [ ] 5.5 `MINIMAX_BASE_URL` fallback for `MINIMAX_API_HOST`
- [ ] 5.6 Wire advisors in `start-agent-daemons.mjs`
- [ ] 5.7 Add 7 missing vars to `.env.example`
- [ ] 5.8 Tests: retry delays, queue CRUD, env fallback, advisors

## PR6: Maturity + E2E (~350 lines)

- [ ] 6.1 Create `validateEnv.ts` — `validateRuntimeEnv()` → `EnvValidation`
- [ ] 6.2 Create `webhookIngestor.ts` — endpoint + routing + dedup
- [ ] 6.3 Create `learningPipeline.ts` — batch scoring → Cortex observations
- [ ] 6.4 Startup: `validateRuntimeEnv()` + webhook in start script
- [ ] 6.5 E2E: `agent-pipeline.e2e.test.ts` — SQLite tick→daemon→CEO→inbox
- [ ] 6.6 Unit tests: env validation, webhook routing, learning batch
