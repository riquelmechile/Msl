# Proposal: MercadoLibre Business Agent

## Intent

Create a free conversational AI agent for MercadoLibre Chile (`MLC`) sellers that first learns the seller's business, explains daily signals, and proposes operational or creative improvements with approval before execution/publication. Long-term, the main agent may coordinate specialized agents only after evidence proves recurring workflows and safe delegation boundaries.

## Scope

### In Scope
- Spanish chat MVP for learning, corrections, and business analysis.
- OAuth-backed MercadoLibre API integration; official MCP/docs remain documentation lookup only.
- Custom business MCP/tools layer for safe agent capabilities over direct APIs, memory, insights, creative workflows, and audits.
- Local-first cache for listings, sales, interactions, reputation/shipping, and pricing.
- Daily executive summary and explainable recommendations.
- AI growth radar for relevant launches, capabilities, and experiments.
- AI-assisted product photo improvements and short video/reels-style drafts.
- Human approval gate for writes, especially price/stock, messages, cancellations, and refunds.
- Evidence-based extension path where the main agent may propose specialized agents after learning repeated tasks, operating style, and decision criteria.

### Out of Scope
- Autonomous write operations without explicit approval.
- Multi-market support beyond `MLC`.
- Paid dashboard, ads automation, supplier purchasing, or autonomous specialized agents in the MVP.
- Publishing or applying generated media without explicit human approval.
- Creating specialized agents from novelty, trend-following, or insufficient seller context.

## Capabilities

### New Capabilities
- `conversational-business-agent`: learns from questions, real cases, and corrections.
- `mercadolibre-account-integration`: OAuth, scopes, API access, and MCP/doc boundaries.
- `custom-business-mcp-tools`: safe approval-gated tools backed by direct MercadoLibre APIs, local memory/cache, insights, creative workflows, and audit controls.
- `business-memory-cache`: local persistence, freshness, and selective sync.
- `seller-business-insights`: daily summaries, opportunity/risk detection, and explanations.
- `ai-growth-creative-expansion`: tracks AI opportunities and drafts photos, videos, and value-creation assets.
- `action-approval-safety`: approval, audit, and risk controls for writes/publication.
- `multi-agent-orchestration`: long-term coordinator model where the principal agent proposes or creates specialized agents only from sufficient business evidence.

### Modified Capabilities
- None.

## Approach

Use the official MercadoLibre MCP only for current documentation lookup. Build a learning-first principal agent over custom tools, local memory/cache, insights, creative drafts, and approval/audit gates. Treat multi-agent delegation as a later architectural extension, not core MVP automation.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/specs/` | New/Modified | Add learning-first business agent, custom tools, safety, creative, and multi-agent extension specs. |
| `openspec/changes/mercadolibre-business-agent/` | Modified | Track proposal and future artifacts. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Official MCP misunderstood as operations layer | Med | State it is documentation lookup only; custom tools execute approved capabilities via direct APIs. |
| Harmful business writes | High | Require explicit approval, scopes, and audit trails. |
| Wasteful or stale data sync | Med | Define cache freshness by data type, cost, and risk. |
| Overbuilding autonomy too early | Med | Keep MVP read-first with prepared actions only. |
| Low-quality generated media | Med | Require preview, approval, and usage constraints. |
| Specialized agents created too early | Med | Require evidence of repeated workflows, decision criteria, scope, approval, and audit controls. |

## Rollback Plan

Revert this change folder and generated specs/design/tasks. If implementation begins, disable write/publication actions, then remove OAuth/API sync and cached data.

## Dependencies

- MercadoLibre docs, official MCP documentation endpoint, OAuth app/scopes, direct APIs, and Chile site behavior (`MLC`).
- A future stack, storage, security, and verification baseline.

## Success Criteria

- [ ] Specs clearly separate official MCP documentation lookup from the project's custom business tools.
- [ ] MVP remains Spanish-facing, read-heavy, and approval-gated for writes or asset publication.
- [ ] The agent produces daily summaries, value-creation ideas, and seller-approved creative drafts.
- [ ] Multi-agent expansion is documented as evidence-driven future architecture, not MVP automation.
