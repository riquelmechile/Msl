# Design: Agent Architecture Audit — 15-Gap Remediation

## Technical Approach

Bottom-up 6-PR chain. PR1+PR2 are independent foundations (touching disjoint files). PR3-PR6 build sequentially. All gaps are absent — code is additive, no feature flags needed except for PR2 schema migration gated by try/catch.

---

## PR1: Daemon Autonomy + CEO Inbox

### Architecture

```
startDaemonScheduler.run()
  └─ enqueueDaemonTick()                ← NEW: called BEFORE claiming
       └─ for each handler in daemonHandlerMap:
            bus.enqueue({ receiverAgentId: laneId, messageType: "daemon-tick",
                          dedupeKey: `${laneId}:tick:${hourKey}` })
  └─ claimNext(laneId)                  ← existing: picks up tick + real work
  └─ CEO consumption → CeoInboxStore    ← NEW: save proposals before resolve
```

### Key Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Tick per-lane vs single broadcast | Per-lane allows daemons to claim autonomously | Per-lane: `enqueueDaemonTick()` iterates `daemonHandlerMap` |
| Time-gating in scheduler vs in daemon | Scheduler has no time logic today | Daemons check payload timestamp in handler |
| Morning-report at 9am, eod at 6pm | Hardcoded hours are fragile | Hour check in handler: `new Date(cycleTimestamp).getHours() === 9` |

### Interfaces

```typescript
// DaemonScheduler.ts — added to run() before claim loop
function enqueueDaemonTick(bus: AgentMessageBusStore): void {
  const hourKey = new Date().toISOString().slice(0, 13); // "2026-07-09T14"
  for (const laneId of Object.keys(daemonHandlerMap)) {
    bus.enqueue({
      senderAgentId: "scheduler",
      receiverAgentId: laneId,
      messageType: "daemon-tick",
      payloadJson: JSON.stringify({ cycleTimestamp: new Date().toISOString() }),
      dedupeKey: `${laneId}:tick:${hourKey}`,
    });
  }
}

// CeoInboxStore — new file packages/agent/src/conversation/ceoInboxStore.ts
type AgentProposalRow = {
  id: number; proposal_id: string; sender_agent_id: string;
  proposal_type: string; payload_json: string; normalized_summary: string;
  risk_level: "low"|"medium"|"high"|"critical"; status: "pending"|"routed"|"reviewed"|"archived";
  routed_to: string|null; seller_id: string; created_at: string; updated_at: string;
};
```

### File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/ceoInboxStore.ts` | Create | SQLite-backed proposal persistence + `createCeoInboxStore()` |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Add `enqueueDaemonTick()` before claim loop; persist CEO proposals to inbox before resolve |
| `packages/agent/src/workers/morningReportDaemon.ts` | Modify | Only run when `cycleTimestamp` hour === 9 |
| `packages/agent/src/workers/eodSummaryDaemon.ts` | Modify | Only run when `cycleTimestamp` hour === 18 |

### Migration

CeoInboxStore uses same SQLite DB as message bus (`agent_proposals` table). CREATE TABLE IF NOT EXISTS — zero-risk.

### Rollback

Remove `enqueueDaemonTick()` call from `run()`. Daemons return to reactive-only.

---

## PR2: Bus Schema + Outcome Persistence

### Migration Strategy

SQLite lacks `ALTER TABLE ADD COLUMN IF NOT EXISTS`. Use `PRAGMA table_info` + try/catch:

```typescript
function migrateBusSchema(db: Database.Database): void {
  const cols = db.pragma("table_info(agent_message_bus)") as { name: string }[];
  const existing = new Set(cols.map(c => c.name));
  const migrations: [string, string][] = [
    ["result_json", "TEXT"], ["error_json", "TEXT"], ["cancel_reason", "TEXT"],
    ["correlation_id", "TEXT"], ["parent_message_id", "TEXT"], ["seller_id", "TEXT"],
    ["learned_at", "TEXT"], ["outcome_score", "REAL"], ["action_id", "TEXT"],
  ];
  for (const [col, type] of migrations) {
    if (!existing.has(col)) db.exec(`ALTER TABLE agent_message_bus ADD COLUMN ${col} ${type}`);
  }
}
```

### Modified resolve/fail/cancel

| Method | SQL change | Writes |
|--------|-----------|--------|
| `resolve` | SET result_json=@result, status='resolved', resolved_at=now() | `JSON.stringify(result)` |
| `fail` | SET error_json=@error, status=..., attempts=attempts+1 | `JSON.stringify({ message: error, timestamp })` |
| `cancel` | SET cancel_reason=@reason, status='cancelled' | `reason ?? null` |

### New API methods

```typescript
// Added to AgentMessageBusStore type:
getMessagesByCorrelationId(cid: string): AgentMessage[];
getLearningHistory(options?: { since?: string; minScore?: number }): AgentMessage[];
recordOutcome(messageId: string, score: number, learnedAt: string): void;
```

### File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/agentMessageBusStore.ts` | Modify | Schema migration + 9 new columns; wired resolve/fail/cancel; 3 new API methods |
| `packages/agent/src/conversation/agentMessageBusStore.ts` | Modify | `EnqueueAgentMessageInput` adds optional `correlationId`, `parentMessageId`, `sellerId` |

### Rollback

Bus migration is additive. Old code ignores new columns. Revert the `migrateBusSchema()` call to stop writing new columns; existing data unaffected.

---

## PR3: Lane Contract Completeness

### Architecture

```
LANE_CONTRACTS += [
  MORNING_REPORT_LANE,
  EOD_SUMMARY_LANE,
  UNANSWERED_QUESTIONS_LANE,
]
daemonHandlerMap["owned-ecommerce"] = ownedEcommerceDaemon   ← NEW handler
daemonHandlerMap["unanswered-questions"] = unansweredQuestionsDaemon  ← NEW handler
```

### Lane Contracts (new)

| LaneId | Inputs | Outputs | Required Evidence |
|--------|--------|---------|-------------------|
| `morning-report` | overnight order/claim/question snapshots, reputation delta | briefing, alerts, evidence IDs | order-snapshot, claim-snapshot, question-snapshot, reputation-snapshot |
| `eod-summary` | day's proposals, resolved items, pending queue | daily summary, completion rate, evidence IDs | proposal, resolution |
| `unanswered-questions` | UNANSWERED questions across sellers | per-seller question list, aging, priority | question-snapshot |

### File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/lanes.ts` | Modify | Add `MORNING_REPORT_LANE`, `EOD_SUMMARY_LANE`, `UNANSWERED_QUESTIONS_LANE` contracts to `LANE_CONTRACTS` |
| `packages/agent/src/workers/unansweredQuestionsDaemon.ts` | Create | Scans UNANSWERED questions per seller, enqueues prioritized list to CEO bus |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Add `"owned-ecommerce": ownedEcommerceDaemon`, `"unanswered-questions": unansweredQuestionsDaemon` to handler map |
| `packages/agent/src/workers/ownedEcommerceDaemon.ts` | Create | Reads storefront projections and readiness checks, enqueues CEO proposals |

### Rollback

Remove entries from `LANE_CONTRACTS`, `daemonHandlerMap`. No data loss — handlers are stateless.

---

## PR4: Proposal Router & Durability

### Architecture

```
daemonScheduler.ts CEO consumption (lines 173-213):
  claimNext("ceo") → parse payload → ceoInboxStore.insert(proposal)
    → routeToTelegram(proposal, ceoContext)   ← NEW: per-sellerId forum topics
    → bus.resolve(messageId, { routed: true })
request_agent_evidence:
  executes → bus.enqueue({ receiverAgentId: target.laneId, ... })  ← NEW: durable
```

### CeoInboxStore schema (already defined in PR1 — reused here)

### Telegram routing

```typescript
async function routeProposalToTelegram(
  proposal: AgentProposalRow, ceoContext: CeoHandlerContext
): Promise<void> {
  const sellerName = ceoContext.sellerNames?.[proposal.seller_id] ?? proposal.seller_id;
  const topic = await ceoContext.createForumTopic?.(adminChatId, sellerName);
  const text = `${riskEmoji[proposal.risk_level]} ${proposal.normalized_summary}`;
  await ceoContext.sendProactiveMessage?.(adminChatId, text, topic?.message_thread_id);
}
```

### request_agent_evidence durability

In `workforceTools.ts` execute(): after building `AgentEvidenceResponse`, if `status !== "blocked"` and `agent.profile.laneId`:

```typescript
bus.enqueue({
  senderAgentId: "ceo",
  receiverAgentId: agent.profile.laneId,
  messageType: "evidence-request",
  payloadJson: JSON.stringify({ scope, requestedEvidenceKinds, ceoMessageId }),
  dedupeKey: `evidence-request:${agent.id}:${Date.now()}`,
});
```

### File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | CEO consumption path uses `ceoInboxStore.insert()` + Telegram routing |
| `packages/agent/src/conversation/tools/workforceTools.ts` | Modify | `request_agent_evidence` enqueues durable bus message after validation |
| `packages/agent/src/conversation/ceoInboxStore.ts` | Modify | Add `routeToTelegram()`, `listByStatus()`, `getBySellerId()` |

### Rollback

Remove `ceoInboxStore.insert()` call — revert to fire-and-forget. Remove `bus.enqueue()` from workforceTools — revert to synchronous response.

---

## PR5: Creative Pipeline + Config

### Architecture

```
creativeTools:
  query_creative_task → CreativeJobQueueSQLite.lookup(jobId)         ← REPLACES stub
  approve_creative_asset → CreativeJobQueueSQLite.transition(APPROVED) → bus.enqueue proposal

CreativeJobQueueSQLite (new table: creative_jobs):
  states: queued→running→generated→needs-review→approved→prepared-for-upload→published/failed
```

### Key Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| New DB vs reuse bus DB | Separate DB isolates creative state | Same cortex DB, `creative_jobs` table |
| MINIMAX_BASE_URL rename | Breaking existing .env.local | **Keep MINIMAX_BASE_URL** — read it as fallback for MINIMAX_API_HOST |

### Env fix strategy

```typescript
// creativeStudioDaemon.ts — compatibility layer
const apiHost = env("MINIMAX_API_HOST") || env("MINIMAX_BASE_URL") || "https://api.minimax.io";
```

Add 7 missing vars to `.env.example` with `(internal)` or `(optional)` annotation.

### CreativeJobQueueSQLite schema

```typescript
type CreativeJobRow = {
  id: number; job_id: string; request_id: string; seller_id: string;
  status: CreativeJobStatus; kind: CreativeJobKind; channel: CreativeChannel;
  provider: string; estimated_cost_usd: number; actual_cost_usd: number | null;
  asset_paths_json: string; // JSON array of output paths
  created_at: string; updated_at: string;
};
```

### Wire advisors

```typescript
// New file: packages/agent/src/conversation/createDaemonAdvisors.ts
function createDaemonAdvisorsFromEnv(env: Record<string,string|undefined>) {
  const deepseekKey = env.DEEPSEEK_API_KEY;
  if (!deepseekKey) return {};
  return {
    advisor: createSupplierMirrorAdvisor(deepseekKey),
    operationsAdvisor: createOperationsAdvisor(deepseekKey),
    catalogAdvisor: createCatalogAdvisor(deepseekKey),
    costSupplierAdvisor: createCostSupplierAdvisor(deepseekKey),
    creativeAdvisor: createCreativeAdvisor(deepseekKey),
  };
}
```

### File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/creativeJobQueueStore.ts` | Create | SQLite-backed `CreativeJobQueueSQLite` table + CRUD |
| `packages/agent/src/conversation/tools/creativeTools.ts` | Modify | Replace `query_creative_task` and `approve_creative_asset` stubs with real queue lookups |
| `packages/agent/src/workers/creativeStudioDaemon.ts` | Modify | Read `MINIMAX_BASE_URL` as fallback for `MINIMAX_API_HOST` |
| `packages/agent/src/conversation/createDaemonAdvisors.ts` | Create | `createDaemonAdvisorsFromEnv()` factory function |
| `scripts/start-agent-daemons.mjs` | Modify | Call `createDaemonAdvisorsFromEnv()` and pass to `startDaemonScheduler()` |
| `.env.example` | Modify | Add 7 missing creative-studio env vars; rename `MINIMAX_BASE_URL` note |
| `packages/agent/src/workers/minimaxRetryPolicy.ts` | Create | Exponential backoff: 1s → 2s → 4s → 8s, max 3 retries |

### Rollback

Set `DEEPSEEK_API_KEY` to empty → advisors not created. Remove creative job queue import → stub paths activate.

---

## PR6: Maturity + E2E

### Architecture

```
validateRuntimeEnv()         ← startup: check MINIMAX_API_KEY, DEEPSEEK_API_KEY, BOT_TOKEN consistency
MinimaxRetryPolicy           ← PR5 already created; PR6 adds integration tests
MercadoLibreWebhookIngestor  ← HTTP endpoint → bus.enqueue()
LearningOutcomePipeline      ← periodic: bus.getLearningHistory() → Cortex → policy adjustment
E2E test                     ← real pipeline: data → daemon → CEO → approval → execution → learning
```

### Key Types

```typescript
// validateRuntimeEnv()
type EnvValidation = { ok: boolean; warnings: string[]; errors: string[] };

// MercadoLibreWebhookIngestor
type WebhookEvent = { topic: string; resource: string; user_id: number; received: string };
function ingestWebhook(event: WebhookEvent, bus: AgentMessageBusStore): void {
  bus.enqueue({
    senderAgentId: "webhook",
    receiverAgentId: "operations-manager",
    messageType: `ml-webhook:${event.topic}`,
    payloadJson: JSON.stringify(event),
  });
}

// LearningOutcomePipeline
async function runLearningPipeline(bus: AgentMessageBusStore, cortex: GraphEngine): Promise<void> {
  const outcomes = bus.getLearningHistory({ since: "24 hours ago" });
  for (const msg of outcomes) {
    cortex.recordObservation({ type: "outcome", messageId: msg.messageId, score: msg.outcomeScore });
  }
}
```

### File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/runtime/validateEnv.ts` | Create | `validateRuntimeEnv()` — checks env var consistency |
| `packages/agent/src/runtime/webhookIngestor.ts` | Create | `MercadoLibreWebhookIngestor` — express endpoint + bus enqueue |
| `packages/agent/src/runtime/learningPipeline.ts` | Create | `LearningOutcomePipeline` — period outcome → Cortex feedback |
| `scripts/start-agent-daemons.mjs` | Modify | Call `validateRuntimeEnv()` at startup; start webhook server |
| `tests/e2e/agent-pipeline.e2e.test.ts` | Create | Real E2E: inject message → daemon processes → CEO receives → verify in inbox |

### Rollback

Remove `validateRuntimeEnv()` call — no-op. Webhook ingestor runs on separate port, stop the server.

---

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `enqueueDaemonTick()` deduplication | Mock bus; verify 2nd call same hour → 0 enqueues |
| Unit | Bus schema migration on existing DB | Create DB with old schema; run migrate; verify new columns |
| Unit | resolve/fail/cancel write to new columns | Insert test row, resolve with result, assert result_json populated |
| Integration | CEO proposal → CeoInboxStore → Telegram | Mock grammY; assert inbox row + sendProactiveMessage called |
| Integration | `request_agent_evidence` bus enqueue | Mock bus; execute tool; assert `enqueue()` called with correct laneId |
| E2E (PR6) | Full pipeline | Real SQLite DB; inject tick → daemon processes → CEO receives → approve → learning records outcome |
