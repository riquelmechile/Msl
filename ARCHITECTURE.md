# ARCHITECTURE — MSL Agent Enterprise

> **Lead with the answer:** MSL is a hexagonal-architecture TypeScript monorepo for a CEO-led AI agent enterprise. The domain core is pure logic (no I/O). Six satellite packages — memory, mercadolibre, tools, agent, workers, and mcp — surround it. A Next.js app and a Telegram bot form the presentation layer. The agent package can orchestrate conversation through DeepSeek's LLM, using Cortex (SQLite neural graph) for persistent memory and learning; production capabilities are enabled explicitly through environment-backed secrets and SQLite paths.

> **Product framing:** MercadoLibre is the first operating channel, not the whole product. The canonical company-agent vision is documented in [`docs/agent-enterprise-vision.md`](docs/agent-enterprise-vision.md).

---

## Package dependency map

```
                    ┌───────────────────────────┐
                    │        apps/web            │
                    │    Next.js demo console    │
                    └─────────────┬─────────────┘
                                  │ (imports @msl/agent)
                                  ▼
┌──────────┐     ┌──────────────────────────────────────────────┐
│@msl/bot  │────▶│              @msl/agent                      │
│Telegram  │     │  Agent loop, guardrails, actors, autonomy    │
│runtime   │     │  DeepSeek client, strategy CRUD, Escribano   │
└──────────┘     └───┬───────────┬──────────┬──────────────────┘
                     │           │          │
          ┌──────────┘           │          └──────────┐
          ▼                      ▼                     ▼
 ┌─────────────────┐   ┌──────────────────┐   ┌──────────────────┐
 │  @msl/memory     │   │  @msl/mercadolibre│   │   @msl/domain    │
 │  Cortex graph    │   │  ML API client    │◀──│   Pure TS types   │
 │  Hebbian + CTE   │   │  OAuth + Sync     │   │   Hexagonal core  │
 └────────┬────────┘   └────────┬─────────┘   └────────┬─────────┘
          │                     │                       │
          │                     │         ┌─────────────┼─────────────┐
          │                     │         │             │             │
          │                     │         ▼             ▼             ▼
          │                     │  ┌──────────┐  ┌──────────┐  ┌───────────┐
          │                     │  │@msl/tools│  │@msl/mcp  │  │@msl/      │
          │                     │  │Approval  │  │Stdio MCP │  │workers    │
          │                     │  │queue     │  │30 tools  │  │Insights   │
          │                     │  │Audit     │  │          │  │Creative   │
          │                     │  └──────────┘  └──────────┘  │Sync jobs  │
          │                     │                              └───────────┘
          ▼                     ▼
   ┌──────────────────────────────────────┐
   │           @msl/domain                │
   │  (shared foundation — no I/O)        │
   │  Seller, Listing, Order, Message,    │
   │  Reputation, Claim, Stock, Approval, │
   │  Audit, CacheFreshness, ReadSnapshot │
   └──────────────────────────────────────┘
```

> **Rule:** Packages only depend outward on `@msl/domain`. No package depends on `@msl/agent` except `apps/web`, `@msl/bot`, and `@msl/mcp`.

## Current production boundaries

| Boundary          | Current implementation                                                                                                                                                             | Safety rule                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `/api/chat`       | Safe-by-default Next.js route; env can enable API-key auth, seller-bound SQLite state, and real DeepSeek.                                                                          | Do not run public production chat without setting the auth and durable chat env vars.               |
| Telegram bot      | grammY runtime; env can enable durable per-chat SQLite state and optional Cortex/Escribano memory writes.                                                                          | Do not commit `BOT_TOKEN`; keep mutation execution behind explicit approval gates.                  |
| Auth defaults     | Web chat auth, MCP auth, token encryption, and account role config fail closed.                                                                                                    | Local/demo/test bypasses must be explicit through env flags.                                        |
| OAuth tokens      | Tokens are encrypted with a key derived from `MSL_ENCRYPTION_KEY`; token save validates returned MercadoLibre `user_id`.                                                           | Never commit raw seller tokens; configure Plasticov/Maustian account IDs and connect through OAuth. |
| Dual-account sync | `sync_product` is configured as Plasticov → Maustian on MercadoLibre Chile (`MLC`) for one safety-bounded operation.                                                               | Do not model the accounts as factory/store roles; reverse or arbitrary seller IDs are rejected.     |
| MCP               | Stdio server exposes 30 compatible tools across MercadoLibre reads, proposal preparation, approval/status, Cortex, claims, shipping, moderation, notices, and image orchestration. | Treat production business-operation execution as approval-gated and environment-backed.             |

## Data flow: a conversation turn

```
User message (Spanish)
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│ @msl/agent — createAgentLoop(config).converse(msg, state)     │
│                                                               │
│  1. VALIDATE                                                  │
│     ├─ spanishValidator(msg)          → block if not Spanish  │
│     └─ harmfulContentFilter(msg)      → block if harmful      │
│                                                               │
│  2. DEGRADATION (if autonomyEngine)                           │
│     └─ autonomyEngine.evaluateDegradation() → adjust level    │
│                                                               │
│  3. STRATEGY CRUD (if store)                                  │
│     └─ detectStrategyIntent(msg) → handle list/update/archive │
│                                                               │
│  4. BUILD MESSAGES                                            │
│     ├─ systemPrompt (Block A: identity + hard rules)          │
│     ├─ CEO strategies (Block B: injected rules)               │
│     ├─ conversation history (context window enforced)         │
│     └─ user message (latest)                                  │
│                                                               │
│  5. LLM CALL (DeepSeek or mock)                               │
│     └─ Tool call loop: execute non-prepare_action tools       │
│                                                               │
│  6. PARSE RESPONSE                                            │
│     ├─ Extract AgentProposal from tool calls                  │
│     ├─ Extract pending proposal on "dale" confirmation        │
│     └─ Strategy guardrail check                               │
│                                                               │
│  7. AUTONOMY GATE                                             │
│     └─ If level allows auto-approval → execute, record KPI    │
│                                                               │
│  8. SELF-VERIFY (calibrated distrust)                         │
│     └─ selfVerify(proposal) → 6 verification checks           │
│                                                               │
│  9. ESCRIBANO (memory scribe + Darwinian feedback)            │
│     └─ observeTurn() → constellation-wide outcome propagation │
│     └─ approve: +0.10 all activated edges, reject: −0.15 all  │
│     └─ Outcome node recorded even on empty constellation      │
│                                                               │
│ 10. RETURN ConverseResult                                      │
│     └─ { response, updatedState, proposal? }                  │
└──────────────────────────────────────────────────────────────┘
```

## Key design decisions

| Decision                   | Choice                                     | Tradeoff                                                                                                          |
| -------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Hexagonal domain**       | `@msl/domain` has zero I/O dependencies    | Tests run instantly. Every adapter is swappable.                                                                  |
| **SQLite Cortex**          | Recursive CTEs for spreading activation    | No graph DB dependency. Single file. ~400 lines.                                                                  |
| **3-block cache**          | DeepSeek prefix-anchored cache             | ~98% cost reduction. Stable lane prefixes (CEO, Cost, Market, Creative) with refreshable context.                 |
| **CEO lanes**              | `@msl/agent/lanes.ts` — 4 specialist lanes | CEO coordinates cache-resident specialists; `delegate_to_subagent` as OpenAI function tool.                       |
| **Operational read model** | SQLite snapshots + checkpoints per seller  | 5 entity kinds (listings, claims, questions, orders, messages) + reputation trends. Local-first reads.            |
| **Darwinian learning**     | Spreading-activation outcome propagation   | Approved proposals reinforce entire activated constellation; rejections penalize all edges. Learning generalizes. |
| **Hybrid parser**          | Regex fast-path for strategy CRUD          | 80% of natural commands bypass LLM entirely. Zero API cost. Also detects Spanish rejection patterns.              |
| **Hybrid parser**          | Regex fast-path for strategy CRUD          | 80% of natural commands bypass LLM entirely. Zero API cost.                                                       |
| **Calibrated distrust**    | Agent verifies its own proposals           | Catches hallucinated actions before user sees them. 6 checks per proposal.                                        |
| **MCP protocol**           | Stdio server with 30 compatible tools      | Compatible clients can exercise read, proposal, approval/status, Cortex, and MercadoLibre evidence surfaces.      |
| **No framework**           | Plain TypeScript + OpenAI SDK              | No LangChain, no Mastra, no abstractions. Direct API access.                                                      |

## Directory tree

```
Msl/
├── apps/
│   └── web/                      # Next.js 15 demo console
│       ├── app/
│       │   ├── page.tsx          # Landing page
│       │   ├── layout.tsx        # Root layout
│       │   ├── demo.ts           # Deterministic agent demo
│       │   ├── demo-console.tsx  # Interactive console UI
│       │   └── styles.css        # Spanish product copy
│       ├── next.config.ts
│       └── package.json
│
├── packages/
│   ├── domain/                   # Hexagonal core — pure TypeScript
│   │   └── src/
│   │       ├── seller.ts         # Seller identity, risk levels
│   │       ├── listing.ts        # Product listings
│   │       ├── order.ts          # Orders with status lifecycle
│   │       ├── message.ts        # Buyer/seller messages
│   │       ├── reputation.ts     # Reputation metrics
│   │       ├── claim.ts          # Claims/disputes
│   │       ├── stock.ts          # Inventory management
│   │       ├── cacheFreshness.ts # TTL/criticality evaluation
│   │       ├── readSnapshot.ts   # Read pattern with freshness
│   │       ├── preparedAction.ts # Write actions with risk
│   │       ├── approval.ts       # Approval state machine
│   │       ├── audit.ts          # Audit trail records
│   │       └── specializationEvidence.ts  # Agent specialization readiness
│   │
│   ├── memory/                   # Cortex neural graph memory
│   │   └── src/
│   │       ├── index.ts          # Repository boundaries, freshness decisions
│   │       └── cortex/
│   │           ├── types.ts      # GraphNode, GraphEdge, Activation Snapshot
│   │           ├── engine.ts     # Graph engine: CRUD, spread, prune, Hebbian
│   │           ├── database.ts   # SQLite schema + migrations
│   │           └── index.ts      # Public API
│   │
│   ├── mercadolibre/             # ML API integration
│   │   └── src/
│   │       ├── index.ts          # MlClient, OAuth, normalization, mock data
│   │       ├── types.ts          # MlItem, MlOrder, MlQuestion, MlCategory
│   │       ├── oauth/
│   │       │   ├── oauthManager.ts  # Multi-account OAuth with stub mode
│   │       │   └── tokenStore.ts    # Token persistence
│   │       └── sync/
│   │           ├── syncEngine.ts    # Product sync from Plasticov → Maustian
│   │           ├── diffEngine.ts    # Listing diff detection
│   │           ├── strategyApplier.ts  # Apply pricing/stock/category strategies
│   │           └── syncStore.ts     # Sync state persistence
│   │
│   ├── agent/                    # Conversational agent (DeepSeek)
│   │   └── src/
│   │       ├── index.ts          # Deterministic business Q&A engine
│   │       └── conversation/
│   │           ├── types.ts      # Message, Proposal, State, Strategy types
│   │           ├── agentLoop.ts  # Core loop: validate → LLM → parse → gate (1391 lines)
│   │           ├── systemPrompt.ts  # Block A builder with strategy/autonomy injection
│   │           ├── guardrails.ts    # 6 safety validators
│   │           ├── selfVerify.ts    # Calibrated-distrust verification
│   │           ├── strategyParser.ts  # Hybrid regex→rule strategy parser
│   │           ├── strategyStore.ts   # SQLite strategy persistence
│   │           ├── actorSimulator.ts  # Comprador/proveedor/competidor simulation
│   │           ├── probeDetector.ts   # Competitive intelligence detection
│   │           ├── honeyPotProposer.ts # Decoy proposal generation
│   │           ├── autonomyEngine.ts  # 6-level autonomy + KPI + degradation
│   │           ├── cacheBlocks.ts     # 3-block cache strategy
│   │           ├── tools.ts          # Tool definitions for function calling
│   │           ├── syncTools.ts      # sync_product, sync_all, check_account tools
│   │           └── escribano.ts      # Memory scribe observer
│   │
│   ├── tools/                    # Business tools + approval queue
│   │   └── src/
│   │       └── index.ts          # Read tools, write tools, approval, audit, execute
│   │
│   ├── workers/                  # Background workers
│   │   └── src/
│   │       ├── index.ts          # Sync job stubs, stale signal evaluation
│   │       ├── insights/
│   │       │   └── index.ts      # Business insight generation
│   │       └── creative/
│   │           └── index.ts      # Creative asset generation
│   │
│   ├── mcp/                      # MCP (Model Context Protocol) server
│   │   └── src/
│   │       └── index.ts          # 30 tools: ML evidence, proposal/approval/status,
│   │                             #   Cortex, claims, shipping, moderation, notices
│   │
│   └── bot/                      # Telegram bot runtime
│       └── src/
│           └── index.ts          # Message handler → agent loop
│
├── tests/
│   └── e2e/                      # Playwright E2E specs
│
├── scripts/
│   └── run-e2e.mjs               # Platform-guarded E2E runner
│
├── package.json                  # Workspace root
├── tsconfig.base.json            # Strict TS config (all packages extend)
├── tsconfig.json                 # Root project references
├── vitest.config.ts              # Package aliases + test includes
├── playwright.config.ts          # E2E configuration
├── eslint.config.js              # Typed ESLint with next/core-web-vitals
├── .prettierrc.json              # Consistent formatting
│
├── openspec/                     # SDD artifacts (spec-driven)
│   ├── config.yaml
│   ├── specs/
│   └── changes/
│
└── ROADMAP.md                    # Project roadmap + technology decisions
```

## Module descriptions

### `@msl/domain` — Hexagonal core

Pure TypeScript types and pure functions. No I/O, no database, no framework. Defines the business model: Seller, Listing, Order, Message, Reputation, Claim, Stock, PreparedAction, Approval, Audit, CacheFreshness, ReadSnapshot, SpecializationEvidence. Every other package depends on this one. This is the only package that should never need a rewrite.

### `@msl/memory` — Cortex neural graph

SQLite-backed graph engine using recursive Common Table Expressions (CTEs) for spreading activation. Implements Hebbian learning (fire together → wire together), Darwinian pruning (unused edges → archived lessons), and convergence detection. The graph is schema-flexible: `GraphNode` carries typed metadata, `GraphEdge` tracks weight, co-occurrence count, and distilled lessons.

### `@msl/mercadolibre` — ML API client

Multi-account OAuth manager with encrypted token persistence and expiration tracking. Token storage validates the returned MercadoLibre `user_id` against the configured Plasticov or Maustian seller account before saving. `MlClient` exposes read operations (items, orders, questions, categories, user info) and write operations (publish, update). Includes a product sync engine (`syncEngine.ts`) for the configured Plasticov → Maustian sync boundary, applying CEO strategies (margin, stock, category, pricing) without treating the accounts as a business hierarchy. Real HTTP transport with exponential backoff. Stub mode is for explicit local/test development without real tokens.

### `@msl/agent` — Conversational agent

The brain. `createAgentLoop()` orchestrates every conversation turn through 10 steps: validate → degrade? → strategy CRUD? → build messages → LLM call → parse → autonomy gate → self-verify → Escribano → return. Supports mock client (deterministic, no API key needed), real DeepSeek client, streaming mode, and tool-aware function calling. The mock client handles simulate_actor, detect_probes, and propose_honey_pot tool chains with realistic conversational patterns.

### `@msl/tools` — Business tools + approval queue

Read tools for listings, orders, messages, and reputation (with freshness-awareness and blocked-state handling). Write tools through a prepare → approve → execute → audit pipeline. Every write action goes through risk evaluation, expiration checking, and audit trail recording. In-memory repository implementation suitable for single-instance deployment.

### `@msl/workers` — Background workers

Sync job stubs for critical business signals (orders, claims, cancellations, stock, reputation, messages). Stale signal evaluation with freshness-based decisions. Insights worker for business intelligence generation. Creative worker for asset generation.

### `@msl/mcp` — Model Context Protocol server

Stdio-based MCP server exposing 30 compatible tools across agent simulation, Cortex consultation, strategy reads, MercadoLibre evidence, proposal preparation, approval/status, claims, shipping, moderation, notices, and image orchestration. Compatible with MCP clients that can launch the stdio server. Schema definitions use zod for input validation. Production business-operation execution remains approval-gated and environment-backed.

### `@msl/bot` — Telegram bot

Telegram runtime around the agent loop. Handles incoming Telegram messages, forwards them to the agent, and sends responses back. Environment variables can enable durable per-chat SQLite state and optional Cortex/Escribano memory writes. Business mutations still require explicit approval gates.

### `apps/web` — Demo console

Next.js 15 + React 19. Deterministic demo that exercises the agent's business Q&A engine without requiring a real LLM API key. The `/api/chat` route creates in-memory demo strategy/autonomy stores per request and forces `mockClient: true`; it is not production chat persistence or real DeepSeek wiring. Spanish product copy throughout. Interactive console UI for testing conversation flows.
