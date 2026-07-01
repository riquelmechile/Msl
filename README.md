<p align="center">
  <h1>MSL — Plasticov / Maustian AI Agent</h1>
  <p>Conversational AI agent for MercadoLibre Chile sellers. Natural language. No commands. Revenue-driven.</p>
</p>

<p align="center">
  <code>870+ tests</code> ·
  <code>TypeScript 5.8</code> ·
  <code>Node ≥22</code> ·
  <code>DeepSeek v4</code> ·
  <code>MIT</code>
</p>

---

## What it does

MSL is a proactive AI agent that manages your MercadoLibre Chile business through natural conversation in Spanish. It reads real-time data from the MercadoLibre API (listings, fees, visits, orders, ads), persists historical business data in a neural graph memory (Cortex), runs background ingestion every 6 hours, detects anomalies and seasonal patterns, compares cross-account performance (Plasticov ↔ Maustian), uses DeepSeek to infer business insights, and proposes concrete profit-maximizing actions — all through natural conversation. Every action requires your explicit "dale" before execution.

**Business context:** Plasticov and Maustian are separate MercadoLibre Chile seller accounts used as parallel commercial channels. Each account can carry independent prices, listing types, titles, and exposure strategies for the same or similar products. Fulfillment is product-level: some products use owned stock and others are supplier-sourced/arbitrage.

## Quick start

```bash
git clone https://github.com/riquelmechile/Msl.git
cd Msl
npm install
npm test          # 870+ tests in 38 files
npm run dev       # http://127.0.0.1:3000
```

> **Current runtime boundary:** the Next.js `/api/chat` and Telegram bot stay safe by default with local/mock behavior. When the required env vars are configured, `/api/chat` can persist durable SQLite chat state and use DeepSeek; Telegram can persist per-chat sessions/strategy/autonomy state and optionally write Cortex memory through Escribano.

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

| Enables             | Variables                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telegram bot        | `BOT_TOKEN`, optional `MSL_TELEGRAM_SQLITE_PATH`, optional `MSL_TELEGRAM_CORTEX_SQLITE_PATH` or `MSL_CORTEX_SQLITE_PATH`, `MSL_CHAT_SELLER_ID`, `MSL_CHAT_SELLER_NAME` |
| Real LLM responses  | `DEEPSEEK_API_KEY`                                                                                                                                                     |
| Durable web chat    | `MSL_API_KEY`, `MSL_CHAT_SQLITE_PATH`, `MSL_CHAT_SELLER_ID`, `MSL_CHAT_SELLER_NAME`                                                                                    |
| MCP auth/runtime    | `MSL_MCP_API_KEY`, `MSL_APPROVAL_QUEUE_DB_PATH`                                                                                                                        |
| OAuth token storage | `MSL_ENCRYPTION_KEY`, `MERCADOLIBRE_CLIENT_ID`, `MERCADOLIBRE_CLIENT_SECRET`, `MERCADOLIBRE_REDIRECT_URI`, `MSL_MERCADOLIBRE_OAUTH_DB_PATH`                            |
| Dual-account sync   | `MERCADOLIBRE_SOURCE_SELLER_ID`, `MERCADOLIBRE_TARGET_SELLER_ID` (optional aliases: `PLASTICOV_SELLER_ID`, `MAUSTIAN_SELLER_ID`)                                       |

Telegram durable session keys include the configured seller id (`telegram:<sellerId>:<chatId>`), so reusing a SQLite file after changing `MSL_CHAT_SELLER_ID` does not load a previous seller's chat state. Telegram Cortex/Escribano memory also opens a seller-scoped SQLite filename derived from `MSL_TELEGRAM_CORTEX_SQLITE_PATH` or, if unset, `MSL_CORTEX_SQLITE_PATH`.

## Production boundary today

| Area               | Current state                                                                                                                        | Do not assume yet                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Web chat           | `/api/chat` is safe-by-default; env can enable API-key auth, seller-bound SQLite persistence, and DeepSeek.                          | Public unauthenticated production chat.                                    |
| Telegram bot       | grammY bot can use env-backed SQLite sessions and optional Cortex/Escribano memory.                                                  | Secret values in Git, or mutation execution without approval gates.        |
| MercadoLibre OAuth | OAuth flow stores tokens only after validating returned `user_id` against the configured seller role.                                | Manual raw token setup or account role guessing.                           |
| Product sync       | Configured Plasticov → Maustian `sync_product` preparation on `MLC`; reverse/arbitrary seller IDs are rejected as a safety boundary. | Business hierarchy between accounts or general-purpose bidirectional sync. |
| MCP tools          | MCP exposes 7 tools for compatible clients (listings, prices, orders, sync, approval, decisions, listing_prices).          | Production business-operation execution through MCP.                       |
| ML Business Data   | Background worker ingests listing/visit/order snapshots into Cortex. DeepSeek generates daily insights. Proactive alerts via Telegram. | Real-time MercadoLibre data without OAuth tokens for every role.                   |
| CI                 | Pull requests and `main` run format, typecheck, lint, tests, build, and E2E.                                                         | Secrets in CI; use GitHub Secrets/platform secrets.                        |

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
│  │              10 ML Business Tools                               │ │
│  │  calculate_listing_fees · read_my_listings · find_paused_listings│ │
│  │  check_listing_visits · read_product_ads_insights · read_orders  │ │
│  │  check_listing_quality · relist_listing · diagnose_image · upload│ │
│  └──────────────────────────┬─────────────────────────────────────┘ │
│          ┌──────────────────┴──────────────────┐                     │
│          │  Background Ingestion Worker (6h)   │  DeepSeek Inference │
│          │  Multi-seller snapshots → Cortex    │  Daily insights     │
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
│  Proactive │  │7 tools   │  │Creative  │
│  alerts    │  │          │  │Sync jobs │
│  Multi-    │  │          │  │Ingestion │
│  seller    │  │          │  │worker    │
└────────────┘  └──────────┘  │(6h)      │
                             └──────────┘
```

## Capabilities

| #   | System                 | What it does                                                                                                    |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | **Agent Loop**         | Orchestrates conversation turns: validate → cache → LLM → parse → gate                                          |
| 2   | **Cortex Memory**      | Neural graph (SQLite + recursive CTEs). Hebbian learning, Darwinian pruning                                     |
| 3   | **Escribano**          | Memory scribe that observes every turn and autonomously updates Cortex                                          |
| 4   | **Guardrails**         | 6 safety gates: Spanish-only, harmful content, action safety, strategy compliance, honey-pot TOS, autonomy gate |
| 5   | **Self-Verification**  | Calibrated-distrust: the agent checks its own proposals before presenting them                                  |
| 6   | **Strategy Parser**    | Hybrid parser (regex fast-path → regex/rule matching) for CEO strategy injection                                |
| 7   | **Actor Simulator**    | Simulates comprador, proveedor, and competidor mental models via LLM                                            |
| 8   | **Probe Detection**    | Detects competitor intelligence-gathering patterns in questions and views                                       |
| 9   | **Honey-Pot Proposer** | Generates decoy proposals when competitor probes are detected                                                   |
| 10  | **Autonomy Engine**    | 6 autonomy levels (CONSULTA → FULL) with KPI tracking and auto-degradation                                      |
| 11  | **Product Sync**       | Prepares Plasticov → Maustian listing sync proposals behind approval gates as one configured account boundary   |
| 12  | **Approval Queue**     | Every write action goes through prepare → approve → execute → audit                                             |
| 13  | **ML Business Tools**  | 10 tools for real MercadoLibre data (listings, fees, visits, orders, ads, paused detection, quality, relist, images) |
| 14  | **Background Ingestion** | 6h worker that snapshots ALL listings/visits/orders into Cortex, detects anomalies, cross-account comparison    |
| 15  | **Seasonal Detection** | Analyzes 2+ years of order history to detect seasonal patterns per category, 30-day advance alerts               |
| 16  | **Cross-Account Intelligence** | Compares Plasticov vs Maustian performance, detects gaps, suggests sync opportunities                    |
| 17  | **Proactive Alerts**   | Push notifications for visit anomalies, paused listing reuse, seasonal preparation, cross-account gaps           |
| 18  | **DeepSeek Inference** | Daily business intelligence: feeds Cortex data to DeepSeek for insight generation                               |
| 19  | **Actionable Proposals** | prepare_action with 10 action kinds, data-driven proposals with estimated profit impact                       |
| 20  | **Listing Quality**   | Audits listing score (0-100) via /performance API, surfaces OPPORTUNITY/WARNING rules by variable              |
| 21  | **Relist Intelligence** | Detects closed/paused listings eligible for relist (<60 days), preserves visits/questions/sales history         |
| 22  | **Image Pipeline**    | Pre-publish image diagnostic (white_background, text_logo, watermark) + upload to ML CDN via API                |

## Stack

| Layer        | Technology                                   | Why                                                       |
| ------------ | -------------------------------------------- | --------------------------------------------------------- |
| **Runtime**  | Node.js 22 + TypeScript 5.8                  | Strict mode, composite project references                 |
| **LLM**      | DeepSeek v4 Flash/Pro                        | 1M context window, ~98% cache discount, OpenAI-compatible |
| **Memory**   | SQLite (better-sqlite3) + recursive CTEs     | Zero external services, ~400 lines TS                     |
| **Web UI**   | Next.js 15 + React 19                        | Demo console for deterministic agent interaction          |
| **Bot**      | Telegram (grammY, proactive messaging) | Natural language interface, no UI needed                  |
| **Protocol** | MCP (`@modelcontextprotocol/sdk`)            | Stubbed project tool surface for compatible clients       |
| **Testing**  | Vitest (unit/integration) + Playwright (E2E) | 870+ tests, guarded platform support                        |
| **Quality**  | ESLint + Prettier + tsc strict               | No warnings, no untyped code                              |

## Philosophy

**1. No commands — natural language only.** The seller never sees a menu, never types a command, never learns a syntax. They say what they want in Spanish and the agent infers intent. Commands are fragile. Conversation is robust.

**2. Safety gates are invisible infrastructure, not the product.** The seller never thinks about guardrails, approval queues, or audit trails. They just say "dale" when they agree. Everything else happens automatically behind the scenes.

**3. Organic growth: cell → tissue → organ → organism.** Start with ONE agent, ONE memory system, ONE LLM. No plugin architectures, no multi-backend complexity, no premature framework scaffolding. Each new capability (actors, probes, autonomy) grows from the previous stable core.

**4. Profit maximization is the ONLY KPI.** Every tool, every insight, every proposal serves one goal: more net profit for the seller. The agent doesn't optimize for clicks, views, or sales volume — only for utilidad neta. Data infra exists to surface the highest-margin opportunities first.

## What the old El Sindicato projects taught us

| Failed pattern                          | What we learned                                |
| --------------------------------------- | ---------------------------------------------- |
| 44 tools + 6 plugins before stable core | Start with ONE thing that works                |
| EventBus as central hub (MeliManager)   | Hexagonal domain is the only durable core      |
| 11 LLM backends with ModelRouter        | Commit to ONE model, swap later if needed      |
| Features before safety                  | Safety gates are non-negotiable infrastructure |

## Verification

```bash
npm test              # 870+ Vitest tests in 38 files (unit + integration)
npm run test:e2e      # Playwright E2E (auto-skipped on unsupported platforms)
npm run typecheck     # TypeScript strict mode — zero tolerance
npm run lint          # ESLint with typed rules
npm run format:check  # Prettier — consistent style
npm run build         # Full workspace build
```

> **Note:** E2E tests use `scripts/run-e2e.mjs` which auto-skips with a friendly message on platforms without Playwright browser support (e.g., Android/Termux).
