# Design: MercadoLibre Business Agent

## Technical Approach

Start from a blank repo with a small TypeScript monorepo: Next.js for the Spanish chat MVP, a Node.js service layer for MercadoLibre OAuth/API access, custom MCP/tools, local memory, insights, approvals, and workers. Use PostgreSQL locally first, with `pgvector` for semantic memory and a durable job queue for sync/refresh work. This keeps one language across UI, tools, and tests while leaving room to split services later.

The official MercadoLibre MCP is documentation lookup only. Seller operations use project-owned tools backed by direct MercadoLibre APIs, OAuth, local cache, and approval/audit controls.

## Architecture Decisions

| Topic | Choice | Tradeoff / Rationale |
|------|--------|-----------------------|
| Initial stack | TypeScript, Next.js, Node service modules, PostgreSQL + `pgvector`, Playwright/Vitest | Fastest safe MVP from a blank repo; shared types reduce drift. Not the lightest runtime, but better for chat UI + API + tests. |
| Tool boundary | Custom business MCP/tools layer over internal use cases | Prevents confusing MercadoLibre docs MCP with execution. Tools can enforce scopes, freshness, approvals, and audit before any API call. |
| Memory/cache | Local-first database with freshness metadata and selective sync | Supports low-cost analysis and privacy. Critical signals need queued refresh/webhook handling rather than broad polling. |
| Writes | Prepared actions only until explicit approval | Slower than automation, but required for price, stock, messages, cancellations, refunds, listing edits, and media publication. |
| Multi-agent path | Principal agent remains coordinator; specialized agents are future proposals | Avoids novelty-driven over-automation. Evidence, scope, approval, audit, and rollback are prerequisites. |

## Data Flow

```text
Spanish Chat UI
  -> Principal Business Agent
  -> Custom Tools / Use Cases
       -> Local Memory + Cache
       -> Approval Queue + Audit Log
       -> OAuth MercadoLibre API Client
       -> Docs Lookup Adapter (official MCP, docs only)
  -> Insights / Creative Drafts / Prepared Actions
  -> Seller Approval -> Execute via direct APIs -> Audit result
```

Critical sync signals: OAuth account events, orders, claims, cancellations, stock, reputation, and messages update local cache through webhooks where available, otherwise risk-based scheduled refresh. Low-risk historical summaries reuse cached data.

## Modules / Components

- `apps/web`: Spanish chat, OAuth connection, approval review, audit views, creative previews.
- `packages/domain`: seller model, listings, orders, cache freshness, prepared action, approval, audit, specialization candidate types.
- `packages/mercadolibre`: OAuth token handling and direct `MLC` API clients.
- `packages/tools`: custom MCP/tool definitions that expose reads, prepared writes, memory, insights, creative drafts, and audit review.
- `packages/memory`: local PostgreSQL repositories, embeddings, freshness policy, selective sync policy.
- `packages/agent`: principal agent orchestration, prompt policies, confidence/risk labeling, learning evidence.
- `packages/workers`: sync jobs, trend radar, daily summary generation, creative draft preparation.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Create | Workspace scripts for build, test, lint, typecheck. |
| `apps/web/` | Create | Next.js Spanish chat and approval UI. |
| `packages/domain/` | Create | Core business contracts and policies. |
| `packages/mercadolibre/` | Create | OAuth and direct MercadoLibre API boundary for `MLC`. |
| `packages/tools/` | Create | Custom MCP/tools layer; official MCP docs adapter stays read-only. |
| `packages/memory/` | Create | Local-first cache, `pgvector` memory, freshness metadata. |
| `packages/agent/` | Create | Principal agent coordination and learning logic. |
| `packages/workers/` | Create | Sync, insight, trend, and creative background jobs. |
| `tests/` | Create | Cross-package integration and approval-flow tests. |

## Interfaces / Contracts

Prepared action contract: `id`, `sellerId`, `kind`, `target`, `exactChange`, `rationale`, `riskLevel`, `expiresAt`, `approvalStatus`, `auditId`. Tool responses MUST include `source`, `freshness`, `confidence`, and `requiresApproval` when relevant.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Domain policies, freshness rules, approval gating, risk labels | Vitest with table-driven cases. |
| Integration | OAuth boundary, MercadoLibre API clients, custom tools, cache repositories | Mock MercadoLibre APIs and verify no write executes without approval. |
| E2E | Spanish chat, account connection, prepared action approval, audit visibility | Playwright happy paths plus blocked-write scenarios. |

## Migration / Rollout

No production migration required for the blank repo. Roll out read-only OAuth, cache, and summaries first; then approval-gated writes; then creative drafts; finally evidence-only specialization candidates.

## Open Questions

- [ ] Confirm deployment target and whether local-first storage runs on seller hardware, a private server, or both.
- [ ] Confirm exact MercadoLibre OAuth scopes and webhook availability for `MLC` before implementation.
