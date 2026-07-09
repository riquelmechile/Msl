# Delta for daemon-scheduler

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Agent Polling Loop

Scheduler MUST poll `claimNext(agentId)` on configured interval (default 15 min). **The scheduler SHALL dispatch each daemon handler once per `sellerId` in the configured seller list.** Suspended agents excluded from polling and tick generation.

(Previously: daemon handlers were invoked once globally, not per-seller.)

#### Scenario: Tick triggers per-seller polls

- GIVEN sellerIds = ["plasticov", "maustian"] and market-catalog cron fires
- WHEN the tick is enqueued and polled
- THEN the handler is invoked for Plasticov, then for Maustian, each with scoped context

### Requirement: Claim-Dispatch-Resolve Lifecycle

For each claimed message, the scheduler MUST call the matching daemon's `investigate()` function **with the per-seller `accountContext`**. On success, the scheduler MUST `resolve()` the message. On daemon error, the scheduler MUST `fail()` the message with the error string and continue to the next agent **and next seller**.

(Previously: handler input did not include account context.)

#### Scenario: Successful per-seller dispatch

- GIVEN a claimed message for market-catalog with sellerIds = ["plasticov", "maustian"]
- WHEN investigate() succeeds for Plasticov
- THEN Plasticov's work is resolved and Maustian's dispatch begins
- WHEN investigate() succeeds for both
- THEN the message is fully resolved

## REMOVED Requirements

(None)
