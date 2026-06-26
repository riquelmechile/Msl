<p align="center">
  <h1>MSL — Plasticov / Maustian AI Agent</h1>
  <p>Conversational AI agent for MercadoLibre Chile sellers. Natural language. No commands. Revenue-driven.</p>
</p>

<p align="center">
  <code>624 tests</code> ·
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
npm test          # 624 tests in ~9s
npm run dev       # http://127.0.0.1:3000
```

> **Verification:** `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` are all part of the quality gate suite.

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

| # | System | What it does |
|---|--------|--------------|
| 1 | **Agent Loop** | Orchestrates conversation turns: validate → cache → LLM → parse → gate |
| 2 | **Cortex Memory** | Neural graph (SQLite + recursive CTEs). Hebbian learning, Darwinian pruning |
| 3 | **Escribano** | Memory scribe that observes every turn and autonomously updates Cortex |
| 4 | **Guardrails** | 6 safety gates: Spanish-only, harmful content, action safety, strategy compliance, honey-pot TOS, autonomy gate |
| 5 | **Self-Verification** | Calibrated-distrust: the agent checks its own proposals before presenting them |
| 6 | **Strategy Parser** | Hybrid parser (regex fast-path → regex/rule matching) for CEO strategy injection |
| 7 | **Actor Simulator** | Simulates comprador, proveedor, and competidor mental models via LLM |
| 8 | **Probe Detection** | Detects competitor intelligence-gathering patterns in questions and views |
| 9 | **Honey-Pot Proposer** | Generates decoy proposals when competitor probes are detected |
| 10 | **Autonomy Engine** | 6 autonomy levels (CONSULTA → FULL) with KPI tracking and auto-degradation |
| 11 | **Product Sync** | Syncs listings from Plasticov to Maustian applying CEO pricing/stock/category strategies |
| 12 | **Approval Queue** | Every write action goes through prepare → approve → execute → audit |

## Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Runtime** | Node.js 22 + TypeScript 5.8 | Strict mode, composite project references |
| **LLM** | DeepSeek v4 Flash/Pro | 1M context window, ~98% cache discount, OpenAI-compatible |
| **Memory** | SQLite (better-sqlite3) + recursive CTEs | Zero external services, ~400 lines TS |
| **Web UI** | Next.js 15 + React 19 | Demo console for deterministic agent interaction |
| **Bot** | Telegram (stub) | Natural language interface, no UI needed |
| **Protocol** | MCP (`@modelcontextprotocol/sdk`) | Standard 2026 tool exposure, broad ecosystem |
| **Testing** | Vitest (unit/integration) + Playwright (E2E) | 624 tests, guarded platform support |
| **Quality** | ESLint + Prettier + tsc strict | No warnings, no untyped code |

## Philosophy

**1. No commands — natural language only.** The seller never sees a menu, never types a command, never learns a syntax. They say what they want in Spanish and the agent infers intent. Commands are fragile. Conversation is robust.

**2. Safety gates are invisible infrastructure, not the product.** The seller never thinks about guardrails, approval queues, or audit trails. They just say "dale" when they agree. Everything else happens automatically behind the scenes.

**3. Organic growth: cell → tissue → organ → organism.** Start with ONE agent, ONE memory system, ONE LLM. No plugin architectures, no multi-backend complexity, no premature framework scaffolding. Each new capability (actors, probes, autonomy) grows from the previous stable core.

## What the old El Sindicato projects taught us

| Failed pattern | What we learned |
|----------------|-----------------|
| 44 tools + 6 plugins before stable core | Start with ONE thing that works |
| EventBus as central hub (MeliManager) | Hexagonal domain is the only durable core |
| 11 LLM backends with ModelRouter | Commit to ONE model, swap later if needed |
| Features before safety | Safety gates are non-negotiable infrastructure |

## Verification

```bash
npm test              # 624 Vitest tests (unit + integration)
npm run test:e2e      # Playwright E2E (auto-skipped on unsupported platforms)
npm run typecheck     # TypeScript strict mode — zero tolerance
npm run lint          # ESLint with typed rules
npm run format:check  # Prettier — consistent style
npm run build         # Full workspace build
```

> **Note:** E2E tests use `scripts/run-e2e.mjs` which auto-skips with a friendly message on platforms without Playwright browser support (e.g., Android/Termux).
