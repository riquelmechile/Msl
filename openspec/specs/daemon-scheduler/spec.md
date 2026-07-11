# daemon-scheduler Specification

## Purpose

A configurable poll-dispatch loop that wakes specialist agents on a schedule, claims their pending messages from the agent message bus, routes to matching daemon handlers, and resolves or fails the message on the bus. Survives daemon errors without crashing. Daemons now dispatch per-seller with account context.

## Requirements

### Requirement: Agent Polling Loop

Scheduler MUST poll `claimNext(agentId)` on configured interval (default 15 min). Before polling, SHALL call `enqueueDaemonTick(agentId)` for agents with cron/tick schedule. Suspended agents excluded from polling and tick generation. **The scheduler SHALL dispatch each daemon handler once per `sellerId` in the configured seller list.**

(Previously: daemon handlers were invoked once globally, not per-seller.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Normal poll | Agent has pending message | Scheduler polls for that agent | `claimNext` returns message, dispatched to daemon |
| Tick triggers per-seller poll | Agent has matching cron schedule | Tick enqueued, then polled | Handler invoked per seller with scoped context |
| No pending | Agent has no pending messages | claimNext returns empty | Scheduler moves to next agent |
| No handler | Agent exists but no matching daemon | Scheduler evaluates agent | Agent skipped, no error |
| Suspended agent | Agent status is "suspended" | Scheduler executes cycle | Agent excluded from polling and tick generation |

#### Scenario: Tick triggers per-seller polls

- GIVEN sellerIds = ["plasticov", "maustian"] and market-catalog cron fires
- WHEN the tick is enqueued and polled
- THEN the handler is invoked for Plasticov, then for Maustian, each with scoped context

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

For each claimed message, the scheduler MUST call the matching daemon's `investigate()` function **with the per-seller `accountContext`**. On success, the scheduler MUST `resolve()` the message. On daemon error, the scheduler MUST `fail()` the message with the error string and continue to the next agent **and next seller**.

(Previously: handler input did not include account context.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Successful per-seller dispatch | Claimed message, daemon returns DaemonResult | investigate() succeeds for seller | Message resolved, next seller begins |
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

Handler map SHALL cover 14 lanes: cost-supplier, market-catalog, creative-assets, creative-commercial, operations-manager, product-ads-monitor, product-ads-profitability, product-ads-ceo-profitability, supplier-manager, morning-report, eod-summary, owned-ecommerce, unanswered-questions, economic-learning. Unknown lanes skipped.
(Previously: 13 lanes listed; economic-learning not registered.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Known lane | Agent with laneId "market-catalog" | Scheduler routes | Dispatched to marketCatalogDaemon |
| New lanes | morning-report, eod-summary, owned-ecommerce, unanswered-questions | Scheduler routes | Each dispatched to respective daemon |
| Economic learning lane | Agent with laneId "economic-learning" and MSL_ECONOMIC_LEARNING_ENABLED=true | Scheduler routes | Dispatched to economicLearningDaemon |

### Requirement: Extended Handler Map

`daemonHandlerMap` MUST include: `morning-report`→morningReportDaemon, `eod-summary`→eodSummaryDaemon, `owned-ecommerce`→ownedEcommerceDaemon, `unanswered-questions`→unansweredQuestionsDaemon.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| New lanes dispatched | Claims for morning-report, eod-summary, owned-ecommerce, unanswered-questions | Scheduler routes | Each dispatched to respective daemon |

### Requirement: Economic Learning Daemon Registration

The `daemonHandlerMap` MUST include an entry mapping `"economic-learning"` → `economicLearningDaemon`. The daemon SHALL be gated behind the `MSL_ECONOMIC_LEARNING_ENABLED` environment variable.

#### Scenario: Economic learning daemon registered and enabled

- GIVEN `MSL_ECONOMIC_LEARNING_ENABLED=true`
- WHEN `startDaemonScheduler()` initializes the handler map
- THEN the `"economic-learning"` lane maps to the `economicLearningDaemon` handler
- AND the daemon participates in the agent polling loop

#### Scenario: Economic learning daemon disabled

- GIVEN `MSL_ECONOMIC_LEARNING_ENABLED=false` (or unset)
- WHEN `startDaemonScheduler()` initializes the handler map
- THEN the `"economic-learning"` lane is excluded from the handler map
- AND the daemon is never invoked during polling cycles

#### Scenario: Economic learning daemon follows claim-dispatch-resolve

- GIVEN the economic learning daemon is registered and a tick fires
- WHEN a message is claimed for the `"economic-learning"` lane
- THEN `investigate()` is called with per-seller account context
- AND on success the message is resolved
- AND on failure the message is failed

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

### Requirement: Per-Seller Daemon Dispatch

The daemon scheduler MUST iterate `sellerIds` from configuration and dispatch each daemon handler with per-seller account context. Each daemon handler invocation SHALL receive the current seller's `sellerId` in the handler input.

#### Scenario: Daemon iterates seller IDs

- GIVEN `sellerIds = ["plasticov", "maustian"]` and a `market-catalog` tick fires
- WHEN the scheduler dispatches the handler
- THEN the handler MUST be invoked once per seller
- AND each invocation MUST receive the respective `sellerId`

#### Scenario: Single seller unchanged behavior

- GIVEN `sellerIds = ["plasticov"]`
- WHEN a daemon tick fires
- THEN the handler MUST be invoked once with `sellerId = "plasticov"`

### Requirement: Scoped Operational Evidence

When a daemon handler queries operational evidence (via `OperationalReadModelReader`), the query MUST be scoped to the daemon's current `sellerId`. A daemon processing for Plasticov MUST NOT receive Maustian's operational data.

#### Scenario: Evidence scoped to current seller

- GIVEN the `market-catalog` daemon runs for `sellerId = "plasticov"`
- WHEN it queries operational snapshots
- THEN only Plasticov's listings, orders, and claims MUST be returned

### Requirement: Account Context in Daemon Handler Input

The `DaemonHandler` input type MUST include `accountContext: { sellerId: SellerId, asset?: AccountAsset }`. The `accountAsset` SHALL be populated from `AccountAssetStore` when available, or `undefined` for backward compatibility.

#### Scenario: Handler receives account context

- GIVEN an `AccountAsset` exists for Plasticov with capabilities and profit goal
- WHEN a daemon handler is invoked for `sellerId = "plasticov"`
- THEN `input.accountContext.sellerId` MUST be `"plasticov"`
- AND `input.accountContext.asset` MUST contain the `AccountAsset` record

#### Scenario: Handler works without asset context

- GIVEN no `AccountAssetStore` is configured
- WHEN a daemon handler is invoked
- THEN `input.accountContext.asset` MUST be `undefined`
- AND the handler MUST still function with `sellerId` alone

### Requirement: Per-Seller Dedupe Keys

Daemon tick deduplication MUST include `seller_id` in the dedupe key. A tick for `market-catalog` with `seller_id = "plasticov"` MUST NOT deduplicate against the same lane for `seller_id = "maustian"`.

#### Scenario: Dedupe keys scoped per account

- GIVEN a `daemon_tick` for `market-catalog` with `seller_id = "plasticov"` at 10:00
- WHEN a `daemon_tick` for `market-catalog` with `seller_id = "maustian"` is enqueued at 10:00
- THEN both ticks MUST be enqueued (different dedupe scopes)
