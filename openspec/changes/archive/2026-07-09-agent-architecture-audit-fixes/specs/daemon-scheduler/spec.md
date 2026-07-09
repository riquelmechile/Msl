# Delta for daemon-scheduler

## ADDED Requirements

### Requirement: Autonomous Tick Generation

`enqueueDaemonTick(laneId, opts?)` MUST enqueue self-triggering message with `senderAgentId="system"`, `receiverAgentId=laneId`, `messageType="daemon_tick"`, and lane-scoped `dedupe_key`. Scheduler SHALL call it before `claimNext()` for daemons with configured schedule.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Tick enqueues | market-catalog interval fires | enqueueDaemonTick("market-catalog") | Message enqueued; type="daemon_tick" |
| Dedupe prevents double | Previous tick still pending | Interval fires again | No duplicate; dedupe key match |
| Unregistered lane | Lane has no handler | enqueueDaemonTick("unknown") | Tick enqueued; scheduler skips if no handler |

### Requirement: Per-Daemon Cron Schedules

Each daemon lane MAY define `cronSchedule` or `tickIntervalMs`. Cron evaluated per polling cycle; tickInterval enqueues on elapsed interval. Daemons without schedule remain reactive-only.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Cron matches | market-catalog cronSchedule="0 */6 * * *" | Current time matches | Tick enqueued |
| Tick interval | cost-supplier tickIntervalMs=900000 | 15 min elapsed | Tick enqueued |
| No schedule | creative-studio has no config | Polling cycle runs | No tick; reactive-only |

### Requirement: Extended Handler Map

`daemonHandlerMap` MUST include: `morning-report`→morningReportDaemon, `eod-summary`→eodSummaryDaemon, `owned-ecommerce`→ownedEcommerceDaemon, `unanswered-questions`→unansweredQuestionsDaemon.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| New lanes dispatched | Claims for morning-report, eod-summary, owned-ecommerce, unanswered-questions | Scheduler routes | Each dispatched to respective daemon |

### Requirement: Advisor Wiring via Factory

`createDaemonAdvisorsFromEnv()` MUST read `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` and instantiate advisors for operations, catalog, cost-supplier, and creative lanes. Returns `undefined` per advisor when env vars missing.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| All vars set | DEEPSEEK_API_KEY + BASE_URL configured | Factory called | All advisors instantiated |
| No env vars | No DeepSeek vars | Factory called | All undefined; rule-only mode (no error) |

### Requirement: Supplier Adapter Wiring

`startSupplierMirrorScheduler()` MUST accept `supplierAdapters` config. Startup SHALL construct real adapters from env instead of `new Map()`. Falls back to empty Map when unconfigured.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Adapters configured | Env defines adapter URLs | Scheduler starts | Real adapters passed |
| No adapters | No env vars | Scheduler starts | Empty Map; internal mirror only (backward compatible) |

## MODIFIED Requirements

### Requirement: Agent-to-Daemon Handler Map

Handler map SHALL cover 13 lanes: cost-supplier, market-catalog, creative-assets, creative-commercial, operations-manager, product-ads-monitor, product-ads-profitability, product-ads-ceo-profitability, supplier-manager, morning-report, eod-summary, owned-ecommerce, unanswered-questions. Unknown lanes skipped.
(Previously: 9 lanes mapped; morning-report, eod-summary, owned-ecommerce, unanswered-questions missing.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Known lane | laneId="market-catalog" | Scheduler routes | Dispatched to marketCatalogDaemon |
| New lanes | morning-report, eod-summary, owned-ecommerce, unanswered-questions | Scheduler routes | Each dispatched to respective daemon |

### Requirement: Agent Polling Loop

Scheduler MUST poll `claimNext(agentId)` on configured interval (default 15 min). Before polling, SHALL call `enqueueDaemonTick(agentId)` for agents with cron/tick schedule. Suspended agents excluded from polling and tick generation.
(Previously: Reactive-only — claimed existing messages; no self-triggering.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Normal poll | Agent has pending message | Scheduler polls | claimNext returns message; dispatched |
| Tick triggers poll | Agent has matching cron schedule | Tick enqueued, then polled | Message claimed from tick; daemon investigates |
| Suspended agent | status="suspended" | Scheduler cycle | Excluded from polling and tick generation |
