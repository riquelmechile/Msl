# Tasks: MercadoLibre Business Agent

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,500-2,500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 foundation → PR 2 OAuth/cache → PR 3 tools/approvals → PR 4 agent/insights → PR 5 UI/e2e |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | TypeScript monorepo, quality gates, domain contracts | PR 1 | Establish build/test/lint/typecheck baseline. |
| 2 | MercadoLibre OAuth, API client, local cache | PR 2 | Depends on PR 1; verify `MLC` and stale-data behavior. |
| 3 | Custom tools, prepared actions, approval/audit safety | PR 3 | Depends on PR 2; no write without approval. |
| 4 | Principal agent, memory learning, insights, creative drafts | PR 4 | Depends on PR 3; Spanish responses and evidence labels. |
| 5 | Next.js chat, approval UI, Playwright flows | PR 5 | Depends on PR 4; end-to-end seller journeys. |

## Phase 1: Foundation and Test Baseline

- [x] 1.1 Create `package.json`, workspace config, TypeScript config, lint/format scripts, Vitest, and Playwright commands.
- [x] 1.2 Create `packages/domain/src` contracts for seller, listing, cache freshness, prepared action, approval, audit, and specialization evidence.
- [x] 1.3 Add `packages/domain` Vitest cases for approval-required writes, risk labels, freshness by business risk, and premature specialization blocking.

## Phase 2: MercadoLibre Integration and Memory

- [x] 2.1 Create `packages/mercadolibre/src` OAuth token state and direct `MLC` API client interfaces with revoked-access tests.
- [x] 2.2 Create `packages/memory/src` PostgreSQL repository boundaries, `pgvector` memory interfaces, freshness metadata, and selective-sync policy tests.
- [x] 2.3 Create `packages/workers/src` sync job stubs for orders, claims, cancellations, stock, reputation, and messages with stale critical-signal tests.

## Phase 3: Tools, Approvals, and Audits

- [x] 3.1 Create `packages/tools/src` custom tool contracts returning `source`, `freshness`, `confidence`, and `requiresApproval` metadata.
- [x] 3.2 Implement prepared-action and approval-queue use cases in `packages/tools/src` that block price, stock, message, cancellation, refund, listing, and publication writes.
- [x] 3.3 Add integration tests in `tests/tools` proving official MercadoLibre MCP is docs-only and writes execute only after valid approval with audit output.

## Phase 4: Agent, Insights, and Creative Drafts

- [x] 4.1 Create `packages/agent/src` principal-agent orchestration for Spanish answers, missing-context questions, corrections, learned preferences, and safety conflicts.
- [x] 4.2 Create `packages/workers/src/insights` daily summary generation ranked by profit, urgency, reputation risk, confidence, and stale-data disclosure.
- [x] 4.3 Create `packages/workers/src/creative` opportunity radar and creative draft preparation with preview metadata and approval-before-publication tests.

## Phase 5: Web App and End-to-End Verification

- [x] 5.1 Create `apps/web` Next.js chat, OAuth connection, prepared-action review, audit, and creative preview screens with Spanish user-facing copy.
- [x] 5.2 Add Playwright tests in `tests/e2e` for advice, reconnect-required access, daily summary, blocked write, approved write audit, and creative approval flows.
- [x] 5.3 Update `README.md` and `openspec/config.yaml` with actual stack, test commands, and verification limitations.
