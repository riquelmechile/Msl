## Exploration: Product Ads CEO Complete — Wire prepareProductAdsAction + Missing-Data CEO Flow

### Artifact Mode

`openspec` — file written to `openspec/changes/product-ads-ceo-complete/exploration.md`.

---

### Recommendation at a Glance

**These should be TWO separate changes**, not one. They address independent gaps with different risk profiles and touch different concerns. See per-task analysis below.

- **Task 1** (Wire `prepareProductAdsAction`): Ready for **proposal** — small, safe, well-understood.
- **Task 2** (Missing-data CEO flow): Ready for **proposal** — but needs scoping decisions about Telegram two-way interaction.

---

## Task 1: Wire prepareProductAdsAction in the CEO handler

### Current State

The `ceoProfitabilityHandler` already supports the `ceoCtx.prepareProductAdsAction` callback:

- **Handler** (`packages/agent/src/workers/ceoProfitabilityHandler.ts` lines 285-288): calls `ceoCtx.prepareProductAdsAction(actionPayload)` for findings with `requiresApproval: true`
- **Daemon types** (`packages/agent/src/workers/daemonTypes.ts` lines 42-54): defines the callback signature in `CeoHandlerContext`
- **Tests** (`packages/agent/tests/workers/ceoProfitabilityHandler.test.ts`): all pass with mock callbacks — tests prove the wiring contract works

**However**, `scripts/start-agent-daemons.mjs` (lines 78-96) only wires `sendProactiveMessage`, `createForumTopic`, `adminChatIds`, and `sellerNames`. It does NOT provide `prepareProductAdsAction`:

```ts
// Line 84-95: current ceoContext — no prepareProductAdsAction
ceoContext = {
  sendProactiveMessage: async (chatId, text, threadId) => { ... },
  createForumTopic: async (chatId, name) => { ... },
  adminChatIds,
  sellerNames,
};
```

The MCP server (`packages/mcp/src/index.ts` lines 622-743) implements `prepareProductAdsAction` internally. It:

1. Validates inputs (sellerId, proposalType, evidence, expiry)
2. Assesses risk via `productAdsRisk()`
3. Builds a `PreparedAction` with action ID, target, exact changes
4. Persists to `ApprovalQueueRepository` (either SQLite via `MSL_APPROVAL_QUEUE_DB_PATH` or in-memory)

The `ApprovalQueueRepository` type and its implementations (`createInMemoryApprovalQueueRepository`, `createSqliteApprovalQueueRepository`) live in `@msl/tools` (`packages/tools/src/index.ts` lines 387-433, 470-472) — a shared package that both `@msl/agent` and `@msl/mcp` already depend on.

### Affected Areas

| File | Why |
|------|-----|
| `scripts/start-agent-daemons.mjs` | Needs `prepareProductAdsAction` in `ceoContext` — the only change required |
| `packages/mcp/src/index.ts` | `prepareProductAdsAction` internal function — consider extracting shared logic, or leave in place |
| `packages/tools/src/index.ts` | `ApprovalQueueRepository` + `createSqliteApprovalQueueRepository` already here — import target for daemon |
| `packages/agent/src/workers/ceoProfitabilityHandler.ts` | No changes needed — callback already wired internally |

### Approaches

#### 1. Wire directly with `@msl/tools` ApprovalQueueRepository (Recommended)

In `scripts/start-agent-daemons.mjs`, import `createSqliteApprovalQueueRepository` (or `createInMemoryApprovalQueueRepository` as fallback) from `@msl/tools` and wire a simple callback:

```ts
const { createSqliteApprovalQueueRepository, createInMemoryApprovalQueueRepository } =
  await import("@msl/tools");

const approvalQueuePath = env.MSL_APPROVAL_QUEUE_DB_PATH?.trim();
const approvalRepo = approvalQueuePath
  ? createSqliteApprovalQueueRepository(approvalQueuePath)
  : createInMemoryApprovalQueueRepository();

ceoContext.prepareProductAdsAction = async (input) => {
  const actionId = `product-ads:${input.proposalType}:${input.sellerId}:${new Date().toISOString()}`;
  const action = {
    id: actionId,
    sellerId: input.sellerId,
    kind: "product-ads-action" as const,
    target: {
      type: "product-ads-campaign" as const,
      campaignId: input.campaignId,
      itemId: input.itemId,
      adId: input.adId,
    },
    exactChange: [
      { field: "sellerId", from: null, to: input.sellerId },
      { field: "proposalType", from: null, to: input.proposalType },
      { field: "campaignId", from: null, to: input.campaignId ?? null },
      { field: "itemId", from: null, to: input.itemId ?? null },
      { field: "adId", from: null, to: input.adId ?? null },
      { field: "currentStatus", from: null, to: input.currentStatus ?? null },
      { field: "metricsSnapshotSummary", from: null, to: input.metricsSnapshotSummary },
      { field: "rationale", from: null, to: input.rationale },
      { field: "sourceTool", from: null, to: input.sourceTool },
      { field: "observedAt", from: null, to: input.observedAt },
      { field: "mutationExecuted", from: null, to: false },
    ],
    rationale: input.rationale,
    riskLevel: "medium" as const,
    expiresAt: new Date(input.expiresAt),
    approvalStatus: "pending" as const,
  };
  await approvalRepo.save({
    action,
    requestedAt: new Date(),
    highlightedRisk: "medium" as const,
    status: "pending" as const,
  });
};
```

- **Pros**: ~30 lines of new code in one file; reuses existing `@msl/tools` types; no extraction or refactoring of MCP internals; follows same pattern as the existing `sendProactiveMessage`/`createForumTopic` callbacks
- **Cons**: Duplicates action-building logic from `packages/mcp/src/index.ts` (`productAdsTarget`, `productAdsExactChanges`, `productAdsRisk`) — need to keep in sync
- **Effort**: Low (1 file, ~30-50 lines)

#### 2. Extract shared action-building to `@msl/tools`

Move `productAdsTarget()`, `productAdsExactChanges()`, and `productAdsRisk()` from `packages/mcp/src/index.ts` into `@msl/tools` so both MCP and daemon can import them.

- **Pros**: No duplication; single source of truth for Product Ads action structure
- **Cons**: Requires refactoring the MCP import chain; more files changed; the MCP functions are intertwined with MCP types (PrepareProductAdsActionInput)
- **Effort**: Medium (3-4 files, ~80-120 lines)

#### 3. Internal bus message (enqueue for MCP consumption)

Have the daemon enqueue a bus message that the MCP server picks up and processes.

- **Pros**: Decouples daemon from approval storage entirely
- **Cons**: MCP server does not currently consume from the bus; would need a new consumer loop or MCP worker; adds async latency between detection and action persistence
- **Effort**: High (new consumer, bus message type, testing)

### Recommendation

**Approach 1: Wire directly with `@msl/tools` ApprovalQueueRepository.** Pragmatic and minimal. The action-building duplication is acceptable because:
- The daemon handler already builds the base payload via `buildActionPayload()`
- The MCP's `prepareProductAdsAction` does additional validation (sourceTool, credential detection, expiry strictness) that is MCP-specific
- The daemon operates in a trusted process context — MCP-layer validation gates are less critical
- Can extract to shared later if duplication becomes a maintenance burden

### Risks

- **Approval storage degraded**: If `MSL_APPROVAL_QUEUE_DB_PATH` is not set, falls back to in-memory — actions are lost on restart. Acceptable for MVP; document as known limitation.
- **Callback signature drift**: If `CeoHandlerContext.prepareProductAdsAction` type changes, the daemon script won't typecheck. Mitigation: the daemon script is JS, but the handler's TypeScript interface is the contract.
- **No risk awareness**: The callback hardcodes `riskLevel: "medium"` instead of computing it per proposal type. Mitigation: the handler already sets severity per signal, and the approval flow is the same regardless.

---

## Task 2: Missing-data CEO flow

### Current State

**Daemon side** (`packages/agent/src/workers/productAdsProfitabilityDaemon.ts`):

- Products with `dataCompleteness === "insufficient"` generate data-quality findings (lines 102-117)
- These carry `actionability: "data-quality"` and `signal: "unit-economics"` (line 106)
- Dedupe identity: `product-ads-data-gap:{sellerId}:{campaignId}:{itemId}:{YYYY-MM-DD}` (daily cadence)
- Recommendation identity: `product-ads-data-gap:{sellerId}:{campaignId}:{itemId}:{todayYmd}` (line 286)
- They are enqueued with `receiverAgentId: "product-ads-ceo-profitability"` same as sell-impacting findings
- Payload includes `actionability: "data-quality"` in each finding (line 315)
- `recommendedAction` text: `"Provide missing cost/unit data so profitability analysis can run on this product..."` (lines 290-291)

**Handler side** (`packages/agent/src/workers/ceoProfitabilityHandler.ts`):

- `parseFindings()` (lines 80-121) splits `recommendationIdentity` by `:` to extract signal from `parts[4]`
- For data-gap findings, `parts[4]` is the date string (e.g. `2026-07-08`), NOT a valid signal
- Falls through to `SIGNAL_TO_ACTION["unit-economics"]` (line 273) → `{ proposalType: "review-campaign-structure", severity: "info", requiresApproval: false }`
- Sends Telegram notification with: `<b>Signal:</b> 2026-07-08` and `ℹ️ Info: review-campaign-structure`
- **This is a bug**: the notification is misleading — it tells the seller to "review campaign structure" when the real issue is missing cost data

**Telegram bot** (`packages/bot/src/index.ts`):

- Uses grammY long polling, handles incoming messages through `agent.converse()` (line 458-485)
- `createTelegramBotFromEnv` provides `sendProactiveMessage` (line 376)
- The bot's CEO agent has context about product ads and MercadoLibre data
- No built-in two-way conversation pattern for daemon-initiated data collection

### Affected Areas

| File | Why |
|------|-----|
| `packages/agent/src/workers/ceoProfitabilityHandler.ts` | Must detect data-quality findings and send appropriate messages instead of misleading action labels |
| `packages/agent/src/workers/daemonTypes.ts` | May need extended `CeoHandlerContext` for data-collection callback (ask-and-forget vs. await-reply) |
| `packages/bot/src/index.ts` | No changes strictly needed if going ask-only; may need async-reply bridge for two-way |
| `packages/agent/src/conversation/agentLoop.ts` | No changes needed — `agent.converse()` already handles natural language responses |

### Current Data Bug

The handler's `parseFindings` has a latent bug with data-gap findings:

```ts
// line 96 in ceoProfitabilityHandler.ts
const parts = identity.split(":");
const signal = parts[4] ?? "unit-economics";
// For data-gap: identity = "product-ads-data-gap:sellerId:campId:itemId:2026-07-08"
// parts = ["product-ads-data-gap", "sellerId", "campId", "itemId", "2026-07-08"]
// signal = "2026-07-08" ← GARBAGE
```

This MUST be fixed regardless of which flow approach is chosen.

### Approaches

#### 1. Ask-only (Minimal Viable Flow)

Fix the handler to detect data-quality findings (check `recommendationIdentity.startsWith("product-ads-data-gap")`) and send a clear Telegram message asking for missing cost/unit data. No response processing — the seller replies through the CEO bot naturally.

Flow:
```
daemon detects insufficient data → enqueue to bus
  → handler claims message
    → detects data-gap identity
    → sends Telegram: "📊 Missing cost data for product {itemId} in campaign {campaignId}.
         Can you provide the unit cost and any additional cost info?
         Reply in the bot and I'll process it."
    → resolve message on bus
  → seller sees notification, replies in Telegram bot
    → bot routes to agent.converse("The CEO handler asked about costs for item X: $500/unit")
    → CEO agent processes naturally (no special callback needed)
```

- **Pros**: Minimal code (fix bug + redirect message); seller response handled by existing CEO agent loop
- **Cons**: Agent has no structured context about what was asked — relies on the seller's reply text; no state tracking (did seller reply? was data provided?)
- **Effort**: Low (~30 lines in handler)

#### 2. Ask + Structured Response (Full Flow)

Build a two-way conversation bridge: daemon asks for data, registers a pending query, the bot routes the seller's reply back to a structured handler.

Flow:
```
handler detects data-gap → persists pending query { itemId, askedAt, sellerId }
  → sends Telegram with question
  → seller replies in bot
  → bot detects reply matches pending query → routes to structured handler
  → handler validates response, updates cost data, marks query resolved
```

- **Pros**: Structured data collection; state tracking; validation
- **Cons**: Requires new infrastructure: pending-query store, bot reply routing, response handler — significantly more complex
- **Effort**: High (new store, bot changes, handler changes)

#### 3. Ask + Agent-Guided Response (Hybrid)

Send the data request via Telegram. The seller replies through the normal bot flow. The CEO agent has enough context (through its own message history or Cortex) to understand the question was asked and process the answer. No special callback, but the handler ensures the agent has context about the pending query.

- **Pros**: Minimal infrastructure, but gives the agent enough context to meaningfully process the reply
- **Cons**: Agent context can get lost across restarts; relies on agent's existing capabilities
- **Effort**: Medium (handler fix + inject context into bot conversation)

### Recommendation

**Approach 1: Ask-only** for the first slice. Rationale:

1. Fixes the current **misleading notification bug** immediately
2. Sellers already interact with the CEO bot naturally — they will reply to the data request through existing channels
3. The CEO agent already has visibility into product ads data via Cortex and operational evidence
4. Two-way conversation infrastructure (Approach 2) can be added in a future slice without breaking the ask-only flow
5. Agent-guided response (Approach 3) is nice-to-have but not blocking — the agent already sees conversation history within a session

**Approach 1 steps:**
1. Fix `parseFindings` to detect `product-ads-data-gap` identity prefix
2. For data-quality findings: set a dedicated data-quality action (e.g., `proposalType: "provide-cost-data"`)
3. Build a human-readable Telegram message asking for the missing data
4. Skip `prepareProductAdsAction` for data-quality findings (already happens via `requiresApproval: false`)
5. Use `INFO_ONLY_SIGNALS` pattern to prevent the misleading notification

### Risks

- **Seller doesn't see the question**: If the seller doesn't open Telegram promptly, the data gap persists. Mitigation: data-quality notices are daily — the daemon will re-notify next cycle.
- **CEO agent can't parse the answer**: If the seller replies in a non-standard format, the agent may not understand what data was provided. Mitigation: the question text should specify EXACTLY what's needed (e.g., "unit cost for item X").
- **No confirmation loop**: The handler doesn't know if the data was actually provided after asking. Mitigation: the daemon will automatically detect when data becomes available (cost_snapshot present) and can send a confirmation message.

---

### Task Separation

**These should be TWO separate changes:**

| Dimension | Task 1 (Wire prepare) | Task 2 (Missing data) |
|-----------|----------------------|----------------------|
| Primary file changed | `scripts/start-agent-daemons.mjs` | `ceoProfitabilityHandler.ts` |
| Risk | Low — optional callback wiring | Medium — fixes bug, changes notification behavior |
| Testing | Existing tests already pass with callback | Needs new tests for data-gap detection |
| Blocked by | Nothing | Task 1 not needed (runs independently) |
| Rollback | Remove callback from ceoContext | Revert handler changes |

**Proposed change names:**
- `product-ads-ceo-wire-prepare` for Task 1
- `product-ads-ceo-data-gap-flow` for Task 2

Or keep as `product-ads-ceo-complete` but with two independent PRs.

---

### Risks (Both Tasks)

- **Task 1 approval storage not shared**: The daemon process saves actions to its own `ApprovalQueueRepository` SQLite file. If the MCP server uses a different file path (`MSL_APPROVAL_QUEUE_DB_PATH`), the daemon's saved actions won't be visible to the MCP's approve/execute flow. **Must use the same `MSL_APPROVAL_QUEUE_DB_PATH` env var.**
- **Task 2 data-gap noise**: If many products lack cost data, the seller could receive a flood of daily messages. Mitigation: data-gap dedupe is per-product, per-day. Consider batching multiple gaps into one message.
- **No `workforceCostCacheLedgerStore` in daemon**: The handler skips DeepSeek reasoning when the ledger is unavailable. Both tasks work with static fallback — acceptable for first slice.

### Ready for Proposal

**Task 1: Yes.** The wiring is straightforward — one file change, well-understood contract, existing tests prove the interface works.

**Task 2: Yes.** But proposal must decide on Telegram interaction depth (ask-only vs ask+process). Recommend ask-only for first slice with a note that two-way is a future enhancement.
