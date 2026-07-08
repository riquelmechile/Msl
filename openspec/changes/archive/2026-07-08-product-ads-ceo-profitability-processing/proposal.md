# Proposal: Product Ads CEO Profitability Processing

## Intent
The profitability daemon detects margin-consuming ads and scale opportunities daily, but the CEO lane discards every proposal — claimed, logged, resolved. Sellers have zero visibility into ad economics problems the system already detects. This change wires the CEO to process profitability proposals into actionable Telegram notifications.

## Scope

### In Scope
- CEO daemon handler for `product-ads-profitability` proposals
- Hardcoded signal→action mapping: margin-consuming→pause, scale-candidate→budget-increase, budget-waste→review, underinvested→allocate, unit-economics→info-report
- Per-seller Telegram forum topics (grammY `createForumTopic`) in admin chat, topic IDs persisted
- Both sellers (Plasticov + Maustian) from day one
- Actions via `msl_prepare_product_ads_action` with `requiresApproval: true`
- Rolling 7-day dedupe on notifications matching daemon's identity

### Out of Scope
- Other daemon types, DeepSeek reasoning, two-way reply-to-approve, auto-execution

## Capabilities

### New Capabilities
- `ceo-profitability-handler`: Daemon handler that claims CEO proposals, maps profitability signals to Product Ads actions, manages per-seller forum topics, and sends proactive Telegram notifications

### Modified Capabilities
- `daemon-scheduler`: Add CEO handler to `daemonHandlerMap` for `product-ads-profitability` proposals (currently skipped)
- `product-ads-profitability-daemon`: Add CEO consumption pipeline requirement — enqueued proposals must be claimable and actionable

## Approach

**CEO Daemon Handler** registered in `daemonHandlerMap`:
1. Claim CEO message from bus → unpack profitability payload
2. Resolve admin chat (`MSL_TELEGRAM_ADMIN_CHAT_IDS`) → ensure per-seller forum topic
3. Map each finding: margin-consuming→pause-campaign, scale-candidate→budget-increase, budget-waste→review-campaign, underinvested→budget-allocate, unit-economics→info-report
4. `prepare_product_ads_action` for actionable findings (all require seller approval)
5. Send proactive Telegram message to seller's forum topic
6. Resolve bus message

Forum topics created once per seller, persisted locally to survive restarts. Dedupe identity: `product-ads-cfo:{sellerId}:{campaignId}:{itemId}:{tier}`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/workers/ceoProfitabilityHandler.ts` | New | Signal mapping, action prep, Telegram dispatch |
| `packages/agent/src/workers/daemonScheduler.ts` | Modified | Add CEO to daemonHandlerMap |
| `packages/bot/src/index.ts` | Modified | Expose forum topic creation + topic ID persistence |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Duplicate notifications | Medium | 7-day dedupe via bus identity, matched to daemon window |
| Topic/chat ID unavailable | Low | Admin chat from env; topic created on first use, persisted |
| Action expiry before review | Low | 48h expiry; skip findings older than 24h |

## Rollback Plan
Remove CEO from `daemonHandlerMap`. Delete `ceoProfitabilityHandler.ts`. Revert bot forum topic exports. No DB migrations.

## Success Criteria
- [ ] `npm test` passes with handler unit tests
- [ ] Handler claims pending CEO profitability proposals on scheduler cycle
- [ ] Actionable findings produce `msl_prepare_product_ads_action` records with `requiresApproval: true`
- [ ] Info findings produce info-only Telegram messages
- [ ] 7-day dedupe prevents re-notification for same finding identity
