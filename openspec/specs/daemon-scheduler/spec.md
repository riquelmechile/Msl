# daemon-scheduler Specification

## Purpose

A configurable poll-dispatch loop that wakes specialist agents on a schedule, claims their pending messages from the agent message bus, routes to matching daemon handlers, and resolves or fails the message on the bus. Survives daemon errors without crashing.

## Requirements

### Requirement: Agent Polling Loop

Scheduler MUST poll `claimNext(agentId)` on configured interval (default 15 min). Before polling, SHALL call `enqueueDaemonTick(agentId)` for agents with cron/tick schedule. Suspended agents excluded from polling and tick generation.
(Previously: Reactive-only — claimed existing messages; no self-triggering.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Normal poll | Agent has pending message | Scheduler polls for that agent | `claimNext` returns message, dispatched to daemon |
| Tick triggers poll | Agent has matching cron schedule | Tick enqueued, then polled | Message claimed from tick; daemon investigates |
| No pending | Agent has no pending messages | claimNext returns empty | Scheduler moves to next agent |
| No handler | Agent exists but no matching daemon | Scheduler evaluates agent | Agent skipped, no error |
| Suspended agent | Agent status is "suspended" | Scheduler executes cycle | Agent excluded from polling and tick generation |

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

### Requirement: Claim-Dispatch-Resolve Lifecycle

For each claimed message, the scheduler MUST call the matching daemon's `investigate()` function. On success, the scheduler MUST `resolve()` the message. On daemon error, the scheduler MUST `fail()` the message with the error string and continue to the next agent.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Successful dispatch | Claimed message, daemon returns DaemonResult | investigate() succeeds | Message resolved on bus |
| Daemon throws | Claimed message, daemon throws Error | investigate() fails | Message failed on bus, scheduler continues |
| Fail retry | Message at attempts < maxAttempts | fail() called | Message re-enters pending for next cycle |

### Requirement: Scheduler Lifecycle

`startDaemonScheduler(config)` MUST return `{ stop: () => void }`. The scheduler SHALL run one cycle immediately on start, then on the configured interval. `stop()` MUST clear the interval timer.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Start | Valid config with store + handler map | startDaemonScheduler() | Returns stop handle, first cycle runs |
| Stop | Running scheduler | stop() called | Timer cleared, no further cycles |
| Configurable interval | Interval set to 300000ms | Scheduler running | Cycles spaced by 5 minutes |

### Requirement: Error Isolation

A daemon crash MUST NOT bring down the scheduler. The scheduler SHALL catch daemon errors, fail the offending message, and proceed to the next agent in the same cycle.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| One daemon panics | Agent A's daemon throws | Scheduler dispatches | Agent A's message failed, agent B polled next |
| All agents fail | All daemons throw in one cycle | Scheduler dispatches | All messages failed, scheduler schedules next cycle |

### Requirement: Agent-to-Daemon Handler Map

Handler map SHALL cover 13 lanes: cost-supplier, market-catalog, creative-assets, creative-commercial, operations-manager, product-ads-monitor, product-ads-profitability, product-ads-ceo-profitability, supplier-manager, morning-report, eod-summary, owned-ecommerce, unanswered-questions. Unknown lanes skipped.
(Previously: 9 lanes mapped; morning-report, eod-summary, owned-ecommerce, unanswered-questions missing.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Known lane | Agent with laneId "market-catalog" | Scheduler routes | Dispatched to marketCatalogDaemon |
| New lanes | morning-report, eod-summary, owned-ecommerce, unanswered-questions | Scheduler routes | Each dispatched to respective daemon |

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
