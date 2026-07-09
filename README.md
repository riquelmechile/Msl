<p align="center">
  <h1 align="center">MSL — Agent Enterprise for Commerce</h1>
  <p align="center">CEO-led AI agent workforce. MercadoLibre operating intelligence with neural memory, autonomous daemons, and approval-gated execution. Natural language. Controlled autonomy. Revenue-driven.</p>
</p>

<p align="center">
  <a href="https://github.com/riquelmechile/Msl/actions"><img src="https://github.com/riquelmechile/Msl/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
  <img src="https://img.shields.io/badge/typescript-5.8-blue" alt="TypeScript 5.8">
  <img src="https://img.shields.io/badge/node-%E2%89%A522-green" alt="Node ≥22">
  <img src="https://img.shields.io/badge/llm-DeepSeek%20v4-purple" alt="DeepSeek v4">
  <img src="https://img.shields.io/badge/media-MiniMax-orange" alt="MiniMax">
  <img src="https://img.shields.io/badge/tests-1844%20passing-brightgreen" alt="1844 tests">
</p>

---

## What it does

MSL is a **proactive conversational AI agent** for MercadoLibre Chile that:

- Ingests your business data (listings, orders, ads, pricing, claims, reputation) into a **local SQLite operational read model**
- Runs a **neural graph memory (Cortex)** with Hebbian learning and Darwinian pruning
- Coordinates **12 autonomous specialist daemons** powered by DeepSeek v4
- Generates **AI-powered creative content** via MiniMax (images, video clips)
- Bridges **supplier data → Cortex → owned ecommerce** for niche storefront discovery
- Proposes **concrete profit-maximizing actions** — every action requires your explicit "dale" before execution

**Business context:** Plasticov and Maustian are separate MercadoLibre Chile seller accounts used as parallel commercial channels with independent pricing, listing types, and exposure strategies.

Read the full vision: [`docs/agent-enterprise-vision.md`](docs/agent-enterprise-vision.md).

---

## Quick start

```bash
git clone https://github.com/riquelmechile/Msl.git
cd Msl
cp .env.example .env.local   # edit with your keys
npm install
npm test                      # 1844 tests
npm run dev                   # http://127.0.0.1:3000
```

> **Safe by default.** The Next.js `/api/chat` and Telegram bot use local/mock behavior until you configure environment variables. Every mutation requires explicit CEO approval.

---

## Packages

| Package                 | Role                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `@msl/agent`            | CEO agent loop, DeepSeek reasoning, 12 daemons, tools, conversation engine             |
| `@msl/memory`           | Cortex neural graph (SQLite + recursive CTEs), operational read model, supplier bridge |
| `@msl/mercadolibre`     | ML API client (OAuth), normalization, sync engine, product ads                         |
| `@msl/creative-studio`  | AI content generation via MiniMax — images, video, policy engine, cost ledger          |
| `@msl/workers`          | Background ingestion, creative sync, insights, supplier mirror, owned ecommerce        |
| `@msl/ecommerce-medusa` | Medusa write boundary, storefront projections, preview adapter                         |
| `@msl/bot`              | Telegram bot (grammY), proactive alerts, multi-seller                                  |
| `@msl/mcp`              | MCP server — 40 tools for listings, prices, orders, claims, sync, workforce            |
| `@msl/tools`            | Approval queue, audit trail, risk gates, execution                                     |
| `@msl/domain`           | Pure TypeScript hexagonal core — no I/O, no DB                                         |
| `apps/web`              | Next.js 15 + React 19 web console and `/storefront` previews                           |

---

## Autonomous daemons (12)

12 specialist agents run on 15-minute cycles through the Agent Message Bus. They **read only** — every proposed action waits for CEO approval.

| Daemon                          | Lane                          | Responsibility                                                   |
| ------------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `marketCatalogDaemon`           | market-catalog                | Listing visibility, relist candidates, category medians          |
| `operationsManagerDaemon`       | operations-manager            | Claims, reputation, order issues                                 |
| `costSupplierDaemon`            | cost-supplier                 | Margin analysis, restock signals, cost alerts                    |
| `creativeAssetsDaemon`          | creative-assets               | Image count/quality, moderation status, remediation proposals    |
| `creativeCommercialDaemon`      | creative-commercial           | High-visit low-conversion, social-pack generation requests       |
| `creativeStudioDaemon`          | creative-studio               | MiniMax image/video job processing, policy-gated, human-approved |
| `productAdsMonitorDaemon`       | product-ads-monitor           | Campaign performance anomalies, budget alerts                    |
| `productAdsProfitabilityDaemon` | product-ads-profitability     | ROAS analysis, campaign optimization proposals                   |
| `ceoProfitabilityHandler`       | product-ads-ceo-profitability | CFO-lane profit analysis with DeepSeek enrichment                |
| `supplierManagerDaemon`         | supplier-manager              | Supplier mirror stock/pricing signals, target proposals          |
| `morningReportDaemon`           | morning-report                | Daily business summary with priorities                           |
| `eodSummaryDaemon`              | eod-summary                   | End-of-day recap, learning capture                               |

---

## Agent architecture

```
CEO (Telegram) ──→ @msl/agent (DeepSeek v4)
                    ├── Intent Engine · Guardrails (6 gates) · Actor Simulator
                    ├── 31 Business Tools · Background Ingestion
                    ├── Cache Strategy (3-block prefix-anchored, ~98% discount)
                    └── Agent Message Bus (claim → resolve → learn)
                         ├── 12 Autonomous Daemons (15-min cycles)
                         ├── Creative Studio (MiniMax image/video)
                         └── Supplier → Cortex → Owned Ecommerce Bridge

@msl/memory (Cortex)   @msl/mercadolibre (ML API)   @msl/creative-studio (MiniMax)
    ↓                           ↓                           ↓
@msl/domain (Hexagonal core — pure TypeScript, no I/O)
    ↓
@msl/bot (Telegram)  @msl/mcp (40 tools)  @msl/workers  @msl/ecommerce-medusa
```

---

## Stack

| Layer         | Technology                                                           | Why                                                 |
| ------------- | -------------------------------------------------------------------- | --------------------------------------------------- |
| **Runtime**   | Node.js 22 + TypeScript 5.8 (`strict`, `exactOptionalPropertyTypes`) | Maximum type safety                                 |
| **LLM**       | DeepSeek v4 Flash/Pro                                                | 1M context, ~98% cache discount, OpenAI-compatible  |
| **Media**     | MiniMax API                                                          | Image & video generation, policy-gated, cost-capped |
| **Memory**    | SQLite (better-sqlite3) + recursive CTEs                             | Zero external services                              |
| **Web**       | Next.js 15 + React 19                                                | Agent console + storefront projections              |
| **Bot**       | Telegram via grammY                                                  | Natural language, proactive alerts                  |
| **Ecommerce** | Medusa (write boundary)                                              | Owned storefront projections, approval-gated        |
| **Protocol**  | MCP (`@modelcontextprotocol/sdk`)                                    | 40 tools for AI clients                             |
| **Testing**   | Vitest + Playwright                                                  | 1844 unit/integration + 7 E2E                       |
| **Quality**   | ESLint + Prettier + `tsc --noEmit`                                   | 0 errors, 0 warnings                                |

---

## Verification

```bash
npm run typecheck     # TypeScript strict — 0 errors
npm run lint          # ESLint — 0 errors, 0 warnings
npm run format:check  # Prettier — consistent style
npm test              # 1844 tests pass
npm run test:e2e      # 7 Playwright E2E
npm run build         # Full workspace build
```

---

## Documentation

| Doc                                                                                                      | Content                                           |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [`docs/agent-enterprise-vision.md`](docs/agent-enterprise-vision.md)                                     | Canonical product vision and roadmap              |
| [`docs/creative-studio-minimax-integration.md`](docs/creative-studio-minimax-integration.md)             | Creative Studio architecture, MiniMax integration |
| [`docs/supplier-to-owned-ecommerce-cortex-bridge.md`](docs/supplier-to-owned-ecommerce-cortex-bridge.md) | Supplier → Cortex → Ecommerce bridge design       |
| [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md)                                                               | Engineering philosophy and principles             |
| [`docs/vps-deployment.md`](docs/vps-deployment.md)                                                       | VPS deployment guide (PM2)                        |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)                                                                     | System architecture overview                      |
| [`ROADMAP.md`](ROADMAP.md)                                                                               | Development roadmap                               |

---

## Environment

See [`.env.example`](.env.example) for the complete variable reference. Key groups:

| Group                         | Required                                               |
| ----------------------------- | ------------------------------------------------------ |
| `DEEPSEEK_API_KEY`            | Real LLM responses                                     |
| `BOT_TOKEN`                   | Telegram bot                                           |
| `MINIMAX_API_KEY`             | Creative Studio image/video generation                 |
| `MSL_CREATIVE_STUDIO_ENABLED` | Gate for creative-studio daemon                        |
| MercadoLibre OAuth            | ML API access (listings, orders, claims, ads, pricing) |
| Supplier Mirror               | Jinpeng bootstrap, supplier evidence                   |

---

## Philosophy

1. **Natural language, not commands.** No menus, no syntax. Spanish conversation only.
2. **Safety gates are invisible.** Approval queues, audit trails, risk gates — automatic, not UX.
3. **Organic growth.** Cell → tissue → organ → organism. One agent, one memory, one LLM first.
4. **Profit maximization is the only KPI.** Every tool and insight serves net profit.

MIT License. Built in Chile 🇨🇱.
