## Exploration: Product Ads CEO Profitability Processing

### Current State

The `productAdsProfitabilityDaemon` (shipped 2026-07-08) evaluates per-product advertising economics every scheduler cycle and enqueues rich findings to the CEO lane via `AgentMessageBusStore`:

- **Payloads** carry: `type`, `tier`, `severity`, `findings[]`, `recommendationIdentity`, `recommendedAction`, `actionability` (`seller-impacting` | `data-quality`), `capturedAt`, `noMutationExecuted: true`
- **Dedupe identity**: `product-ads-cfo:{sellerId}:{campaignId}:{itemId}:{tier}` with rolling 7-day window
- **On the bus**: Receiver is `ceo`, sender is `product-ads-profitability`, message type is `proposal`

However, **the CEO lane does NOT process these proposals meaningfully today**:

1. The **daemon scheduler** (`daemonScheduler.ts` lines 108-160) consumes CEO messages by claiming them, logging the summary, optionally auto-submitting a consensus review for high-risk action kinds, and resolving the message. **No reasoning, no action mapping, no Telegram notification.**
2. The **CEO agent loop** (`agentLoop.ts`) runs only on conversational user input via Telegram — it does NOT proactively wake to process bus messages.
3. There is no `ceo` entry in `daemonHandlerMap` — the CEO lane is intentionally skipped (per daemon-scheduler spec).
4. No mechanism exists to map profitability signals (`margin-consuming`, `scale-candidate`, `budget-waste`, `underinvested`, `unit-economics`) to concrete action proposals that enter the Telegram approval pipeline.

**The system detects problems but never acts on them.**

### Existing Patterns That Inform the Solution

| Pattern | Location | Relevance |
|---------|----------|-----------|
| Proactive Telegram alerts | `backgroundIngestion.ts` uses `sendProactiveMessage(chatId, text)` | Shows how to push notifications to sellers without waiting for user input |
| Product Ads action preparation | `packages/mcp/src/index.ts` → `prepare_product_ads_action` | Already creates `PreparedAction` records with `kind: "product-ads-action"`, supports `adjust-campaign-budget`, `pause-campaign`, `resume-campaign`, `pause-ad`, `resume-ad`, `review-campaign-structure` |
| Approval queue repository | `packages/tools/src/index.ts` (SQLite-backed) | Persists pending/approved/expired actions; `msl_prepare_product_ads_action` MCP tool uses it |
| Daemon handler map | `daemonScheduler.ts` → `daemonHandlerMap` | Static LaneId → DaemonHandler mapping; extensible |
| Agent message bus | `agentMessageBusStore.ts` | `claimNext(receiverAgentId)`, `lookupRecentByDedupePrefix()` for dedupe |
| Operational lane evidence | `operationalEvidenceProvider.ts` | `getStructuredEvidenceForLane()` returns typed signal data arrays for reasoning |
| CEO lane contract | `lanes.ts` (CEO_LANE) | Already defines CEO as coordinator with `requiredEvidenceKinds: ["specialist-output", "approval-scope"]` |

### Affected Areas

| File | Why |
|------|-----|
| `packages/agent/src/workers/daemonScheduler.ts` | CEO consumption loop needs extension or replacement — currently just logs and resolves |
| `packages/agent/src/workers/daemonTypes.ts` | May need CEO-specific daemon result types or extended DaemonHandler for the CEO lane |
| `packages/agent/src/conversation/lanes.ts` | May need CEO daemon contract extension or lane amendments |
| `packages/agent/src/conversation/companyAgents.ts` | May need CEO lane registration in daemonHandlerMap or new agent type |
| `packages/bot/src/index.ts` | `sendProactiveMessage` is the delivery channel — CEO needs access to Telegram chat IDs and the send capability |
| `packages/agent/src/conversation/agentLoop.ts` | May need a "proactive reasoning" mode or the CEO handler may create its own agent loop |
| `packages/agent/src/conversation/agentMessageBusStore.ts` | May need richer querying (find messages by sender, type, payload) |
| `packages/mcp/src/index.ts` | `prepare_product_ads_action` is the approval-gated action creator — CEO must call this (directly or via MCP) |
| `openspec/specs/product-ads-profitability-daemon/spec.md` | Needs new requirement for CEO consumption pipeline |
| New: `packages/agent/src/workers/ceoProfitabilityHandler.ts` | Recommended new file for the CEO profitability reasoning logic |

### Approaches

#### 1. **CEO Daemon Handler** (Recommended)
Register a `ceo` handler in `daemonHandlerMap` that claims profitability proposals from the bus, reasons over signals, maps to concrete actions, calls `prepare_product_ads_action`, and sends proactive Telegram messages via `sendProactiveMessage`.

```
scheduler cycle → claimNext("ceo") 
  → ceoProfitabilityHandler()
    → parse profitability payload
    → getStructuredEvidenceForLane("product-ads-profitability", sellerId)
    → reason: map each finding to concrete action
      "margin-consuming" → pause-campaign or adjust-campaign-budget
      "scale-candidate" → adjust-campaign-budget (increase)
      "budget-waste" → review-campaign-structure or adjust-campaign-budget (reduce)
      "underinvested" → adjust-campaign-budget (increase)
      "unit-economics" → informational
    → call prepare_product_ads_action for each actionable finding
    → sendProactiveMessage(chatId, summary) with action details
    → resolve() on bus
```

- **Pros**: Clean separation, follows existing daemon pattern, decouples reasoning from the scheduler dispatch loop, testable in isolation
- **Cons**: CEO handler needs access to `prepareWrite` (ApprovalQueueRepository + clock) and Telegram `sendProactiveMessage` — more dependencies than existing daemons
- **Effort**: Medium (3-5 files, ~250-400 lines new code)

#### 2. **Extend Scheduler CEO Consumption**
Add reasoning logic directly in the scheduler's CEO message loop (`daemonScheduler.ts` lines 108-160).

- **Pros**: Minimal file changes, no new handler registration needed
- **Cons**: Blurs the scheduler's dispatch responsibility with business logic, harder to test, scheduler already handles multiple concerns
- **Effort**: Low (1-2 files, ~150-250 lines)

#### 3. **Proactive CEO Process**
Create a standalone polling process (separate PM2 worker) that independently polls the bus, uses DeepSeek to reason over findings, and sends Telegram notifications.

- **Pros**: Most flexible, independent deployment, can use full LLM reasoning
- **Cons**: Heaviest — separate process, state management, DeepSeek costs, deployment complexity. Over-engineered for the first slice.
- **Effort**: High (new worker, DeepSeek integration, testing, deployment)

### Recommendation

**Approach 1: CEO Daemon Handler** — register a `ceo` handler in the daemon handler map for `product-ads-profitability` proposals only.

Rationale:
- **Follows existing patterns**: daemon handlers are the established extension point for scheduled reasoning. The scheduler already polls agents and dispatches.
- **Testability**: the handler is a pure function with dependencies injected, matching the `DaemonHandler` signature.
- **Minimal new infrastructure**: reuses `prepare_product_ads_action`, `sendProactiveMessage`, `AgentMessageBusStore`, and `ApprovalQueueRepository`.
- **First slice scoping**: handle only `product-ads-profitability` proposals. Other daemon proposal types (`creative-assets`, `supplier-manager`, etc.) can be added later without redesign.

### Risks

| Risk | Mitigation |
|------|------------|
| **Telegram chat ID discovery** — the daemon handler must know which chat IDs to send proactive messages to. The bot's `listActiveChats()` returns them, but the handler needs access to a `TelegramBotHandle` or similar. | In background ingestion, the config provides `sendProactiveMessage` and `listActiveChats` callbacks. The daemon handler config can follow the same pattern. |
| **Duplicate Telegram notifications** — if the scheduler runs every 15 minutes, the same finding could trigger multiple notifications within the 7-day window. | The daemon already implements rolling 7-day dedupe on enqueue. The CEO handler must additionally track which findings already generated Telegram actions (via `ApprovalQueueRepository.findAction` or bus dedupe). |
| **prepare_product_ads_action dependency** — the MCP `prepare_product_ads_action` tool requires `read_product_ads_insights` evidence timestamps. The profitability daemon payload does not currently include the raw insights data needed. | The daemon payload carries `evidenceIds` and `capturedAt`. The CEO handler can retrieve structured evidence via `getStructuredEvidenceForLane()` to build the required `metricsSnapshotSummary`. |
| **Action expiration** — prepared actions expire. Discovery-to-notification latency could create stale proposals. | The handler sets `expiresAt` with reasonable margin (24-48h). No action taken if the finding `capturedAt` is older than 24h. |
| **First slice is opinionated** — signal-to-action mapping is hardcoded. Not all signals may map cleanly. | Use a simple rule-based mapper (the daemon already has thresholds). Review after real data. |

### Ready for Proposal

**Yes** — with the following scope boundaries:

**In scope (first slice):**
- CEO daemon handler that processes `product-ads-profitability` proposals only
- Signal-to-action mapping for 4 of 5 signal types (exclude `unit-economics` info as non-actionable)
- Integration with `prepare_product_ads_action` for action creation
- Proactive Telegram notification via callback-based `sendProactiveMessage`
- Rolling dedupe so same finding doesn't re-notify within 7-day window
- Tests for the handler in isolation

**Out of scope (future slices):**
- Processing proposals from other daemons (`creative-assets`, `supplier-manager`, `operations-manager`)
- DeepSeek-based reasoning over findings (hardcoded mapping is sufficient for v1)
- Two-way Telegram reply-to-approve flow (user reads notification, visits bot to confirm)
- `/start`-type proactive conversation initiation

**Clarification needed:**
- How does the CEO handler discover the target Telegram chat ID? Should it message all active chats, or a configured admin chat? This affects whether the handler needs `listActiveChats()` or a static chat ID config.
