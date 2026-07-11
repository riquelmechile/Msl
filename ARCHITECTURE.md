# ARCHITECTURE — MSL Agent Enterprise

> **Lead with the answer:** MSL is a hexagonal-architecture TypeScript monorepo for a CEO-led AI agent enterprise. The domain core is pure logic (no I/O). Ten satellite packages — agent, memory, mercadolibre, tools, workers, mcp, bot, creative-studio, ecommerce-medusa, and domain — surround it. A Next.js web app forms the presentation layer. The agent package orchestrates conversation through DeepSeek's LLM, using Cortex (SQLite neural graph) for persistent memory and learning. Fourteen specialist daemon handlers run on 15-minute cycles through the Agent Message Bus, collaborating via inter-agent evidence requests and responses. Production capabilities are enabled explicitly through environment-backed secrets and SQLite paths.

> **Product framing:** MercadoLibre is the first operating channel, not the whole product. The canonical company-agent vision is documented in [`docs/agent-enterprise-vision.md`](docs/agent-enterprise-vision.md).

---

## Package dependency map

```
                    ┌───────────────────────────┐
                    │        apps/web            │
                    │    Next.js 15 console      │
                    └─────────────┬─────────────┘
                                  │ (imports @msl/agent)
                                  ▼
┌──────────┐     ┌──────────────────────────────────────────────┐
│@msl/bot  │────▶│              @msl/agent                      │
│Telegram  │     │  Agent loop, guardrails, lanes, autonomy     │
│runtime   │     │  DeepSeek client, Escribano, daemon handlers │
└──────────┘     │  EvidenceResponseRouter, Work Sessions       │
                 │  AccountBrain, Company Agents, CEO Inbox     │
                 └───┬───────────┬──────────┬──────────────────┘
                     │           │          │
          ┌──────────┘           │          └──────────┐
          ▼                      ▼                     ▼
 ┌─────────────────┐   ┌──────────────────┐   ┌──────────────────┐
 │  @msl/memory     │   │  @msl/mercadolibre│   │   @msl/domain    │
 │  Cortex graph    │   │  ML API client    │◀──│   Pure TS types   │
 │  Hebbian + CTE   │   │  OAuth + Sync     │   │   Hexagonal core  │
 │  Op Read Model   │   │  Supplier sources │   │                   │
 │  Evidence Req    │   │                   │   │                   │
 │  Supplier Mirror │   │                   │   │                   │
 │  Owned Ecommerce │   │                   │   │                   │
 └────────┬────────┘   └────────┬─────────┘   └────────┬─────────┘
          │                     │                       │
          │                     │         ┌─────────────┼─────────────┐
          │                     │         │             │             │
          │                     │         ▼             ▼             ▼
          │                     │  ┌──────────┐  ┌──────────┐  ┌────────────┐
          │                     │  │@msl/tools│  │@msl/mcp  │  │@msl/workers│
          │                     │  │Approval  │  │Stdio MCP │  │Background  │
          │                     │  │queue     │  │~40 tools │  │ingestion   │
          │                     │  │Audit     │  │          │  │Creative    │
          │                     │  └──────────┘  └──────────┘  │Supplier    │
          │                     │                              │Mirror      │
          │                     │                              └────────────┘
          │                     │
          ▼                     ▼
   ┌──────────────────────────────────────────────┐
   │  @msl/creative-studio    @msl/ecommerce-medusa │
   │  MiniMax image/video     Medusa write boundary │
   │  Policy engine           Preview adapter       │
   │  Cost ledger             Storefront projections│
   └──────────────────────────────────────────────┘
```

> **Rule:** Packages only depend outward on `@msl/domain`. No package depends on `@msl/agent` except `apps/web`, `@msl/bot`, and `@msl/mcp`.

## Implementation status

| Categoría                                 | Componentes                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Implementado y conectado**              | Agent Message Bus, Cortex, 15 daemon handlers, 16 lane contracts, Operational Read Model, EvidenceResponseRouter + 5 responders, Work Sessions, Account Assets + AccountBrain, AgentWorkSessionStore/Runner, CEO Inbox Store, Company Agent Registry, Learning Store, Skill Store, Workforce Cost Cache Ledger, Agent Consensus Store, Escribano, Economic Truth Foundation (Money, EconomicCostComponent, UnitEconomicsSnapshot, EconomicOutcome, EconomicOutcomeStore, 3 inspector tools), Finance Director Agent (FinanceDirectorAdvisor, FinanceDirectorPromptBuilder, FinanceDirectorValidator, FinanceDirectorFallback, FinanceDirectorEvidenceAssembler, FinanceDirectorAssessmentStore, 4 CEO advisory tools, daemon handler), Background Ingestion (5 procesadores), Telegram Bot runtime, MCP Server (~40 tools) |
| **Implementado pero feature-gated**       | Creative Studio (MiniMax), Owned Ecommerce (Medusa write boundary), Supplier Mirror workers                                                                                                                                                                                                                                                                                                                                           |
| **Implementado con read-only production** | MercadoLibre OAuth (dual-account, per-seller apps, encrypted token storage, health service, smoke tests), ML API reads (real OAuth, no stub mode) |
| **Preparación solamente, sin mutación**   | sync_product (propuesta preparada, no ejecutada), Supplier Mirror (dry-run, no worker habilitado)                                                                                                                                                                                                                                                                                                                                     |
| **Pendiente de producción**               | Credenciales reales ML OAuth, ingesta real, ecommerce productivo, canales sociales, expansión multicanal                                                                                                                                                                                                                                                                                                                              |

## Current production boundaries

| Boundary           | Current implementation                                                                                                                                                                                                                 | Safety rule                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/chat`        | Safe-by-default Next.js route; env can enable API-key auth, seller-bound SQLite state, and real DeepSeek.                                                                                                                              | Do not run public production chat without setting the auth and durable chat env vars.                                                                                               |
| Telegram bot       | grammY runtime; env can enable durable per-chat SQLite state and optional Cortex/Escribano memory writes.                                                                                                                              | Do not commit `BOT_TOKEN`; keep mutation execution behind explicit approval gates.                                                                                                  |
| Agent workforce    | Company-agent registry, learning store, active company-agent routing, and cost/cache ledger are internal CEO orchestration resources.                                                                                                  | Do not expose worker selection or direct worker chat to Telegram users; learned lessons do not override system, safety, or CEO policy.                                              |
| Auth defaults      | Web chat auth, MCP auth, token encryption, and account role config fail closed.                                                                                                                                                        | Local/demo/test bypasses must be explicit through env flags.                                                                                                                        |
| OAuth tokens       | Tokens are encrypted with AES-256-GCM key derived from `MSL_ENCRYPTION_KEY`; token save validates returned MercadoLibre `user_id`. Per-seller OAuth apps (Plasticov and Maustian) with independent refresh. Read-only production — writes blocked by `assertMercadoLibreWriteDisabled()`. | Never commit raw seller tokens; configure Plasticov/Maustian account IDs and connect through OAuth.                                                                                 |
| Dual-account sync  | `sync_product` is configured as Plasticov → Maustian on MercadoLibre Chile (`MLC`) for one safety-bounded operation.                                                                                                                   | Do not model the accounts as factory/store roles; reverse or arbitrary seller IDs are rejected.                                                                                     |
| Supplier Mirror    | Supplier evidence, target policies, local SQLite readiness records, and Jinpeng bootstrap dry-run are available for CEO review. Supplier Mirror target policies are independent from the Plasticov → Maustian `sync_product` boundary. | Do not enable live workers without explicit runtime gate, stored readiness, and CEO approval; dry-run must not store secrets, call external APIs, publish, pause, or update prices. |
| MCP                | Stdio server exposes ~40 tools across MercadoLibre reads, proposal preparation, approval/status, Cortex, claims, shipping, moderation, notices, image orchestration, workforce, and cost ledger.                                       | Treat production business-operation execution as approval-gated and environment-backed.                                                                                             |
| Bot (multi-seller) | Single-instance bot resolves all accounts to configured `sellerId`. Multi-seller dale resolution requires multi-bot deployment.                                                                                                        | Column-scoped stores are ready; single-instance limitation is a deployment constraint, not an architecture gap.                                                                     |

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
│     └─ user message + Block C evidence (latest)               │
│                                                               │
│  5. LLM CALL (DeepSeek or mock)                               │
│     └─ Tool call loop: execute non-prepare_action tools       │
│                                                               │
│  6. CONSENSUS CHECK (if high-risk action)                     │
│     └─ requiresConsensus(actionKind)? → AgentConsensusStore   │
│     └─ Multi-agent review with quorum: approve/reject/        │
│         needs_more_evidence/risk_warning                      │
│     └─ Shows multi-agent verdicts before CEO sees proposal    │
│                                                               │
│  7. PARSE RESPONSE                                            │
│     ├─ Extract AgentProposal from tool calls                  │
│     ├─ Extract pending proposal on "dale" confirmation        │
│     └─ Strategy guardrail check                               │
│                                                               │
│  8. AUTONOMY GATE                                             │
│     └─ If level allows auto-approval → execute, record KPI    │
│                                                               │
│  9. SELF-VERIFY (calibrated distrust)                         │
│     └─ selfVerify(proposal) → 6 verification checks           │
│                                                               │
│ 10. ESCRIBANO (memory scribe + Darwinian feedback)            │
│     └─ observeTurn() → constellation-wide outcome propagation │
│     └─ approve: +0.10 all activated edges, reject: −0.15 all  │
│     └─ Outcome node recorded even on empty constellation      │
│                                                               │
│ 11. RETURN ConverseResult                                      │
│     └─ { response, updatedState, proposal? }                  │
└──────────────────────────────────────────────────────────────┘
```

## Key design decisions

| Decision                             | Choice                                     | Tradeoff                                                                                                                               |
| ------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Hexagonal domain**                 | `@msl/domain` has zero I/O dependencies    | Tests run instantly. Every adapter is swappable.                                                                                       |
| **SQLite Cortex**                    | Recursive CTEs for spreading activation    | No graph DB dependency. Single file.                                                                                                   |
| **3-block cache**                    | DeepSeek prefix-anchored cache             | Stable lane prefixes (ceo, cost-supplier, market-catalog, creative, etc.) with refreshable context.                                    |
| **CEO lanes**                        | 15 lane contracts in `LANE_CONTRACTS`      | CEO coordinates cache-resident specialists; `delegate_to_subagent` as OpenAI function tool.                                            |
| **Agent Message Bus**                | SQLite-backed async message queue          | Agents communicate via persistent messages with claim/resolve/fail lifecycle. Deduplication, retry, priority ordering.                 |
| **Specialist Daemons**               | 15 daemon handlers on 15-min schedule      | Dispatched through Agent Message Bus. Investigate evidence, propose to CEO, never mutate. Seven lanes support Work Session routing.      |
| **Evidence Response Router**         | Dispatches to 5 specialized responders     | CostSupplier, MarketCatalog, CreativeAssets, AccountBrain, SupplierManager. Agents request bounded evidence before escalating.         |
| **Multi-agent evidence**             | Inter-agent evidence requests + responses  | Specialist agents answer structured evidence requests with confidence levels. Enables collaborative reasoning without CEO involvement. |
| **OwnedEcommerceEvidenceAggregator** | CEO candidate enrichment                   | Aggregates multi-responder evidence to enrich owned-ecommerce proposals with cost, market, creative, account, and supplier context.    |
| **Work Sessions**                    | AgentWorkSessionStore + Runner             | Persistent sessions with cooldown mechanics. Six sessionized lanes route through WorkSessionRunner for stateful multi-turn work.       |
| **Account Assets**                   | AccountAssetStore + AccountBrainService    | Per-seller strategic asset tracking with capabilities, profit goals, risks, opportunities, and health snapshots.                       |
| **Deep Evidence**                    | `searchSnapshots()` with SQL filters       | Rich querying via `json_extract` on snapshots. Status, price, date, category filters. Parameterized SQL, zero injection risk.          |
| **Consensus Review**                 | Multi-agent review with quorum             | High-risk proposals require 2+ agent reviews before CEO sees them. Verdicts: approve/reject/needs_more_evidence/risk_warning.          |
| **Process Separation**               | 4 PM2 processes (bot, web, worker, daemon) | Bot decoupled from ingestion. Daemons run independently. `busy_timeout = 5000` for SQLite concurrency.                                 |
| **CEO-only Telegram**                | `@msl/bot` routes text to the CEO agent    | Workers/managers/departments stay internal. No `/agent` worker-selection UX or direct worker chat.                                     |
| **Workforce context**                | Active company-agent ID from env/config    | Selects internal lesson/delegation context only; admin authorization remains a separate allowlisted runtime gate.                      |
| **Cost/cache context**               | Ledger summaries injected in Block C       | Keeps dynamic operating evidence out of Block A so prefix-cache stability is preserved. Not billing truth.                             |
| **Operational read model**           | SQLite snapshots + checkpoints per seller  | 8 entity kinds (listings, claims, questions, orders, messages, reputation, product-ads-insights, pricing). Local-first reads.          |
| **Supplier Mirror**                  | Local-first supplier evidence + policies   | Supplier/Jinpeng readiness uses local SQLite records, source adapters, and CEO-review proposals before any worker enablement.          |
| **Darwinian learning**               | Spreading-activation outcome propagation   | Approved proposals reinforce entire activated constellation; rejections penalize all edges. Learning generalizes.                      |
| **Hybrid parser**                    | Regex fast-path for strategy CRUD          | 80% of natural commands bypass LLM entirely. Zero API cost. Also detects Spanish rejection patterns.                                   |
| **Calibrated distrust**              | Agent verifies its own proposals           | Catches hallucinated actions before user sees them. 6 checks per proposal.                                                             |
| **MCP protocol**                     | Stdio server with ~40 tools                | Compatible clients can exercise read, proposal, approval/status, Cortex, MercadoLibre evidence, workforce, and cost ledger surfaces.   |
| **Financial truth**                  | Pure domain + SQLite store + CEO tools     | Safe Money type (integer `amountMinor`, CLP+USD), 12 cost component types with provenance, 6-state EconomicOutcome lifecycle, deterministic calculation engine, seller-isolated EconomicOutcomeStore, 3 read-only CEO inspection tools. Missing data ≠ zero. No floating point. Only `verified` outcomes eligible for future Cortex learning. |
| **Finance Director Agent**           | DeepSeek-powered financial reasoning     | Transversal financial manager. Interprets economic truth (never calculates). Advisor pipeline: assemble → prompt → reason → validate → fallback. 15 anti-hallucination validation rules (was 14, budget-violation rule now implemented). 4 CEO advisory tools (ask_finance_director, review_financial_health, explain_economic_outcome, review_proposal_profitability). SQLite assessment store, cache-friendly 4-block prompt design, sessionized lane with 8 wake reasons. |
| **Cortex Economic Reinforcement**    | Verified outcomes → Darwinian learning   | Closes the Financial Truth cycle. Three-tier deterministic architecture: eligibility gate (10 block reasons) → economic signal (direction/magnitude/confidence) → 5-level attribution (none→causal) → separated reinforcement plan → idempotent Cortex bridge with before/after hashes. SQLite learning ledger with seller isolation and full reversal support. Four memory types (episodic/semantic/procedural/economic). Policy versioning. Finance Director read-only learning inspection tools. EconomicLearningTrigger wired to outcome transitions with daemon handler. |
| **Production Readiness**             | Environment validation & fail-closed gates | Central configuration inventory (75+ env vars), 7 specialized checkers, per-seller readiness (Plasticov/Maustian), SQLite diagnostics, `assertProductionCapabilityReady()` gate, `npm run production:readiness` CLI, `inspect_production_readiness` CEO tool, secret sanitizer. Zero HTTP, zero mutations. |
| **No framework**                     | Plain TypeScript + OpenAI SDK              | No LangChain, no Mastra, no abstractions. Direct API access.                                                                           |

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
│   │       ├── supplierMirror.ts # Supplier evidence, policies, ledger, lessons
│   │       ├── preparedAction.ts # Write actions with risk
│   │       ├── approval.ts       # Approval state machine
│   │       ├── audit.ts          # Audit trail records
│   │       ├── specializationEvidence.ts # Agent specialization readiness
│   │       └── evidence.ts       # Inter-agent evidence request/response types
│   │
│   ├── memory/                   # Cortex neural graph memory
│   │   └── src/
│   │       ├── index.ts          # Repository boundaries, freshness decisions
│   │       ├── evidenceRequestStore.ts  # Evidence request persistence
│   │       ├── supplierMirrorStore.ts   # Supplier Mirror SQLite store
│   │       ├── ownedEcommerceStore.ts   # Owned ecommerce persistence
│   │       └── cortex/
│   │           ├── types.ts      # GraphNode, GraphEdge, Activation Snapshot
│   │           ├── engine.ts     # Graph engine: CRUD, spread, prune, Hebbian
│   │           ├── database.ts   # SQLite schema + migrations
│   │           └── index.ts      # Public API
│   │
│   ├── mercadolibre/             # ML API integration
│   │   └── src/
│   │       ├── index.ts          # MlClient, OAuth, normalization
│   │       ├── types.ts          # MlItem, MlOrder, MlQuestion, MlCategory
│   │       ├── supplierSource.ts  # Supplier Mirror source adapters
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
│   │       ├── conversation/
│   │       │   ├── types.ts      # Message, Proposal, State, Strategy types
│   │       │   ├── agentLoop.ts  # Core loop: validate → LLM → parse → gate
│   │       │   ├── systemPrompt.ts  # Block A builder
│   │       │   ├── guardrails.ts    # 6 safety validators
│   │       │   ├── selfVerify.ts    # Calibrated-distrust verification
│   │       │   ├── strategyParser.ts  # Hybrid regex→rule strategy parser
│   │       │   ├── strategyStore.ts   # SQLite strategy persistence
│   │       │   ├── actorSimulator.ts  # Actor simulation
│   │       │   ├── probeDetector.ts   # Competitive intelligence detection
│   │       │   ├── honeyPotProposer.ts # Decoy proposal generation
│   │       │   ├── autonomyEngine.ts  # 6-level autonomy + KPI + degradation
│   │       │   ├── cacheBlocks.ts     # Block cache strategy
│   │       │   ├── lanes.ts          # 15 lane contracts
│   │       │   ├── tools.ts          # Tool definitions
│   │       │   ├── escribano.ts      # Memory scribe observer
│   │       │   ├── agentMessageBusStore.ts   # Agent Message Bus
│   │       │   ├── agentConsensusStore.ts    # Multi-agent consensus
│   │       │   ├── ceoInboxStore.ts          # CEO proposal inbox
│   │       │   ├── companyAgents.ts          # Company agent registry
│   │       │   ├── accountAssetStore.ts      # Account asset persistence
│   │       │   ├── accountBrainService.ts    # Account brain intelligence
│   │       │   ├── workforceCostCacheLedgerStore.ts # Cost cache ledger
│   │       │   ├── supplierMirrorDeepSeekAdvisor.ts # Supplier AI advisor
│   │       │   ├── catalogDeepSeekAdvisor.ts       # Catalog AI advisor
│   │       │   ├── costSupplierDeepSeekAdvisor.ts   # Cost AI advisor
│   │       │   ├── creativeDeepSeekAdvisor.ts       # Creative AI advisor
│   │       │   ├── operationsDeepSeekAdvisor.ts     # Operations AI advisor
│   │       │   └── tools/                      # Tool handler implementations
│   │       ├── finance/                        # Finance Director Agent
│   │       │   ├── FinanceDirectorAdvisor.ts
│   │       │   ├── FinanceDirectorPromptBuilder.ts
│   │       │   ├── FinanceDirectorValidator.ts
│   │       │   ├── FinanceDirectorFallback.ts
│   │       │   └── FinanceDirectorEvidenceAssembler.ts
│   │       ├── evidence/
│   │       │   ├── evidenceResponseRouter.ts    # Dispatches evidence requests
│   │       │   └── responders/
│   │       │       ├── accountBrainEvidenceResponder.ts
│   │       │       ├── costSupplierEvidenceResponder.ts
│   │       │       ├── creativeAssetsEvidenceResponder.ts
│   │       │       ├── marketCatalogEvidenceResponder.ts
│   │       │       └── supplierManagerEvidenceResponder.ts
│   │       ├── sessions/
│   │       │   ├── AgentWorkSessionStore.ts    # Session persistence
│   │       │   ├── AgentWorkSessionRunner.ts   # Session lifecycle
│   │       │   ├── agentWorkCortexBridge.ts    # Cortex ↔ Session bridge
│   │       │   ├── agentWakePolicy.ts          # Wake/sleep policy
│   │       │   └── agentShiftSummary.ts        # Shift summary generation
│   │       ├── workers/
│   │       │   ├── daemonScheduler.ts          # 15-handler daemon scheduler
│   │       │   ├── daemonTypes.ts              # Daemon handler types
│   │       │   ├── marketCatalogDaemon.ts
│   │       │   ├── operationsManagerDaemon.ts
│   │       │   ├── costSupplierDaemon.ts
│   │       │   ├── creativeCommercialDaemon.ts
│   │       │   ├── creativeAssetsDaemon.ts
│   │       │   ├── creativeStudioDaemon.ts
│   │       │   ├── productAdsMonitorDaemon.ts
│   │       │   ├── productAdsProfitabilityDaemon.ts
│   │       │   ├── ceoProfitabilityHandler.ts
│   │       │   ├── supplierManagerDaemon.ts
│   │       │   ├── morningReportDaemon.ts
│   │       │   ├── eodSummaryDaemon.ts
│   │       │   ├── ownedEcommerceDaemon.ts
│   │       │   ├── unansweredQuestionsDaemon.ts
│   │       │   └── financeDirectorDaemon.ts
│   │       └── ecommerce/
│   │           └── ownedEcommerceIntelligenceService.ts
│   │
│   ├── tools/                    # Business tools + approval queue
│   │   └── src/
│   │       └── index.ts          # Read tools, write tools, approval, audit, execute
│   │
│   ├── workers/                  # Background workers
│   │   └── src/
│   │       ├── index.ts          # Sync job stubs, stale signal evaluation
│   │       ├── supplierMirror/    # Disabled-by-default scheduler, monitor, Jinpeng bootstrap
│   │       ├── insights/
│   │       │   └── index.ts      # Business insight generation
│   │       └── creative/
│   │           └── index.ts      # Creative asset generation
│   │
│   ├── mcp/                      # MCP (Model Context Protocol) server
│   │   └── src/
│   │       └── index.ts          # ~40 tools: ML evidence, proposal/approval/status,
│   │                             #   Cortex, claims, shipping, moderation, notices,
│   │                             #   workforce, cost ledger
│   │
│   ├── creative-studio/          # AI content generation
│   │   └── src/
│   │       └── index.ts          # MiniMax image/video generation,
│   │                             #   policy engine, cost ledger
│   │
│   ├── ecommerce-medusa/          # Owned ecommerce runtime
│   │   └── src/
│   │       └── index.ts          # Medusa write boundary, preview adapter,
│   │                             #   storefront projections, env-based config
│   │
│   └── bot/                      # Telegram bot runtime
│       └── src/
│           └── index.ts          # Message handler → agent loop
│
├── tests/
│   └── e2e/                      # Playwright E2E specs
│
├── scripts/
│   ├── run-e2e.mjs               # Platform-guarded E2E runner
│   └── supplier-mirror-jinpeng-bootstrap.mjs
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

Pure TypeScript types and pure functions. No I/O, no database, no framework. Defines the business model: Seller, Listing, Order, Message, Reputation, Claim, Stock, PreparedAction, Approval, Audit, CacheFreshness, ReadSnapshot, SpecializationEvidence, EvidenceRequest/Response. Every other package depends on this one. This is the only package that should never need a rewrite.

### `@msl/memory` — Cortex neural graph

SQLite-backed graph engine using recursive Common Table Expressions (CTEs) for spreading activation. Implements Hebbian learning (fire together → wire together), Darwinian pruning (unused edges → archived lessons), and convergence detection. The graph is schema-flexible: `GraphNode` carries typed metadata, `GraphEdge` tracks weight, co-occurrence count, and distilled lessons.

Also contains: Operational Read Model (SQLite snapshots + checkpoints for 8 entity kinds), Supplier Mirror Store, Owned Ecommerce Store, and Evidence Request Store.

### `@msl/mercadolibre` — ML API client

Multi-account OAuth manager with encrypted token persistence and expiration tracking. `MlClient` exposes read operations (items, orders, questions, categories, user info) and write operations (publish, update). Includes a product sync engine (`syncEngine.ts`) for the configured Plasticov → Maustian sync boundary. Real HTTP transport with exponential backoff. Stub mode is for explicit local/test development without real tokens.

Supplier Mirror source adapters live here too. `supplierSource.ts` can collect supplier evidence from MercadoLibre as stock-authoritative data.

### `@msl/agent` — Conversational agent

The brain. `createAgentLoop()` orchestrates every conversation turn through 11 steps: validate → degrade? → strategy CRUD? → build messages → LLM call → consensus check → parse → autonomy gate → self-verify → Escribano → return. Supports mock client (deterministic, no API key needed), real DeepSeek client, streaming mode, and tool-aware function calling.

**Evidence Pipeline:** `EvidenceResponseRouter` dispatches pending evidence requests to 5 specialized responders (CostSupplier, MarketCatalog, CreativeAssets, AccountBrain, SupplierManager). Each responder checks `canHandle()` and returns structured `EvidenceResponsePayload` with confidence levels. The `OwnedEcommerceEvidenceAggregator` enriches CEO candidates by aggregating multi-responder evidence.

**Work Sessions:** `AgentWorkSessionStore` persists session state; `AgentWorkSessionRunner` manages lifecycle with cooldown mechanics. Seven sessionized lanes (unanswered-questions, product-ads-profitability, creative-assets, operations-manager, morning-report, eod-summary, finance-director) route through work sessions for stateful multi-turn reasoning.

**Daemon Handlers (15):** `marketCatalogDaemon`, `operationsManagerDaemon`, `costSupplierDaemon`, `creativeAssetsDaemon`, `creativeCommercialDaemon`, `creativeStudioDaemon`, `productAdsMonitorDaemon`, `productAdsProfitabilityDaemon`, `ceoProfitabilityHandler`, `supplierManagerDaemon`, `morningReportDaemon`, `eodSummaryDaemon`, `ownedEcommerceDaemon`, `unansweredQuestionsDaemon`, `financeDirectorDaemon`. All dispatched by `startDaemonScheduler()` on 15-minute cycles through the Agent Message Bus.

**Lane Contracts (15):** `ceo`, `cost-supplier`, `market-catalog`, `creative-assets`, `creative-commercial`, `creative-studio`, `operations-manager`, `owned-ecommerce`, `product-ads-monitor`, `product-ads-ceo-profitability`, `product-ads-profitability`, `supplier-manager`, `morning-report`, `eod-summary`, `unanswered-questions`.

**Account Assets:** `AccountAssetStore` persists per-seller strategic assets with capabilities, profit goals, risks, opportunities, and health snapshots. `AccountBrainService` provides intelligence scoring, cross-account comparison, and channel recommendations.

### `@msl/tools` — Business tools + approval queue

Read tools for listings, orders, messages, and reputation (with freshness-awareness and blocked-state handling). Write tools through a prepare → approve → execute → audit pipeline. Every write action goes through risk evaluation, expiration checking, and audit trail recording.

### `@msl/workers` — Background workers

Background ingestion processors, supplier mirror scheduler (disabled by default), insights worker for business intelligence generation, and creative worker for asset generation.

### `@msl/mcp` — Model Context Protocol server

Stdio-based MCP server exposing ~40 tools across agent simulation, Cortex consultation, strategy reads, MercadoLibre evidence, proposal preparation, approval/status, claims, shipping, moderation, notices, image orchestration, workforce, and cost ledger. Schema definitions use zod for input validation. Production business-operation execution remains approval-gated and environment-backed.

### `@msl/creative-studio` — AI content generation

MiniMax image and video generation with policy engine, cost controls, and job queue. Feature-gated behind `MSL_CREATIVE_STUDIO_ENABLED` and `MINIMAX_API_KEY`.

### `@msl/ecommerce-medusa` — Owned ecommerce runtime

Medusa write boundary (fail-closed), preview adapter for static storefront projections, blocking check collection for readiness validation, and env-gated production activation via `MEDUSA_RUNTIME_WRITE_ENABLED`. Live publish/checkout requires explicit env credentials + CEO approval.

### `@msl/bot` — Telegram bot

Telegram runtime around the CEO agent loop using grammY. CEO-only routing; workers and specialists are internal coordination resources. Business mutations require explicit approval gates. Single-instance bot has a multi-seller dale limitation: all accounts resolve to the configured `sellerId`. Multi-bot deployment is needed for distinct per-seller dale resolution.

### `apps/web` — Demo console

Next.js 15 + React 19. Deterministic demo that exercises the agent's business Q&A engine without requiring a real LLM API key. The `/api/chat` route creates in-memory demo strategy/autonomy stores per request and forces `mockClient: true`. Spanish product copy throughout. Interactive console UI for testing conversation flows.

### Account Asset Model — Multi-seller strategic scoping

The `AccountAsset` domain model treats each MercadoLibre seller account as a strategic asset with its own capabilities, profit goal, risk level, and memory scoping.

| Concept               | Implementation                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Account record        | `account_assets` table — one row per `seller_id`, with `name`, `marketplace`, `profit_goal`, `risk_level`, `status`         |
| Capabilities          | `account_capabilities` table — per-account capabilities (`publish`, `pricing`, `claims`, `ads`, etc.) with health snapshots |
| Health history        | `account_health_snapshots` — time-series of health states with reputation, sales velocity, and risk level                   |
| Profit goals          | `account_profit_goals` — target margin percentage per seller                                                                |
| Strategy notes        | `account_strategy_notes` — strategic directives per seller or global (`seller_id = NULL`)                                   |
| Risks & opportunities | `account_risks`, `account_opportunities` — tracked business risks and opportunities per seller                              |

#### Column scoping vs. file isolation

Column-level `seller_id` scoping **complements** existing file-level bot isolation:

```
File-level (bot)          Column-level (daemons + strategic memory)
┌─────────────────────┐   ┌──────────────────────────────────────────┐
│ Bot A → db-A.sqlite  │   │ Daemon Scheduler                         │
│ sellerId = plasticov │   │   └─ single strategic DB                 │
│                       │   │        ├─ nodes.seller_id = (A|B|NULL)  │
│ Bot B → db-B.sqlite  │   │        ├─ strategies.seller_id           │
│ sellerId = maustian  │   │        └─ account_assets.seller_id       │
└─────────────────────┘   └──────────────────────────────────────────┘
```

Bots stay file-isolated (one `sellerId` per `createTelegramBot`). Daemons share a single strategic DB with column-scoped queries so the CEO can compare accounts and the scheduler can dispatch per-seller evidence.

### Agent Message Bus

SQLite-backed asynchronous message queue. Agents communicate through persistent messages with `enqueue` → `claim` → `resolve`/`fail` lifecycle. Supports deduplication keys, retry, and priority ordering. Self-triggering daemon ticks carry `sellerId` and `cycleTimestamp` for per-account scheduling.

### Supplier Mirror runtime modules

Supplier Mirror spans multiple packages but stays local-first and disabled by default:

| Module                                                             | Role                                                                                                                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/supplierMirror.ts`                            | Pure supplier registry, item, stock observation, target policy, ledger, notification, and learned fallback types.                                                 |
| `packages/memory/src/supplierMirrorStore.ts`                       | SQLite persistence for suppliers, item snapshots, stock observations, mappings, policies, ledger records, notification preferences/events, and fallback policies. |
| `packages/mercadolibre/src/supplierSource.ts`                      | Source adapter boundary; MercadoLibre API is stock-authoritative, XKP/fallback evidence is not.                                                                   |
| `packages/workers/src/supplierMirror/`                             | Disabled-by-default scheduler, stock-break monitor, runtime gate checks, and Jinpeng bootstrap/readiness flow.                                                    |
| `packages/agent/src/conversation/supplierMirrorDeepSeekAdvisor.ts` | DeepSeek advisor that analyzes supplier evidence and returns structured findings for CEO review.                                                                  |
| `scripts/supplier-mirror-jinpeng-bootstrap.mjs`                    | Operator CLI behind `npm run supplier-mirror:jinpeng:dry-run`.                                                                                                    |

Runtime gate flow: seed/readiness evidence → CEO review → explicit worker enablement only when runtime env, stored readiness, and CEO approval all exist.
