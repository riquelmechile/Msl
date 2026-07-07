# Delta for multi-agent-orchestration

## MODIFIED Requirements

### Requirement: Cache-Resident Specialist Lanes

The system MUST define CEO, Cost/Supplier, Market/Catalog, Operations Manager, and Creative/Commercial lanes with stable lane prefixes, bounded responsibilities, and proposal-only outputs. Each non-CEO lane SHALL have a scheduled daemon worker that polls the message bus, investigates operational evidence, and enqueues proposals to the CEO. The Market/Catalog and Operations Manager lane daemons SHALL absorb quality-check and relist-check logic from background ingestion.
(Previously: Lanes were defined without Operations Manager lane, daemon scheduling, or background ingestion eviction.)

#### Scenario: CEO coordinates lanes

- GIVEN the seller approves bounded investigation
- WHEN specialist lanes complete their analysis
- THEN the CEO lane MUST synthesize one recommendation with risks, missing inputs, and evidence IDs

#### Scenario: Lane boundary exceeded

- GIVEN a lane needs an action outside its responsibility
- WHEN it prepares output
- THEN it MUST return a boundary warning instead of executing or expanding scope

#### Scenario: Daemon scheduler wakes specialist lanes

- GIVEN the daemon scheduler is running
- WHEN a specialist lane's agent has pending messages on the bus
- THEN the lane's daemon SHALL claim, investigate evidence, and enqueue a proposal to the CEO

## ADDED Requirements

### Requirement: Operations Manager Specialist Lane

The system MUST add an Operations Manager lane (`laneId: "operations-manager"`) under CEO orchestration. Its daemon SHALL detect new claims, unanswered questions, critical messages, delayed orders, and reputation risks. The lane outputs SHALL be proposal-only and routed to the CEO.

#### Scenario: Operations daemon detects open claim

- GIVEN an open claim exists for a seller
- WHEN the operations manager daemon investigates
- THEN it SHALL enqueue a CEO proposal with the claim evidence and recommended action

#### Scenario: Operations lane is proposal-only

- GIVEN the operations manager lane has a finding
- WHEN preparing output
- THEN it MUST NOT execute mutations, respond to buyer questions, or resolve claims directly

### Requirement: Daemon Scheduler Coordination

The system SHALL support `startDaemonScheduler()` that runs alongside `startBackgroundIngestion()`. The daemon scheduler SHALL register agent-to-daemon mappings, poll the agent message bus on configurable intervals, and coordinate daemon lifecycle with the CEO lane. Quality-check and relist-check phases SHALL be evicted from background ingestion and absorbed by `marketCatalogDaemon`.

#### Scenario: Scheduler starts alongside ingestion

- GIVEN both `startBackgroundIngestion()` and `startDaemonScheduler()` are invoked
- WHEN the system is running
- THEN background ingestion continues writing evidence and daemon scheduler reads it

#### Scenario: Quality/relist logic evicted from ingestion

- GIVEN the daemon scheduler is active
- WHEN background ingestion runs its phases
- THEN it SHALL NOT invoke `runQualityChecks()` or `runRelistChecks()`

### Requirement: Agent Autonomy via Message Bus

Company agents registered in the `company_agents` table SHALL be discoverable by the daemon scheduler. Agents with a matching daemon handler SHALL wake on the configured interval, receive pending messages from the bus, and generate proposals autonomously — without human prompting — bounded by their lane's `noMutationBoundary`.

#### Scenario: Agent wakes without human prompt

- GIVEN a market-catalog agent is registered and active
- WHEN the scheduler's interval fires
- THEN the agent's daemon SHALL investigate evidence and enqueue a proposal
- AND no human message is required to trigger the cycle

#### Scenario: Suspended agent stays dormant

- GIVEN an agent has status "suspended"
- WHEN the daemon scheduler evaluates agents
- THEN the agent SHALL be excluded from polling
