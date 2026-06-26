<p align="center">
  <h1>MSL — Plasticov / Maustian AI Agent</h1>
  <p>Conversational AI agent for MercadoLibre Chile sellers. Natural language. No commands. Revenue-driven.</p>
</p>

<p align="center">
  <code>648 tests</code> ·
  <code>TypeScript 5.8</code> ·
  <code>Node ≥22</code> ·
  <code>DeepSeek v4</code> ·
  <code>MIT</code>
</p>

---

## What it does

MSL is an AI agent that **manages your MercadoLibre Chile business through natural conversation in Spanish**. No commands, no menus, no dashboards. You talk to it like a business partner.

It understands your intent, proposes concrete actions, simulates buyer/seller/competitor behavior, learns from every interaction via a neural graph memory (Cortex), and protects your business with invisible safety gates — every action requires your explicit "dale" before execution.

**Business context:** Plasticov (manufacturing) + Maustian (selling) — zero-stock arbitrage + physical inventory in Recoleta, Chile. 1,247 products, ~4,627 historical orders, $120M CLP/year.

## Quick start

```bash
git clone https://github.com/riquelmechile/Msl.git
cd Msl
npm install
npm test          # 648 tests in 32 files
npm run dev       # http://127.0.0.1:3000
```

> **Current demo boundary:** the Next.js `/api/chat` route is a deterministic demo path. It uses in-memory demo stores and `mockClient: true`; production chat persistence, auth, and real LLM wiring are still future work.

> **Verification:** the current checked gate is `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm test`. `npm run build` remains part of the intended release gate, but it was not verified in the latest cleanup pass because it writes build artifacts.

## Environment secrets

Secrets belong in local env files or deployment secret stores, never in Git.

```bash
cp .env.example .env.local
```

Then paste your real API keys/passwords into `.env.local`. If `.env.local` already exists, edit it directly instead of replacing it. Keep `.env.example` committed with blank placeholder values only.

Naming matters here: **MSL** is the project/app name; **ML** means MercadoLibre; **MLC** is the MercadoLibre Chile site code, not an account identity. The business flow is dual-account — Plasticov MercadoLibre account (source) → Maustian MercadoLibre account (target). MercadoLibre app credentials identify the developer application; seller accounts are connected through OAuth and stored per account, not committed as raw tokens.

- Never prefix private keys with `NEXT_PUBLIC_`; Next.js exposes those values to the browser bundle.
- Use GitHub Secrets for CI/deploy values instead of committing env files.
- `/api/chat`, MCP auth, token encryption, and sync/write account roles fail closed unless the required env vars are set or an explicit local/demo escape hatch is enabled (`MSL_ALLOW_UNAUTHENTICATED_LOCAL=true`, `MSL_ALLOW_INSECURE_DEV_SECRETS=true`).
- If a real secret is accidentally committed or pushed, rotate/revoke it immediately and remove it from history before trusting the repository again.

## Architecture

```
                 ┌──────────────────────────────────────┐
                 │            CEO (Telegram)             │
                 │   Natural language strategy injection │
                 │ "apunto a 50%+ margen, priorizo stock"│
                 └────────────────┬─────────────────────┘
                                  │
                                  ▼
 ┌────────────────────────────────────────────────────────────────┐
 │                      @msl/agent (DeepSeek)                      │
 │  ┌───────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
 │  │ Intent Engine  │  │ Guardrails   │  │  Actor Simulator     │ │
 │  │ (no commands)  │  │ (6 gates)    │  │  (comprador/vendor)  │ │
 │  └───────┬───────┘  └──────┬───────┘  └──────────┬───────────┘ │
 │          │                 │                      │             │
 │  ┌───────┴─────────────────┴──────────────────────┴───────────┐ │
 │  │              Cache Strategy (3-block prefix-anchored)       │ │
 │  │  A: System prompt (5K, eternal)  │ B: Aggregates (15K/24h) │ │
 │  │  C: Cortex context injection (per query, 0.3-2K)           │ │
 │  └─────────────────────────────────────────────────────────────┘ │
 └──────────┬───────────────┬───────────────┬───────────────────────┘
            │               │               │
            ▼               ▼               ▼
 ┌────────────────┐  ┌──────────────┐  ┌─────────────────────┐
 │  @msl/memory   │  │  @msl/tools  │  │  @msl/mercadolibre   │
 │  Cortex (SQLite)│  │  Approval Q  │  │  ML API (OAuth+HTP)  │
 │  · Hebbian      │  │  Audit trail │  │  · Product sync      │
 │  · CTE spread   │  │  Risk gates  │  │  · Orders/messages   │
 │  · Darwinian    │  │  Execute     │  │  · Reputation        │
 └────────┬───────┘  └──────┬───────┘  └──────────┬──────────┘
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
 ┌────────┐  ┌──────────┐  ┌──────────┐
 │@msl/bot│  │ @msl/mcp │  │@msl/     │
 │Telegram│  │ Stdio    │  │workers   │
 │stub    │  │ MCP srv  │  │Insights  │
 │        │  │6 tools   │  │Creative  │
 └────────┘  └──────────┘  │Sync jobs │
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
| 11  | **Product Sync**       | Syncs listings from Plasticov to Maustian applying CEO pricing/stock/category strategies                        |
| 12  | **Approval Queue**     | Every write action goes through prepare → approve → execute → audit                                             |

## Stack

| Layer        | Technology                                   | Why                                                       |
| ------------ | -------------------------------------------- | --------------------------------------------------------- |
| **Runtime**  | Node.js 22 + TypeScript 5.8                  | Strict mode, composite project references                 |
| **LLM**      | DeepSeek v4 Flash/Pro                        | 1M context window, ~98% cache discount, OpenAI-compatible |
| **Memory**   | SQLite (better-sqlite3) + recursive CTEs     | Zero external services, ~400 lines TS                     |
| **Web UI**   | Next.js 15 + React 19                        | Demo console for deterministic agent interaction          |
| **Bot**      | Telegram (stub)                              | Natural language interface, no UI needed                  |
| **Protocol** | MCP (`@modelcontextprotocol/sdk`)            | Stubbed project tool surface for compatible clients       |
| **Testing**  | Vitest (unit/integration) + Playwright (E2E) | 648 tests, guarded platform support                       |
| **Quality**  | ESLint + Prettier + tsc strict               | No warnings, no untyped code                              |

## Philosophy

**1. No commands — natural language only.** The seller never sees a menu, never types a command, never learns a syntax. They say what they want in Spanish and the agent infers intent. Commands are fragile. Conversation is robust.

**2. Safety gates are invisible infrastructure, not the product.** The seller never thinks about guardrails, approval queues, or audit trails. They just say "dale" when they agree. Everything else happens automatically behind the scenes.

**3. Organic growth: cell → tissue → organ → organism.** Start with ONE agent, ONE memory system, ONE LLM. No plugin architectures, no multi-backend complexity, no premature framework scaffolding. Each new capability (actors, probes, autonomy) grows from the previous stable core.

## What the old El Sindicato projects taught us

| Failed pattern                          | What we learned                                |
| --------------------------------------- | ---------------------------------------------- |
| 44 tools + 6 plugins before stable core | Start with ONE thing that works                |
| EventBus as central hub (MeliManager)   | Hexagonal domain is the only durable core      |
| 11 LLM backends with ModelRouter        | Commit to ONE model, swap later if needed      |
| Features before safety                  | Safety gates are non-negotiable infrastructure |

## Verification

```bash
npm test              # 648 Vitest tests in 32 files (unit + integration)
npm run test:e2e      # Playwright E2E (auto-skipped on unsupported platforms)
npm run typecheck     # TypeScript strict mode — zero tolerance
npm run lint          # ESLint with typed rules
npm run format:check  # Prettier — consistent style
npm run build         # Full workspace build
```

> **Note:** E2E tests use `scripts/run-e2e.mjs` which auto-skips with a friendly message on platforms without Playwright browser support (e.g., Android/Termux).
