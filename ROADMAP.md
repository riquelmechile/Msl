# ROADMAP — Plasticov/Maustian AI Agent

## Project identity

A conversational AI agent for Plasticov (MercadoLibre Chile seller) and Maustian (service brand). The agent converses in natural Spanish, infers intent, simulates buyer/seller mental models, and learns from every interaction. No commands. No menus. Just conversation that drives revenue.

**Business:** Zero-stock arbitrage + physical inventory in Recoleta, Chile. 1,247 products, ~4,627 orders historical, $120M CLP/year. Double brand: Maustian sells, Plasticov manufactures.

## Architecture

```
┌──────────────────────────────────────────────┐
│            CEO (Telegram/Discord)            │
│     Natural language strategy injection       │
│  "apunto a 50%+ margen, priorizo +10 stock"  │
└──────────────────┬───────────────────────────┘
                   ▼
┌──────────────────────────────────────────────┐
│       AGENTE CONVERSACIONAL (DeepSeek)       │
│  • Infiere intención, no matchea comandos    │
│  • Simula comprador/proveedor (Actor Models) │
│  • Propone acciones, safety gates invisibles │
│  • Español natural, directo, comprimido      │
└────────┬─────────────────────────┬───────────┘
         │                         │
         ▼                         ▼
┌──────────────────┐    ┌──────────────────────┐
│   CORTEX (SQLite) │    │  SAFETY GATES        │
│   • Neural graph  │    │  • Approval queue    │
│   • Hebbian learn │    │  • Audit trail       │
│   • Darwinian poda│    │  • Risk validation   │
│   • Convergencia  │    │  • User says "dale"  │
│   • Context inj.  │    │    → executes         │
└────────┬─────────┘    └──────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────┐
│   DeepSeek API (3-block context cache)       │
│   A: System prompt + identity (5K, eternal)  │
│   B: Daily aggregates (15K, 24h refresh)     │
│   C: Query-specific injection (variable)     │
└──────────────────────────────────────────────┘
```

## DeepSeek cache strategy

Raw data is ~663K tokens. Full-cache is fragile (one listing change invalidates everything).

| Block | Content | Size | Refresh | Cost |
|-------|---------|------|---------|------|
| **A — Fixed** | System prompt, business identity, hard rules | ~5K | Never | $0.00001 |
| **B — Aggregates** | Category stats, monthly volume, reputation | ~15K | Daily | $0.004 |
| **C — Dynamic** | Relevant nodes from Cortex (per query) | 0.3-2K | Per message | $0.0003 |

## Phases

| # | What | Status |
|---|------|--------|
| **0** | Hexagonal domain + deterministic agent + safety gates | ✅ Done (main) |
| **1** | **Cortex: neural graph memory** (SQLite + Hebbian + CTE + Darwinian) | ✅ [#14](https://github.com/riquelmechile/Msl/issues/14) |
| 2 | Conversational agent with DeepSeek (natural language, no commands) | ✅ |
| 3 | CEO strategy injection via natural language | ✅ |
| 4 | Actor Models / Shadow Actors (buyer/seller simulation) | ✅ |
| 5 | Honey-Pot Probing (active counterintelligence) | ✅ |
| 6 | Autonomy levels with KPIs and auto-degradation | 🔲 |
| 7 | Real ML API integration (OAuth, live data extraction) | 🔲 |

## Technology decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LLM | DeepSeek v4 Flash/Pro | 1M window, ~98% cache discount, OpenAI-compatible |
| Memory | SQLite + recursive CTEs | Zero external services, ~400 lines TS, persistent |
| Integration | `openai` npm + `baseURL` | Zero new SDK, trivially swappable |
| Agent framework | TBD (OpenAI Agents SDK JS or Mastra) | Evaluate after Cortex is built |
| Hosting | Node.js 22 in-process | No external DB servers needed for Cortex |
| Protocol | MCP for tool exposure | Standard in 2026, broad ecosystem support |

## What the old El Sindicato projects taught us

- ❌ 44 tools + 6 plugins before stable core = failure
- ❌ EventBus (MeliManager) as central hub = bottleneck
- ❌ 11 LLM backends with ModelRouter = complexity explosion
- ✅ Start with ONE agent, ONE memory system, ONE LLM
- ✅ Grow organically: cell → tissue → organ → organism
- ✅ Safety gates are invisible infrastructure, not the product
