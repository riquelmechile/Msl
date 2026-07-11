# Delta for daemon-scheduler

## ADDED Requirements

### Requirement: Economic Learning Daemon Registration

The `daemonHandlerMap` MUST include an entry mapping `"economic-learning"` →
`economicLearningDaemon`. The daemon SHALL be gated behind the
`MSL_ECONOMIC_LEARNING_ENABLED` environment variable.

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

## MODIFIED Requirements

### Requirement: Agent-to-Daemon Handler Map

Handler map SHALL cover 14 lanes: cost-supplier, market-catalog, creative-assets,
creative-commercial, operations-manager, product-ads-monitor, product-ads-profitability,
product-ads-ceo-profitability, supplier-manager, morning-report, eod-summary,
owned-ecommerce, unanswered-questions, economic-learning. Unknown lanes skipped.
(Previously: 13 lanes listed; economic-learning not registered.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Known lane | Agent with laneId "market-catalog" | Scheduler routes | Dispatched to marketCatalogDaemon |
| New lanes | morning-report, eod-summary, owned-ecommerce, unanswered-questions | Scheduler routes | Each dispatched to respective daemon |

#### Scenario: Economic learning lane dispatched

- GIVEN `MSL_ECONOMIC_LEARNING_ENABLED=true` and a claim for `"economic-learning"`
- WHEN the scheduler routes the message
- THEN it is dispatched to `economicLearningDaemon`
