<p align="center">
  <h1>MSL — Agent Enterprise for Commerce</h1>
  <p>CEO-led AI agent company for commerce operations. Natural language. Controlled autonomy. Revenue-driven.</p>
</p>

<p align="center">
  <code>Vitest + Playwright</code> ·
  <code>TypeScript 5.8</code> ·
  <code>Node ≥22</code> ·
  <code>DeepSeek v4</code> ·
  <code>MIT</code>
</p>

---

## What it does

MSL is a proactive conversational AI agent for MercadoLibre Chile. It ingests your business data (listings, orders, ads, pricing, claims, reputation), builds durable operational evidence in a local SQLite read model, runs a neural graph memory (Cortex) for learning, coordinates 4 cache-resident CEO specialist lanes powered by DeepSeek, and proposes concrete profit-maximizing actions — all through natural Spanish conversation. Every action requires your explicit "dale" before execution.

**Business context:** Plasticov and Maustian are separate MercadoLibre Chile seller accounts used as parallel commercial channels. Each account can carry independent prices, listing types, titles, and exposure strategies for the same or similar products. Fulfillment is product-level: some products use owned stock and others are supplier-sourced/arbitrage.

## Product vision

MSL is evolving from MercadoLibre operating intelligence into an **AI agent enterprise**: a CEO-led hierarchy of managers, departments, and specialists that learn through Cortex, collaborate before escalating, and ask the human CEO only for business decisions through Telegram. MercadoLibre is the first operating channel; the long-term product includes owned ecommerce, social channels, suppliers, ads, content/creative work, and additional marketplaces.

Read the canonical vision in [`docs/agent-enterprise-vision.md`](docs/agent-enterprise-vision.md).

## Quick start

```bash
git clone https://github.com/riquelmechile/Msl.git
cd Msl
npm install
npm test          # Vitest unit/integration suite
npm run dev       # http://127.0.0.1:3000
```

### Runtime / ops quick path

```bash
npm run supplier-mirror:jinpeng:dry-run
```

Use the Jinpeng dry-run only with environment-provided runtime values. It requires an explicit `MSL_SUPPLIER_MIRROR_DB_PATH`, Jinpeng ML identity/source env, target seller IDs for Maustian/Plasticov, and MercadoLibre credentials. Never paste real secret values into docs, Git, issues, or chat logs.

> **Current runtime boundary:** the Next.js `/api/chat` and Telegram bot stay safe by default with local/mock behavior. When the required env vars are configured, `/api/chat` can persist durable SQLite chat state and use DeepSeek; Telegram can persist per-chat sessions/strategy/autonomy state and optionally write Cortex memory through Escribano. Telegram remains CEO-only for the human: workforce/managers/departments are internal CEO context and delegation details, not user-facing `/agent` selection commands.

> **Agent Enterprise boundary:** the human talks to the CEO agent only. Managers, departments, specialists, workforce lessons, and cost/cache ledger entries are internal orchestration resources coordinated by the CEO agent. Workforce lessons are durable company-agent context, but they never override system, safety, or CEO policy. Active company-agent routing can select environment/configuration context for lessons and delegation; it does not grant Telegram admin authorization.

> **Verification:** CI and release readiness should keep the durable gates green: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, and `npm run build`.

## Environment secrets

Secrets belong in local env files or deployment secret stores, never in Git.

```bash
cp .env.example .env.local
```

Then paste your real API keys/passwords into `.env.local`. If `.env.local` already exists, edit it directly instead of replacing it. Keep `.env.example` committed with blank placeholder values only. For CI or hosted deploys, store the same values as GitHub Secrets or platform secrets; do not add secret values to workflow YAML.

Naming matters here: **MSL** is the project/app name; **ML** means MercadoLibre; **MLC** is the MercadoLibre Chile site code, not an account identity. Plasticov and Maustian are symmetric seller accounts, not a factory/store hierarchy. The configured Plasticov → Maustian `sync_product` path is a specific sync/safety boundary; it is not the full business model. MercadoLibre app credentials identify the developer application; seller accounts are connected through OAuth and stored per account, not committed as raw tokens.

- Never prefix private keys with `NEXT_PUBLIC_`; Next.js exposes those values to the browser bundle.
- Never paste raw MercadoLibre seller access or refresh tokens into docs, Git, examples, issues, or chat logs. Seller tokens are obtained through OAuth and stored per account.
- `/api/chat`, MCP auth, token encryption, and sync/write account roles fail closed unless the required env vars are set or an explicit local/demo/test escape hatch is enabled (`MSL_ALLOW_UNAUTHENTICATED_LOCAL=true`, `MSL_ALLOW_INSECURE_DEV_SECRETS=true`).
- Set `MSL_ENCRYPTION_KEY` before storing real OAuth tokens. Changing it can make existing encrypted local tokens unreadable; missing keys are only acceptable in explicit local/demo/test mode.
- If a real secret is accidentally committed or pushed, rotate/revoke it immediately and remove it from history before trusting the repository again.

### Runtime secrets checklist

Fill only the values you are ready to enable in `.env.local` or your deployment secret store:

| Enables             | Variables                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telegram bot        | `BOT_TOKEN`, optional `MSL_TELEGRAM_SQLITE_PATH`, optional `MSL_TELEGRAM_CORTEX_SQLITE_PATH` or `MSL_CORTEX_SQLITE_PATH`, `MSL_CHAT_SELLER_ID`, `MSL_CHAT_SELLER_NAME`     |
| Agent workforce     | Optional `MSL_TELEGRAM_ACTIVE_COMPANY_AGENT_ID`; optional admin gate `MSL_COMPANY_AGENT_ADMIN_ENABLED` plus `MSL_TELEGRAM_ADMIN_CHAT_IDS` or `MSL_TELEGRAM_ADMIN_USER_IDS` |
| Real LLM responses  | `DEEPSEEK_API_KEY`                                                                                                                                                         |
| Durable web chat    | `MSL_API_KEY`, `MSL_CHAT_SQLITE_PATH`, `MSL_CHAT_SELLER_ID`, `MSL_CHAT_SELLER_NAME`                                                                                        |
| MCP auth/runtime    | `MSL_MCP_API_KEY`, `MSL_APPROVAL_QUEUE_DB_PATH`                                                                                                                            |
| OAuth token storage | `MSL_ENCRYPTION_KEY`, `MERCADOLIBRE_CLIENT_ID`, `MERCADOLIBRE_CLIENT_SECRET`, `MERCADOLIBRE_REDIRECT_URI`, `MSL_MERCADOLIBRE_OAUTH_DB_PATH`                                |
| Dual-account sync   | `MERCADOLIBRE_SOURCE_SELLER_ID`, `MERCADOLIBRE_TARGET_SELLER_ID` (optional aliases: `PLASTICOV_SELLER_ID`, `MAUSTIAN_SELLER_ID`)                                           |
| Supplier Mirror     | `MSL_SUPPLIER_MIRROR_DB_PATH`, Jinpeng ML identity/source env, `MSL_MAUSTIAN_SELLER_ID`, `MSL_PLASTICOV_SELLER_ID`, MercadoLibre credentials                               |

Telegram durable session keys include the configured seller id (`telegram:<sellerId>:<chatId>`), so reusing a SQLite file after changing `MSL_CHAT_SELLER_ID` does not load a previous seller's chat state. Telegram Cortex/Escribano memory also opens a seller-scoped SQLite filename derived from `MSL_TELEGRAM_CORTEX_SQLITE_PATH` or, if unset, `MSL_CORTEX_SQLITE_PATH`.

## Production boundary today

| Area               | Current state                                                                                                                                                                                                                                                        | Do not assume yet                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Web chat           | `/api/chat` is safe-by-default; env can enable API-key auth, seller-bound SQLite persistence, and DeepSeek.                                                                                                                                                          | Public unauthenticated production chat.                                                                                      |
| Telegram bot       | grammY bot can use env-backed SQLite sessions and optional Cortex/Escribano memory. Human interaction stays with the CEO agent; workforce context is internal routing/lesson context only.                                                                           | Secret values in Git, `/agent` worker-selection UX, or mutation execution without approval gates.                            |
| Agent workforce    | Durable company-agent registry, internal lessons, and cost/cache ledger evidence can inform CEO orchestration when configured.                                                                                                                                       | Direct worker-selection UX, worker chat, billing-dashboard behavior, or policy overrides from learned context.               |
| MercadoLibre OAuth | OAuth flow stores tokens only after validating returned `user_id` against the configured seller role.                                                                                                                                                                | Manual raw token setup or account role guessing.                                                                             |
| Product sync       | Configured Plasticov → Maustian `sync_product` preparation on `MLC`; reverse/arbitrary seller IDs are rejected as a safety boundary.                                                                                                                                 | Business hierarchy between accounts or general-purpose bidirectional sync.                                                   |
| Supplier Mirror    | Supplier/Jinpeng readiness can seed local SQLite evidence and CEO-review target proposals for Maustian and Plasticov through `npm run supplier-mirror:jinpeng:dry-run`. Supplier targeting is independent from the old Plasticov → Maustian `sync_product` boundary. | Live autonomous supplier sync, persisted secrets, external API calls in dry-run, or publish/pause/price mutations.           |
| Owned ecommerce    | Preview foundation is implemented: the worker builds deterministic Medusa-oriented storefront projections, stores static preview JSON, validates local/data preview media, and serves the static `/storefront/[projectionId]` route without request-time LLM calls.  | Live Medusa deployment, checkout/payment activation, public publish, price/stock mutation, or stored production credentials. |
| MCP tools          | MCP exposes 30 tools for compatible clients (listings, prices, orders, sync, approval, decisions, listing_prices, claims, returns, moderation, notices, shipping, image orchestration).                                                                              | Production business-operation execution through MCP.                                                                         |
| ML Business Data   | Background worker ingests listing/visit/order snapshots into Cortex. DeepSeek generates daily insights. Proactive alerts via Telegram.                                                                                                                               | Real-time MercadoLibre data without OAuth tokens for every role.                                                             |
| CI                 | Pull requests and `main` run format, typecheck, lint, tests, build, and E2E.                                                                                                                                                                                         | Secrets in CI; use GitHub Secrets/platform secrets.                                                                          |

## Architecture

```
                 ┌──────────────────────────────────────┐
                 │            CEO (Telegram)             │
                 │   Natural language strategy injection │
                 │ "apunto a 50%+ margen, priorizo stock"│
                 └────────────────┬─────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      @msl/agent (DeepSeek)                           │
│  ┌───────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │ Intent Engine  │  │ Guardrails   │  │  Actor Simulator          │ │
│  │ (no commands)  │  │ (6 gates)    │  │  (comprador/vendor)       │ │
│  └───────┬───────┘  └──────┬───────┘  └──────────┬────────────────┘ │
│          │                 │                      │                  │
│  ┌───────┴─────────────────┴──────────────────────┴────────────────┐ │
│  │              30 ML Business Tools                               │ │
│  │  calculate_listing_fees · read_my_listings · find_paused_listings│ │
│  │  check_listing_visits · read_product_ads_insights · read_orders  │ │
│  │  check_listing_quality · relist_listing · diagnose_image · upload│ │
│  │  check_price_intelligence · find_automated_price_items           │ │
│  │  read_seller_promotions · read_item_promotions                   │ │
│  │  delegate_to_subagent · get_business_context · consult_cortex    │ │
│  │  read_moderation_status · read_notices · read_claims · questions │ │
│  └──────────────────────────┬─────────────────────────────────────┘ │
│          ┌──────────────────┴──────────────────┐                     │
│          │  Background Ingestion Worker (6h)   │  DeepSeek Inference │
│          │  Listings, ads, pricing, claims,    │  Daily insights     │
│          │  questions, orders, messages,       │                     │
│          │  reputation, returns snapshots      │                     │
│          └─────────────────────────────────────┘                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │              Cache Strategy (3-block prefix-anchored)           │ │
│  │  A: System prompt (5K, eternal)  │ B: Aggregates (15K/24h)     │ │
│  │  C: Cortex context injection (per query, 0.3-2K)               │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────┬───────────────┬───────────────┬──────────────────────────┘
            │               │               │
            ▼               ▼               ▼
┌────────────────┐  ┌──────────────┐  ┌───────────────────────────┐
│  @msl/memory   │  │  @msl/tools  │  │  @msl/mercadolibre         │
│  Cortex (SQLite)│  │  Approval Q  │  │  ML API (OAuth+HTTP)       │
│  · Hebbian      │  │  Audit trail │  │  · Product sync            │
│  · CTE spread   │  │  Risk gates  │  │  · Orders/messages         │
│  · Darwinian    │  │  Execute     │  │  · Reputation              │
│  · Business node│  │              │  │  · Listing prices (fees)   │
│    protection   │  │              │  │  · Visits API              │
│  · queryBy      │  │              │  │  · Status-filtered search  │
│    Metadata     │  │              │  │                            │
│  · Historical   │  │              │  │                            │
│    snapshots    │  │              │  │                            │
└────────┬───────┘  └──────┬───────┘  └──────────┬────────────────┘
          │                 │                      │
          └─────────┬───────┴──────────────────────┘
                    │
                    ▼
          ┌──────────────────┐
          │   @msl/domain    │
          │   Pure TypeScript │
          │   No I/O, No DB  │
          │   Hexagonal core │
          └────────┬─────────┘
                   │
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
┌────────────┐  ┌──────────┐  ┌──────────┐
│  @msl/bot  │  │ @msl/mcp │  │@msl/     │
│  Telegram  │  │ Stdio    │  │workers   │
│  grammY    │  │ MCP srv  │  │Insights  │
│  Proactive │  │30 tools  │  │Creative  │
│  alerts    │  │          │  │Sync jobs │
│  Multi-    │  │          │  │Ingestion │
│  seller    │  │          │  │worker    │
└────────────┘  └──────────┘  │(6h)      │
                             └──────────┘
```

## Capabilities

| #   | System                                  | What it does                                                                                                                                                                                                    |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Agent Loop**                          | Orchestrates conversation turns: validate → cache → LLM → parse → gate                                                                                                                                          |
| 2   | **Cortex Memory**                       | Neural graph (SQLite + recursive CTEs). Hebbian learning, Darwinian pruning                                                                                                                                     |
| 3   | **Escribano**                           | Memory scribe that observes every turn and autonomously updates Cortex                                                                                                                                          |
| 4   | **Guardrails**                          | 6 safety gates: Spanish-only, harmful content, action safety, strategy compliance, honey-pot TOS, autonomy gate                                                                                                 |
| 5   | **Self-Verification**                   | Calibrated-distrust: the agent checks its own proposals before presenting them                                                                                                                                  |
| 6   | **Strategy Parser**                     | Hybrid parser (regex fast-path → regex/rule matching) for CEO strategy injection                                                                                                                                |
| 7   | **Actor Simulator**                     | Simulates comprador, proveedor, and competidor mental models via LLM                                                                                                                                            |
| 8   | **Probe Detection**                     | Detects competitor intelligence-gathering patterns in questions and views                                                                                                                                       |
| 9   | **Honey-Pot Proposer**                  | Generates decoy proposals when competitor probes are detected                                                                                                                                                   |
| 10  | **Autonomy Engine**                     | 6 autonomy levels (CONSULTA → FULL) with KPI tracking and auto-degradation                                                                                                                                      |
| 11  | **Product Sync**                        | Prepares Plasticov → Maustian listing sync proposals behind approval gates as one configured account boundary                                                                                                   |
| 12  | **Approval Queue**                      | Every write action goes through prepare → approve → execute → audit                                                                                                                                             |
| 13  | **ML Business Tools**                   | 30 tools for real MercadoLibre data: listings, fees, orders, ads, pricing, promotions, quality, relist, images, visits, claims, returns, shipping, moderation, notices, orchestration                           |
| 14  | **Background Ingestion**                | 6h worker ingesting 8 entity kinds (listings, claims, questions, orders, messages, reputation, product ads, pricing) into operational DB with per-kind checkpoints and freshness TTLs                           |
| 15  | **Seasonal Detection**                  | Analyzes 2+ years of order history to detect seasonal patterns per category, 30-day advance alerts                                                                                                              |
| 16  | **Cross-Account Intelligence**          | Compares Plasticov vs Maustian performance, detects gaps, suggests sync opportunities                                                                                                                           |
| 17  | **Proactive Alerts**                    | Push notifications for visit anomalies, paused listing reuse, seasonal preparation, cross-account gaps                                                                                                          |
| 18  | **DeepSeek Inference**                  | Daily business intelligence: feeds Cortex data to DeepSeek for insight generation                                                                                                                               |
| 19  | **Actionable Proposals**                | prepare_action with 10 action kinds, data-driven proposals with estimated profit impact                                                                                                                         |
| 20  | **Listing Quality**                     | Audits listing score (0-100) via /performance API, surfaces OPPORTUNITY/WARNING rules by variable                                                                                                               |
| 21  | **Relist Intelligence**                 | Detects closed/paused listings eligible for relist (<60 days), preserves visits/questions/sales history                                                                                                         |
| 22  | **Image Pipeline**                      | Pre-publish image diagnostic (white_background, text_logo, watermark) + upload to ML CDN via API                                                                                                                |
| 23  | **Pricing Intelligence**                | Read-only pricing automation rules, history, and competitive price suggestions per item/catalog                                                                                                                 |
| 24  | **Promotions Intelligence**             | Read-only seller campaign discovery, item promotion participation, boosted offers, coupon budgets, pre-negotiated offers                                                                                        |
| 25  | **CEO Socio Lanes**                     | Coordinator lane with cache-resident specialists (Cost/Supplier, Market/Catalog, Creative/Commercial) using stable DeepSeek prefixes for near-zero cache-hit cost                                               |
| 26  | **Operational Read Model**              | SQLite-backed full business context: listings, claims, questions, orders, messages, reputation snapshots with per-seller lane isolation and freshness TTLs                                                      |
| 27  | **Darwinian Cortex Learning**           | Spreading-activation outcome propagation: approved proposals strengthen activated constellation edges (+0.10), rejected weaken all (−0.15); learning generalizes across shared concept edges                    |
| 28  | **DeepSeek Tool Smoke**                 | Opt-in official DeepSeek V4 tool-call validation with forced delegate_to_subagent, synthetic user_id lane isolation, and cache telemetry                                                                        |
| 29  | **Product Ads Evidence**                | Background ingestion persists `product-ads-insights` operational snapshots with ROAS metadata, checkpoints, and safe-read-only semantics; CEO/campaign/market lanes cite durable ad evidence                    |
| 30  | **Catalog Competition**                 | Bounded rotated `price_to_win` ingestion as `pricing` operational snapshots with deterministic evidence IDs; market/margin lanes retrieve durable competition evidence                                          |
| 31  | **Returns Evidence**                    | 3 safe-read return tools (detail, reviews, return-cost) via MercadoLibre post-purchase API and MCP; MLC-to-confirm degradation; no mutation, upload, or refund execution                                        |
| 32  | **Agent Workforce Kernel**              | Durable company-agent registry, internal workforce lessons, and CEO-only routing context. Telegram does not expose worker selection or direct worker chat.                                                      |
| 33  | **Cost/Cache Operating Ledger**         | Internal bounded ledger for token/cache counters and routing evidence. Summaries stay in Block C, omit raw prompts/responses/secrets/raw IDs, and are not billing truth.                                        |
| 34  | **Supplier Mirror / Jinpeng Readiness** | Local SQLite supplier evidence, target-policy proposals, disabled-by-default scheduler gates, and Jinpeng dry-run bootstrap. No live supplier automation is enabled yet.                                        |
| 35  | **Owned Ecommerce Preview Foundation**  | Medusa-oriented storefront candidates/projections, static preview route, readiness/approval guardrails, local/data media boundary, and DeepSeek fallback behavior. Live Medusa publish/checkout remains future. |

## Stack

| Layer        | Technology                                   | Why                                                         |
| ------------ | -------------------------------------------- | ----------------------------------------------------------- |
| **Runtime**  | Node.js 22 + TypeScript 5.8                  | Strict mode, composite project references                   |
| **LLM**      | DeepSeek v4 Flash/Pro                        | 1M context window, ~98% cache discount, OpenAI-compatible   |
| **Memory**   | SQLite (better-sqlite3) + recursive CTEs     | Zero external services, ~400 lines TS                       |
| **Web UI**   | Next.js 15 + React 19                        | Demo console for deterministic agent interaction            |
| **Bot**      | Telegram (grammY, proactive messaging)       | Natural language interface, no UI needed                    |
| **Protocol** | MCP (`@modelcontextprotocol/sdk`)            | Compatible tool surface for business evidence and proposals |
| **Testing**  | Vitest (unit/integration) + Playwright (E2E) | Guarded platform support                                    |
| **Quality**  | ESLint + Prettier + tsc strict               | No warnings, no untyped code                                |

## Philosophy

**1. No commands — natural language only.** The seller never sees a menu, never types a command, never learns a syntax. They say what they want in Spanish and the agent infers intent. Commands are fragile. Conversation is robust.

**2. Safety gates are invisible infrastructure, not the product.** The seller never thinks about guardrails, approval queues, or audit trails. They just say "dale" when they agree. Everything else happens automatically behind the scenes.

**3. Organic growth: cell → tissue → organ → organism.** Start with ONE agent, ONE memory system, ONE LLM. No plugin architectures, no multi-backend complexity, no premature framework scaffolding.

**4. Profit maximization is the ONLY KPI.** Every tool, every insight, every proposal serves one goal: more net profit for the seller. Data infra exists to surface the highest-margin opportunities first.

## Verification

```bash
npm test              # Vitest unit + integration suite
npm run test:e2e      # Playwright E2E (auto-skipped on unsupported platforms)
npm run typecheck     # TypeScript strict mode — zero tolerance
npm run lint          # ESLint with typed rules
npm run format:check  # Prettier — consistent style
npm run build         # Full workspace build
```

> **Note:** E2E tests use `scripts/run-e2e.mjs` which auto-skips with a friendly message on platforms without Playwright browser support (e.g., Android/Termux).
