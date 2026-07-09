# Proposal: Agent Architecture Audit — 15-Gap Remediation

## Intent

Fix 15 confirmed architecture gaps. Daemons can't self-trigger, CEO proposals vanish, bus schema lacks outcome columns, env config is broken.

## Scope

**In**: 6 chained PRs covering all 15 confirmed claims. Each ≤800 lines, dependency-ordered.
**Out**: `sync_product` lifecycle comparison (claim 10 — already functional). No full proposal UI — routing + persistence only. Handlers follow existing daemon contract.

## Chained PR Structure

| PR | Prio | Claims | Lines | Depends |
|----|------|--------|-------|---------|
| PR1: Daemon Autonomy + CEO Inbox | P0 | 1, 5 | ~400 | — |
| PR2: Bus Schema + Outcome Persistence | P0 | 3, 12 | ~350 | — |
| PR3: Lane Contracts + Missing Handlers | P1 | 2 | ~300 | PR1, PR2 |
| PR4: Agent Durability + Advisors | P1 | 4, 8 | ~250 | PR2 |
| PR5: Config + Creative Pipeline | P2 | 6, 7, 9, 11p | ~450 | PR1, PR4 |
| PR6: E2E Tests + Learning Pipeline | P3 | 11r | ~300 | PR2, PR5 |

## Capabilities

### Modified Capabilities
- `agent-message-bus`: schema adds `result_json`, `error_json`, `cancel_reason`, `correlation_id`, `parent_message_id`, `seller_id`, `outcome_score`, `learned_at`, `action_id`. resolve/fail/cancel persist second args.
- `daemon-scheduler`: `enqueueDaemonTick()` for self-triggered cycles. Handler map extended for morning-report, eod-summary, owned-ecommerce, unanswered-questions.
- `specialist-daemons`: new `ownedEcommerceDaemon`, `unansweredQuestionsDaemon` handlers.
- `multi-agent-orchestration`: `request_agent_evidence` enqueues durable bus messages.
- `creative-studio-minimax`: `MinimaxRetryPolicy` with exponential backoff.
- `operational-lane-evidence`: lane evidence mapping for morning-report, eod-summary.

### New Capabilities
- `proposal-router`: `agent_proposals` table, `CeoInboxStore`, Telegram/web routing.
- `runtime-env-validator`: `validateRuntimeEnv()` startup check.
- `learning-pipeline`: `LearningOutcomePipeline` for retrospective outcome analysis.
- `webhook-ingestor`: `MercadoLibreWebhookIngestor` for external events.

## Approach

Bottom-up 6-PR chain. PR1+PR2 are independent foundations. PR3-PR6 build sequentially. All gaps were absent or broken — new code is additive, no feature flags needed.

## Risks

| Risk | Mitigation |
|------|------------|
| Bus migration breaks existing DB | ALTER TABLE IF NOT EXISTS; CI-tested in PR2 |
| Tick duplicates daemon work | `dedupe_key` on tick messages; idempotent investigate() |
| Env rename breaks prod .env.local | Read both vars; deprecation warning + fallback |
| 6 stacked PR merge conflicts | PR1+PR2 touch disjoint files; PR3-PR6 sequential bases |

## Rollback

Per-PR independent revert. PR1+PR2 are additive — no behavioral change. PR3-PR6 handlers default to no-op when unconfigured.

## Success Criteria

- [ ] Daemons self-trigger via `enqueueDaemonTick()`. CEO proposals persist + route to Telegram. (PR1)
- [ ] Bus migration succeeds on existing DB. resolve/fail/cancel persist outcome args. (PR2)
- [ ] All 4 missing lane contracts active with registered handlers. (PR3)
- [ ] `request_agent_evidence` durable. 5 daemon lanes enriched by DeepSeek advisors. (PR4)
- [ ] `.env.example` matches all creative-studio vars. MiniMax retries with backoff. Supplier adapters wired. (PR5)
- [ ] Real E2E test for one agent pipeline. `validateRuntimeEnv()` + `LearningOutcomePipeline` operational. (PR6)
