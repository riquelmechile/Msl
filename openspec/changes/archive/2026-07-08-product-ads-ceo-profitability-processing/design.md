# Design: Product Ads CEO Profitability Processing

## Technical Approach

Register a new daemon handler (`ceoProfitabilityHandler`) in the scheduler for lane `product-ads-ceo-profitability`. The profitability daemon's `receiverAgentId` changes from `"ceo"` (discarded by the existing CEO consumption loop) to `"product-ads-ceo-profitability"` (processed by the new handler). The handler claims proposals, maps CFO signals to Product Ads action proposals, manages per-seller Telegram forum topics, and sends deduplicated proactive notifications. The existing `"ceo"` lane consumption loop in the scheduler remains unchanged for other daemon proposals.

Map: `DaemonHandler` input extended with optional `sendProactiveMessage`, `adminChatIds`, and `sellerNames` fields — same pattern as `supplierMirrorStore`.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|-----------|
| CEO handler as daemon handler | Register in `daemonHandlerMap` for new lane `product-ads-ceo-profitability` | Extend existing CEO consumption loop; separate worker process | Reuses claim/resolve lifecycle, error isolation, and scheduler dispatch patterns already used by 8 daemon handlers |
| Telegram access in daemon process | DaemonSchedulerConfig extended with grammY `Bot` API (separate from chat bot) | Bus-mediated notification queue; HTTP API between processes | grammY `Bot` instantiation is lightweight (API client only, no polling). Forum topic creation and notification delivery happen synchronously with processing — no added bus hop |
| Signal-to-action mapping | Hardcoded switch-case in handler per signal type → `proposalType` | Config-driven mapping; LLM classification at runtime | Deterministic, testable, zero latency. The 5 signal tiers are stable CFO categories |
| Forum topic persistence | JSON file (`msl-forum-topics.json`) in daemon root, keyed by sellerId | SQLite table in bus DB; in-memory only | Survives process restarts without DB schema migration. Topic creation is idempotent (grammY returns error if topic exists — catch and look up persisted ID) |
| Notification deduplication | `bus.lookupRecentByDedupePrefix("product-ads-cfo:{sellerId}:{campaignId}:{itemId}:{signal}", since7d)` | Separate dedupe store; notification history table | Reuses existing bus dedupe infrastructure used by the profitability daemon itself |

## Data Flow

```
Product Ads Profitability Daemon
    │
    │ enqueue(sender:"product-ads-profitability",
    │         receiver:"product-ads-ceo-profitability")
    ▼
Agent Message Bus ──claimNext("product-ads-ceo-profitability")──→ daemonScheduler
    │                                                                   │
    │                                                                   ▼
    │                                                      ceoProfitabilityHandler
    │                                                              │
    │                                   ┌──────────────────────────┼────────────────────────┐
    │                                   │                          │                        │
    │                                   ▼                          ▼                        ▼
    │                           ensureTopic()              mapSignalToAction()      dedupeCheck()
    │                           (grammY API)               (switch-case)           (bus.lookup)
    │                                   │                          │                        │
    │                                   ▼                          ▼                        ▼
    │                           forum topic ID            msl_prepare_               sendProactive
    │                           persisted to              product_ads_              Message(chatId,
    │                           msl-forum-topics.json     action()                  text, thread)
    │                                                                                     │
    │                           ◄──────────────────────────────────────────────────────────┘
    │                                                                                     
    ▼                                                                                     
bus.resolve(messageId)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/workers/ceoProfitabilityHandler.ts` | **Create** | Handler: claim → unpack → ensureTopic → mapSignal → dedupe → notify → resolve |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Add `ceoProfitabilityHandler` to `daemonHandlerMap`; extend `DaemonSchedulerConfig` with optional `telegramBot` config |
| `packages/agent/src/workers/daemonTypes.ts` | Modify | Add optional `sendProactiveMessage`, `adminChatIds`, `sellerNames` to `DaemonHandler` input |
| `packages/agent/src/workers/productAdsProfitabilityDaemon.ts` | Modify | Change `receiverAgentId` from `"ceo"` to `"product-ads-ceo-profitability"` |
| `packages/agent/src/conversation/lanes.ts` | Modify | Add `product-ads-ceo-profitability` to `LaneId` and `LANE_CONTRACTS` |
| `packages/agent/src/conversation/companyAgents.ts` | Modify | Add `product-ads-ceo-profitability` department mapping (`commercial`) |
| `scripts/start-agent-daemons.mjs` | Modify | Pass `BOT_TOKEN`, `MSL_TELEGRAM_ADMIN_CHAT_IDS`, seller names to scheduler config |
| `packages/agent/tests/workers/ceoProfitabilityHandler.test.ts` | **Create** | Unit tests: signal mapping, dedupe, topic management, notification dispatch |

## Interfaces / Contracts

```typescript
// Extended DaemonHandler input (optional fields)
type CeoHandlerContext = {
  sendProactiveMessage?: (chatId: number, text: string, threadId?: number) => Promise<void>;
  createForumTopic?: (chatId: number, name: string) => Promise<{ message_thread_id: number }>;
  adminChatIds?: string[];
  sellerNames?: Record<string, string>;
};

// Signal-to-action lookup
type CeoSignal = "margin-consuming" | "scale-candidate" | "budget-waste" | "underinvested" | "unit-economics";
type CeoAction = { proposalType: string; severity: string; requiresApproval: boolean };
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Signal mapping produces correct `proposalType` for all 5 signals | Table-driven tests in Vitest with mock claim payloads |
| Unit | 7-day dedupe logic: suppress within window, allow after expiry | Mock `bus.lookupRecentByDedupePrefix` with time-controlled fixtures |
| Unit | Forum topic management: create on first use, reuse from persisted JSON | Mock grammY API calls, assert topic ID persistence reads |
| Integration | Handler processes pending bus message end-to-end (claim → resolve) | In-memory SQLite bus, seed profitability proposal, assert resolve called |
| Integration | Scheduler dispatches `product-ads-ceo-profitability` lane correctly | Extend `daemonScheduler.test.ts` with lane dispatch assertion |

## Migration / Rollout

No data migration required. Rollback: remove handler from `daemonHandlerMap`, revert `receiverAgentId` change in profitability daemon, delete `ceoProfitabilityHandler.ts`.

## Open Questions

- [ ] `msl_prepare_product_ads_action` is an MCP tool — does the daemon process have access to the underlying action store, or should the handler call a shared `prepareProductAdsAction()` function extracted from the MCP server?
