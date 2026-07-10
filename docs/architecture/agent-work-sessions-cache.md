# Agent Work Sessions & Cache

## Overview

Agent Work Sessions add stateful session lifecycles atop the stateless daemon infrastructure. Each daemon tick that triggers an agent now goes through a decision gate: wake or skip. Sessions persist in SQLite, wake policy prevents redundant work, and cache-friendly prompts maximize DeepSeek disk-cache hits.

## Session Lifecycle

```
planned → running → completed | skipped | failed
```

1. **Signals detected** — daemon tick arrives with seller + lane context
2. **Wake decision** — `shouldAgentWakeUp()` evaluates signals hash, cooldown, risk severity, pending proposals
3. **Skip path** — matching hash + recent session → skip, no LLM call
4. **Run path** — start session, build cache-friendly prompt, call DeepSeek, parse output
5. **Record** — observations, proposals (CEO inbox), lessons (cortex)
6. **Complete/Fail** — update session status

## Wake/Sleep Logic

```
Rule 1: Manual override → wake always
Rule 2: High/critical severity signals → wake (override cooldown)
Rule 3: Same signals hash + completed < 1h → skip ("no new signals")
Rule 4: Equivalent proposal pending in CEO inbox → skip
Rule 5: New signals present → wake
Rule 6: Default → skip ("no signals")
```

Each `sellerId` evaluated independently — Plasticov sessions never affect Maustian decisions.

## Cache Usage

### Cache-Friendly Prompt Architecture

```
Layers 1-6 (STABLE — cached 24h):
  1. System policy
  2. Agent role
  3. Company rules + safety policy
  4. Account context
  5. Recent memory (compressed)
  6. Transferable lessons (max 3)

--- CACHE BREAK ---

Layers 7-9 (VARIABLE — per cycle):
  7. Variable evidence (new signals)
  8. Open questions
  9. Expected JSON output schema
```

- SHA-256 hash of stable prefix → `stablePromptHash`
- SHA-256 hash of evidence block → `evidenceHash`
- DeepSeek `extra_body: { disk_cache_ttl: 86400 }` (24h)

### Cost Efficiency

When the stable prompt prefix doesn't change across sessions for the same agent+account, DeepSeek returns `prompt_tokens_details.cached_tokens`, effectively halving cost for the cached portion.

## Prompt Structure

```
[StablePrefix — 9 layers as above]

---

[VariableEvidence — per-cycle signals, questions, schema]
```

## Experience Recording

### Observations

Agent observations are classified by `kind`:

- `new_signal` — fresh data detected
- `risk` — reputation drops, margin breaches
- `opportunity` — pricing gaps, competitive advantages
- `missing_data` — data gaps preventing analysis
- `repeated_pattern` — recurring patterns across cycles
- `no_change` — routine check, nothing new

### Lessons

Extracted from DeepSeek output. Transferable lessons (`transferable: true`) are available for cross-agent reuse within the same seller account.

### Proposals

Actions proposed by agents go through the CEO approval pipeline:

1. Agent generates proposal in DeepSeek output
2. Runner records to `CeoInboxStore` with `noMutationExecuted: true`
3. Proposal flows through existing CEO approval workflow

## Cortex Connection

Work sessions, observations, and lessons are recorded as Cortex graph nodes:

```
AccountAsset → Agent → WorkSession → Observation → Proposal → Approval → Action → Outcome → Lesson
```

- All nodes scoped by `sellerId`
- Edges initialized at weight 0.5
- Transferable lessons link to AccountAsset root for cross-agent discovery
- Hebbian learning: `reinforceEdge` +0.1 on positive outcomes

## Cost Calculation

The `workforce_cost_cache_ledger_entries` table tracks per-session costs:

- `seller_id` — per-account attribution
- `session_id` — session-level tracking
- `stable_prompt_hash` / `evidence_hash` — cache efficiency tracking
- `aggregateCostByAgentAndSeller(sellerId)` — per-agent cost breakdown
- `aggregateCacheEfficiencyBySeller(sellerId)` — cache-hit ratio

## Approval Safety

All proposals carry `noMutationExecuted: true`. Agents observe, analyze, and recommend — they do NOT execute mutations. Every action goes through CEO approval before MercadoLibre API writes.

The `get_agent_work_status` tool allows the CEO to inspect agent activity without triggering any mutations.

## Account Isolation

- Every session row has `seller_id`
- Every observation, lesson, proposal has `seller_id`
- Cortex nodes are seller-scoped via metadata
- Cross-seller queries filtered at SQL level
- Plasticov and Maustian data never mix

## Pending Work

Future enhancements planned:

- CEO dashboard for agent work visibility
- `compare_account_assets` cross-account comparison
- Multi-bot concurrent work sessions
- Provider smoke tests for cache efficiency measurement
