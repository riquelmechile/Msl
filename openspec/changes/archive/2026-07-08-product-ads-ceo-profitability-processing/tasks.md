# Tasks: Product Ads CEO Profitability Processing

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~300–400 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Foundation

- [x] 1.1 Extend `daemonTypes.ts`: add `CeoHandlerContext` with `sendProactiveMessage`, `createForumTopic`, `adminChatIds`, `sellerNames`
- [x] 1.2 Add `product-ads-ceo-profitability` to `LaneId` enum and `LANE_CONTRACTS` in `lanes.ts`
- [x] 1.3 Add `product-ads-ceo-profitability` department mapping (`commercial`) in `companyAgents.ts`

## Phase 2: Core Implementation

- [x] 2.1 Create `ceoProfitabilityHandler.ts`: claim payload → unpack findings → map signal to action type
- [x] 2.2 Implement `ensureTopic()`: create forum topic via grammY API, persist to `msl-forum-topics.json`
- [x] 2.3 Implement 7-day dedupe check via `bus.lookupRecentByDedupePrefix` with identity `product-ads-cfo:{sellerId}:{campaignId}:{itemId}:{tier}`
- [x] 2.4 Wire notification dispatch: call `msl_prepare_product_ads_action` for actionable signals, send Telegram for info signals
- [x] 2.5 Add error handling: `fail()` on claim/processing error, skip findings with stale timestamps (>24h)

## Phase 3: Wiring

- [x] 3.1 Register `ceoProfitabilityHandler` in `daemonScheduler.ts` `daemonHandlerMap`
- [x] 3.2 Extend `DaemonSchedulerConfig` with optional `telegramBot` references
- [x] 3.3 Change `receiverAgentId` in `productAdsProfitabilityDaemon.ts` from `"ceo"` to `"product-ads-ceo-profitability"`
- [x] 3.4 Update `scripts/start-agent-daemons.mjs` to pass `BOT_TOKEN`, `MSL_TELEGRAM_ADMIN_CHAT_IDS`, seller name mapping

## Phase 4: Testing

- [x] 4.1 Write table-driven unit tests for signal→action mapping (all 5 signal types)
- [x] 4.2 Write unit tests for 7-day dedupe logic (suppress within window, allow after expiry)
- [x] 4.3 Write unit tests for forum topic management (create on first use, reuse persisted)
- [x] 4.4 Write integration test: handler claims → processes → resolves bus message end-to-end
- [x] 4.5 Extend scheduler test to assert `product-ads-ceo-profitability` lane dispatch
