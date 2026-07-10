# Design: Agent Work Sessions & Cache

## Technical Approach

Add stateful session lifecycles atop the stateless daemon infrastructure. All new code is additive — `DaemonHandler` signature extended via optional params, existing handlers unchanged. Sessions survive across daemon cycles via SQLite, wake policy gate-keeps LLM calls, and cache-friendly prompts maximize DeepSeek disk-cache hits.

---

## Domain Model

```typescript
type SessionStatus = "planned" | "running" | "completed" | "skipped" | "failed";

type AgentWorkSession = {
  sessionId: string; sellerId: string; agentId: string; laneId: string;
  status: SessionStatus; signalsHash: string; stablePromptHash: string; evidenceHash: string;
  startedAt?: string; endedAt?: string; lastActiveAt?: string;
  cycleCount: number; summaryJson: string; errorJson?: string;
};

type AgentObservation = {
  observationId: string; sellerId: string; agentId: string; sessionId: string;
  kind: "new_signal" | "risk" | "opportunity" | "missing_data" | "repeated_pattern" | "no_change";
  summary: string; severity: "info" | "warning" | "critical"; metadataJson: string;
};

type AgentLesson = {
  lessonId: string; sellerId: string; agentId: string; sessionId: string;
  lesson: string; transferable: boolean; learnedAt: string;
};

type AgentWakeDecision = { shouldWake: boolean; reason: string; signalsHash: string; };
type SignalDelta = { added: string[]; removed: string[]; unchanged: string[]; };
type StablePromptBlock = string;
type VariableEvidenceBlock = string;

type AgentWorkPrompt = {
  stablePrefix: StablePromptBlock; variableEvidence: VariableEvidenceBlock;
  stablePromptHash: string; evidenceHash: string;
};
```

**State machine**: `planned → running → completed|skipped|failed`

---

## Database Schema (5 tables, SQLite)

```sql
CREATE TABLE IF NOT EXISTS agent_work_sessions (
  session_id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  lane_id TEXT NOT NULL, status TEXT NOT NULL, signals_hash TEXT NOT NULL,
  stable_prompt_hash TEXT, evidence_hash TEXT,
  started_at TEXT, ended_at TEXT, last_active_at TEXT,
  cycle_count INTEGER DEFAULT 0, summary_json TEXT DEFAULT '{}', error_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Indexes: idx_aws_seller, idx_aws_agent, idx_aws_lane, idx_aws_signals_hash, idx_aws_created

CREATE TABLE IF NOT EXISTS agent_observations (
  observation_id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES agent_work_sessions(session_id),
  kind TEXT NOT NULL, summary TEXT NOT NULL, severity TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now'))
);
-- Indexes: idx_ao_seller, idx_ao_session, idx_ao_kind

CREATE TABLE IF NOT EXISTS agent_session_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL, seller_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(session_id, proposal_id)
);

CREATE TABLE IF NOT EXISTS agent_session_lessons (
  lesson_id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL, lesson TEXT NOT NULL, transferable INTEGER DEFAULT 0,
  learned_at TEXT DEFAULT (datetime('now'))
);
-- Indexes: idx_asl_seller, idx_asl_session, idx_asl_transferable

CREATE TABLE IF NOT EXISTS agent_shift_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, seller_id TEXT NOT NULL,
  kind TEXT NOT NULL, summary_json TEXT NOT NULL, shift_start TEXT NOT NULL,
  shift_end TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);
-- Indexes: idx_ass_seller, idx_ass_kind
```

**Migration**: `CREATE TABLE IF NOT EXISTS` + `columnExists()` for `seller_id`, `session_id`, `stable_prompt_hash`, `evidence_hash` on `workforce_cost_cache_ledger_entries`.

---

## File Structure

| File | Purpose |
|------|---------|
| `packages/domain/src/agentWorkSession.ts` | Domain types (exported from `index.ts`) |
| `packages/agent/src/sessions/AgentWorkSessionStore.ts` | SQLite persistence (5 tables) |
| `packages/agent/src/sessions/AgentWorkSessionRunner.ts` | Orchestrator: wake→prompt→LLM→parse→record→complete |
| `packages/agent/src/sessions/agentWakePolicy.ts` | Pure signal hashing + wake decisions |
| `packages/agent/src/prompts/cacheFriendlyPromptBuilder.ts` | Stable prefix + variable evidence |
| `packages/agent/src/sessions/agentWorkCortexBridge.ts` | Cortex node/edge recording |
| `packages/agent/src/sessions/agentShiftSummary.ts` | Morning/EOD summaries from DB |
| `packages/memory/src/cortex/engine.ts` | Minimal additions: `getOrCreateNode()` reuse |

---

## API Design

```typescript
interface AgentWorkSessionStore {
  startSession(session: AgentWorkSession): AgentWorkSession;
  getSession(sessionId: string, sellerId: string): AgentWorkSession | undefined;
  completeSession(sessionId: string, sellerId: string, summaryJson: string): void;
  failSession(sessionId: string, sellerId: string, errorJson: string): void;
  skipSession(sessionId: string, sellerId: string, reason: string): void;
  listRecentSessionsByAgent(sellerId: string, agentId: string, limit?: number): AgentWorkSession[];
  getLastSessionForSignals(sellerId: string, agentId: string, signalsHash: string): AgentWorkSession | undefined;
  addObservation(obs: AgentObservation): void;
  addProposalLink(sessionId: string, proposalId: string, sellerId: string): void;
  addLesson(lesson: AgentLesson): void;
  listRecentLessons(sellerId: string, agentId: string, limit?: number): AgentLesson[];
  summarizeShift(sellerId: string, since: string): ShiftSummary;
}

interface AgentWakePolicy {
  shouldAgentWakeUp(sellerId: string, agentId: string, signals: SignalDescriptor[],
    lastSession?: AgentWorkSession, pendingProposals?: string[]): AgentWakeDecision;
  hashAgentSignals(signals: SignalDescriptor[]): string;
  computeSignalDelta(prev: string[], curr: string[]): SignalDelta;
}

interface AgentWorkSessionRunner {
  run(sellerId: string, agentId: string, laneId: string): Promise<AgentWorkSession>;
}

interface AgentWorkCortexBridge {
  recordWorkSessionToCortex(session: AgentWorkSession, sellerId: string): void;
  recordObservationToCortex(obs: AgentObservation, sellerId: string): void;
  recordLessonToCortex(lesson: AgentLesson, sellerId: string): void;
}

interface AgentShiftSummary {
  createMorningBrief(sellerId: string): MorningBrief;
  createEndOfDaySummary(sellerId: string): EndOfDaySummary;
  summarizeAccountShift(sellerId: string): AccountShiftSummary;
}
```

---

## DaemonScheduler Integration

Extend `DaemonSchedulerConfig` with optional `enableWorkSessions: boolean` and `workSessionRunner: AgentWorkSessionRunner`. When enabled, the 6 sessionized lanes (`unanswered-questions`, `product-ads-profitability`, `creative-assets`, `operations-manager`, `morning-report`, `eod-summary`) route through runner instead of direct handler invocation. All other lanes unchanged. Backward compatible — `enableWorkSessions: false` (default) preserves current behavior.

---

## Cache-Friendly Prompt Architecture

**Layers (stable → variable)**:
1. System policy (autonomy, phase-1 boundary)
2. Agent role (lane contract prefix)
3. Company rules + safety policy
4. Account context (sellerId, profit goals)
5. Recent compressed memory (last session summary)
6. ── CACHE BREAK ──
7. Variable evidence (new signals, observations)
8. Open questions
9. Expected JSON output schema

**Hashing**: `SHA-256(stablePrefix)` → `stablePromptHash`; `SHA-256(evidenceBlob)` → `evidenceHash`; `SHA-256(signalsArray)` → `signalsHash`. Hashes stored on session row for wake policy comparison.

**DeepSeek cache**: `extra_body: { disk_cache_ttl: 86400 }` (24h) on `createChatCompletion` calls from work sessions.

---

## Wake Policy Algorithm

```
1. If manual override → wake
2. Compute signalsHash → compare with lastSession.signalsHash
3. If hash matches AND session completed < 1h ago → skip ("no new signals")
4. If risk severity "high" or "critical" present → wake (override cooldown)
5. If equivalent proposal already pending in CEO inbox → skip
6. Otherwise → wake
```

Per-seller isolation: each `sellerId` evaluated independently.

---

## Cost Ledger Integration

Add to `workforce_cost_cache_ledger_entries` via idempotent migration: `seller_id TEXT`, `session_id TEXT`, `stable_prompt_hash TEXT`, `evidence_hash TEXT`. `insertEntry()` extended with optional fields — existing callers unaffected. New aggregates: `aggregateCostByAgentAndSeller(sellerId)`, `aggregateCacheEfficiencyBySeller(sellerId)`.

---

## Test Architecture

| Layer | Strategy |
|-------|----------|
| Store | `better-sqlite3 :memory:`, roundtrip + reopen tests, malformed row defense |
| Wake policy | Pure functions, no DB — `describe.each` over signal/hash combinations |
| Prompt builder | Deterministic hash comparison, seller-isolation assertions |
| Session runner | `FakeTransport` (canned responses), in-memory stores, no HTTP |
| Cortex bridge | In-memory DB, verifies node/edge counts per seller |
| Cross-seller | Save Plasticov data, query Maustian → empty result |

---

## Dependency Graph

```
domain/agentWorkSession.ts
    ├── AgentWorkSessionStore ── depends on domain
    ├── agentWakePolicy ── pure, no deps
    ├── cacheFriendlyPromptBuilder ── depends on domain
    ├── agentWorkCortexBridge ── depends on Cortex engine
    ├── agentShiftSummary ── depends on Store
    └── AgentWorkSessionRunner ── depends on Store + WakePolicy + PromptBuilder + Cortex + Transport
```
