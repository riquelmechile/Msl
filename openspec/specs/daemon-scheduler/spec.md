# daemon-scheduler Specification

## Purpose

A configurable poll-dispatch loop that wakes specialist agents on a schedule, claims their pending messages from the agent message bus, routes to matching daemon handlers, and resolves or fails the message on the bus. Survives daemon errors without crashing.

## Requirements

### Requirement: Agent Polling Loop

The scheduler MUST poll `agentMessageBusStore.claimNext(agentId)` for each active company agent in rotation, with a configurable interval per agent defaulting to 15 minutes. The system SHALL invoke `listCompanyAgents()` once per polling cycle and skip agents not found in the daemon handler map.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Normal poll | Agent has pending message | Scheduler polls for that agent | `claimNext` returns message, dispatched to daemon |
| No pending | Agent has no pending messages | claimNext returns empty | Scheduler moves to next agent |
| No handler | Agent exists but no matching daemon | Scheduler evaluates agent | Agent skipped, no error |
| Suspended agent | Agent status is "suspended" | Scheduler executes cycle | Agent excluded from polling |

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

The scheduler MUST maintain a static mapping from `LaneId` to daemon handler functions. Only lanes `cost-supplier`, `market-catalog`, `creative-commercial`, `operations-manager`, and `product-ads-monitor` SHALL have handlers. Unknown lanes MUST be skipped.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Known lane | Agent with laneId "market-catalog" | Scheduler routes | Dispatched to marketCatalogDaemon |
| Product Ads Monitor lane | Agent with laneId "product-ads-monitor" | Scheduler routes | Dispatched to productAdsMonitorDaemon |
| CEO lane | Agent with laneId "ceo" | Scheduler routes | Skipped — no daemon handler |
| Unknown lane | Agent with unmapped laneId | Scheduler routes | Skipped — no error |
