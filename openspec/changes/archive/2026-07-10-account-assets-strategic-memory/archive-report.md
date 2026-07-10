# Archive Report: account-assets-strategic-memory

**Date:** 2026-07-10
**Branch:** `feat/account-assets-strategic-memory`
**Base commit:** `b5a211c` (feat(runtime): wire production providers and secrets readiness (#122))
**Artifact store mode:** `openspec`

## Summary

Added `seller_id` to 10 strategic stores via idempotent migrations with `'unknown'` defaults, introduced `AccountAsset` domain model with 6 new types (`AccountAsset`, `AccountCapability`, `AccountHealthSnapshot`, `AccountStrategy`, `AccountRisk`, `MemoryScope`), created `AccountAssetStore` with 7 SQLite tables and 15 methods, scoped Cortex Hebbian/Darwinian/spreading by seller, migrated AutonomyEngine from singleton to per-seller state, wired per-seller daemon dispatch with dedupe, and implemented per-account "dale" resolution. Column-level scoping complements existing file-level bot DB isolation — additive safety.

## Artifacts Archived

| Artifact | Status |
|---|---|
| `proposal.md` | ✅ |
| `explore.md` | ✅ |
| `design.md` | ✅ |
| `tasks.md` | ✅ (28/28 tasks complete) |
| `verify-report.md` | ✅ PASS_WITH_WARNINGS |
| `specs/` (9 delta specs) | ✅ |

## Specs Synced

| Domain | Action | Details |
|---|---|---|
| `account-asset-model` | **Created** | New full spec — `AccountAsset`, `AccountCapability`, `AccountHealthSnapshot`, `AccountStrategy`, `AccountRisk`, `MemoryScope` types |
| `account-asset-store` | **Created** | New full spec — 7 SQLite tables, 15 store methods, seed data |
| `neural-graph-memory` | **Merged** | +6 ADDED requirements (scoped node schema, creation, Hebbian, spreading, pruning, query API); 4 MODIFIED requirements (Graph Schema, Hebbian, Spreading, Darwinian) |
| `autonomy-engine` | **Merged** | +3 ADDED (per-seller state schema, KPI history, degradation events); 5 MODIFIED (state machine, risk mapping, KPI tracking, auto-degradation, gate guardrail) |
| `agent-consensus` | **Merged** | +3 ADDED (scoped review schema, scoped queries, per-account findings); 3 MODIFIED (review persistence, consensus aggregation, store factory contract) |
| `learning-pipeline` | **Merged** | +4 ADDED (scoped lesson schema, attribution, queries, Cortex chain); 1 MODIFIED (Learning Feedback Loop) |
| `action-approval-safety` | **Merged** | +4 ADDED (scoped approval schema, per-account queue queries, dale resolution, duplicate tick idempotency); 2 MODIFIED (Conversational Proposal Pipeline, Risk Audit Trail) |
| `daemon-scheduler` | **Merged** | +4 ADDED (per-seller dispatch, scoped evidence, account context in handler input, per-seller dedupe keys); 2 MODIFIED (Agent Polling Loop, Claim-Dispatch-Resolve Lifecycle) |
| `conversational-business-agent` | **Merged** | +5 ADDED (AgentLoop account context, account-aware prompt, cache stability, outcome attribution, per-account dale); 2 MODIFIED (Cortex Context via Tool, 3-Block Prefix-Anchored Cache) |

## Implementation Stats

- **Total commits:** 13
- **Files changed:** 50
- **Lines:** +4,613 / −256
- **Tests:** 2,140 passed, 7 skipped, 0 failed
- **Quality gates:** typecheck ✅, lint ✅, build ✅, format ⚠️ (3 docs)

## Deliverables

| PR | Focus | ~Lines |
|---|---|---|
| PR 1 | Foundation — Domain types (`AccountAsset` etc.) + 8 store migrations (`seller_id` columns) | 450 |
| PR 2 | Cortex — Scoped engine API (`createNode`, `spread`, `reinforceEdge`, `prune`, `ensureAccountAssetNode`) + 32 tests | 600 |
| PR 3 | Daemon + autonomy + approval — Per-seller daemon dispatch, autonomy singleton→per-seller rebuild, per-account "dale" | 550 |
| PR 4 | AccountAssetStore + tests + docs — 7 tables, 15 methods, 20 integration tests, ARCHITECTURE.md update, audit addendum | 500 |

## Verification

- **Verdict:** PASS_WITH_WARNINGS
- **CRITICAL issues:** None
- **Warnings:** 3 files need Prettier formatting (`ARCHITECTURE.md`, `docs/audits/account-assets-memory-addendum-2026-07.md`, `scripts/seed-account-assets.mjs`)
- **Spec coverage:** All 12 required scenarios verified with line-level evidence
- **Secrets:** Clean — all new files scanned
- **Regressions:** None — all 2,140 prior tests still pass

## Deferred Items

| Store | Rationale |
|---|---|
| CreativeJobQueueStore | Already has `seller_id TEXT NOT NULL` in schema |
| WorkforceCostCacheLedgerStore | No ALTER needed — `sellerId` injected via `metadata` field |
| CompanyAgentStore / SkillStore | Agents are company-level; deferred per design open question |

## Lessons Learned

1. **Idempotent migrations are worth the boilerplate** — Using `PRAGMA table_info` guards before every `ALTER TABLE ADD COLUMN` meant migration re-runs never broke dev environments. Zero schema-corruption issues across 4 PRs.

2. **AutonomyEngine singleton → per-seller required table rebuild** — SQLite can't drop CHECK constraints, so `autonomy_state` needed a full rebuild. The existing singleton data auto-migrated to `seller_id = 'default'`, preserving backward compatibility.

3. **Daemon per-seller iteration pattern was straightforward** — Each of the 14 handler files required the same mechanical change: wrap the handler body in a `for (const sellerId of sellerIds)` loop and scope `OperationalReadModel` queries. No handler needed substantive logic changes.

4. **Cortex scoping is additive, not replacement** — Global nodes (NULL seller_id) remain visible to all accounts. Scoped nodes are invisible to other accounts. This means existing data (NULL) continues working, and new account-scoped writes naturally isolate. The dual-mode (`seller_id = NULL` vs. non-NULL) was the right SQL-native design.

5. **"dale" ambiguity needed regex + explicit matching** — The bot's `/dale\s+(?:la\s+)?(?:de|para|cuenta)?\s+(\w+)/i` regex handles common patterns but multi-account ambiguity ("dale" with 2+ sellers pending) is caught by the rejection path that asks "¿para cuál cuenta?". A dedicated multi-account integration test would strengthen this.

6. **Backfill `'unknown'` is acceptable for existing strategic data** — Old Cortex nodes, consensus reviews, and learning lessons default to `'unknown'` seller. New writes are properly scoped. The `'unknown'` default lets the system degrade gracefully without blocking existing functionality.

## Rollback Plan

Revert code → `sellerId` params become optional → global behavior restored. Bot file-level DB isolation untouched. No destructive ALTER — all migrations are additive columns. AutonomyEngine existing state preserved in `seller_id = 'default'`.

## Audit Trail

- Change folder archived to: `openspec/changes/archive/2026-07-10-account-assets-strategic-memory/`
- All delta specs merged into canonical `openspec/specs/`
- SDD cycle complete: proposal → design → tasks → apply → verify → archive
