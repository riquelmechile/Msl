# ROADMAP — Plasticov / Maustian AI Agent

## Project identity

A conversational AI agent for the Plasticov and Maustian MercadoLibre Chile seller accounts. The agent converses in natural Spanish, infers intent, simulates buyer/seller mental models, and learns from every interaction. No commands. No menus. Just conversation that drives revenue.

**Business:** Zero-stock arbitrage + physical inventory in Recoleta, Chile. 1,247 products, ~4,627 orders historical, $120M CLP/year. Dual-account flow: Plasticov MercadoLibre account is the source/manufacturer; Maustian MercadoLibre account is the target/seller. MLC is the site code, not either account identity.

## Current readiness boundary

| Area              | Status                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Safe setup        | Use `.env.local` for local secrets and GitHub Secrets/platform secrets for CI/deploy. Never use `NEXT_PUBLIC_` for private values and never paste raw seller tokens into docs or Git. |
| Auth/security     | `/api/chat`, MCP auth, encryption, and sync account-role checks fail closed unless an explicit local/demo/test opt-in is set.                                                         |
| Dual-account sync | Plasticov source → Maustian target on `MLC`; reverse or arbitrary seller IDs are rejected.                                                                                            |
| Web chat          | Demo-backed; production chat persistence, auth integration, and real LLM wiring remain future work.                                                                                   |
| MCP               | Stubbed compatible tool surface; production business-operation wiring remains future work.                                                                                            |
| CI                | Format, typecheck, lint, Vitest, build, and Playwright E2E gates run in CI.                                                                                                           |

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

| Block              | Content                                      | Size   | Refresh     | Cost     |
| ------------------ | -------------------------------------------- | ------ | ----------- | -------- |
| **A — Fixed**      | System prompt, business identity, hard rules | ~5K    | Never       | $0.00001 |
| **B — Aggregates** | Category stats, monthly volume, reputation   | ~15K   | Daily       | $0.004   |
| **C — Dynamic**    | Relevant nodes from Cortex (per query)       | 0.3-2K | Per message | $0.0003  |

## Architecture evolution

```
Phase 0         Phase 1         Phase 2         Phase 3         Phases 4-7
────────        ───────         ───────         ───────         ──────────
┌─────────┐    ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────────────┐
│ Domain   │───▶│ Domain   │────▶│ Domain   │────▶│ Domain   │────▶│ Domain           │
│ Approvals│    │ Memory   │     │ Memory   │     │ Memory   │     │ Memory            │
│ Audit    │    │ Approvals│     │ Agent    │     │ Agent    │     │ Agent (autonomy)   │
│ Demo UI  │    │ Audit    │     │ Guardrails│    │ Strategy │     │ Tools (real ML API)│
└─────────┘    │ Demo UI  │     │ Approvals │     │ Guardrails│    │ Workers            │
               └─────────┘     │ Audit     │     │ Approvals │    │ MCP                │
                               │ Demo UI   │     │ Audit     │    │ Bot                │
                               └─────────┘     │ Demo UI   │    └─────────────────┘
                                               └─────────┘
```

## Phases

| #     | What                                                  | Built with                                                                                                                                                                                                            | Key insight                                                                                                                                                                                                                                                                                      | Status                                                   |
| ----- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **0** | Hexagonal domain + deterministic agent + safety gates | `@msl/domain` (12 modules), `@msl/tools` (approval + audit pipeline), `apps/web` (Next.js demo console)                                                                                                               | Domain layer must be **pure TypeScript** — no framework, no I/O, no side effects. Every test runs in 0ms and never flakes.                                                                                                                                                                       | ✅ Done (main)                                           |
| **1** | **Cortex: neural graph memory**                       | `@msl/memory` (SQLite + Hebbian learning + recursive CTEs + Darwinian pruning), Corset engine types, actor profile nodes, probe records                                                                               | Recursive CTEs in SQLite can model **spreading activation** without a graph DB. Activation travels depth-first, decays per hop, and prune log records distilled lessons from dead edges.                                                                                                         | ✅ [#14](https://github.com/riquelmechile/Msl/issues/14) |
| **2** | **Conversational agent with DeepSeek**                | `@msl/agent` (agentLoop 1391 LOC, systemPrompt, guardrails, types, cacheBlocks), OpenAI SDK with DeepSeek baseURL                                                                                                     | A **3-block prefix-anchored cache** cuts DeepSeek costs by ~98%. Mock client with intent-based routing lets you test full conversation flows without an API key. Tool call loop handles simulate_actor, detect_probes, propose_honey_pot chains.                                                 | ✅                                                       |
| **3** | **CEO strategy injection via natural language**       | `@msl/agent/conversation/strategyParser.ts` (hybrid parser), `strategyStore.ts` (SQLite persistence), `guardrails.ts` (strategyValidator), `escribano.ts` (memory scribe)                                             | **80% of natural strategy commands** (list, update, archive) are intercepted by regex fast-path and handled locally — **zero LLM cost**. The remaining 20% fall through to the LLM for parsing.                                                                                                  | ✅                                                       |
| **4** | **Actor Models / Shadow Actors**                      | `@msl/agent/conversation/actorSimulator.ts` (comprador/proveedor/competidor prompts + LLM simulation), `@msl/memory/cortex/types.ts` (ActorProfileNode)                                                               | The LLM simulates mental models of buyers, suppliers, and competitors. The mock client detects actor-related Spanish phrases and chains tool calls. **Escribano** autonomously records actor consultations into Cortex.                                                                          | ✅                                                       |
| **5** | **Honey-Pot Probing**                                 | `@msl/agent/conversation/probeDetector.ts` (question/view anomaly detection), `honeyPotProposer.ts` (decoy generation), `guardrails.ts` (honeyPotValidator — TOS compliance)                                          | Decoy proposals are validated against **active CEO strategies** before presentation. The ToS validator ensures proposals never violate MercadoLibre terms. Confirmed proposals are persisted to Cortex via `GraphEngine.storeProbeResult`.                                                       | ✅                                                       |
| **6** | **Autonomy levels with KPIs and auto-degradation**    | `@msl/agent/conversation/autonomyEngine.ts` (6 levels: CONSULTA → FULL, KPI tracking, degradation rules), `guardrails.ts` (autonomyGate), `selfVerify.ts` (6 verification checks per proposal)                        | The agent **downgrades itself** when KPIs degrade (3 consecutive violations → level drop). Self-verification with blocking checks and warning checks creates **calibrated distrust** — the agent checks its own work before presenting it.                                                       | ✅                                                       |
| **7** | **Real ML API integration foundation**                | `@msl/mercadolibre` (MlClient with real HTTP transport + exponential backoff, OAuth manager with multi-account support, product sync engine with diff + strategy application), `@msl/mcp` (6 stubbed tools via stdio) | Real OAuth with refresh token support. HTTP transport has **exponential backoff** for 429/5xx. Sync engine diffs Plasticov → Maustian listings and applies CEO margin/stock/category/pricing strategies. MCP currently exposes a stubbed tool surface, not production business-operation wiring. | ✅ foundation                                            |

## Technology decisions

| Decision        | Choice                   | Rationale                                               |
| --------------- | ------------------------ | ------------------------------------------------------- |
| LLM             | DeepSeek v4 Flash/Pro    | 1M window, ~98% cache discount, OpenAI-compatible       |
| Memory          | SQLite + recursive CTEs  | Zero external services, ~400 lines TS, persistent       |
| Integration     | `openai` npm + `baseURL` | Zero new SDK, trivially swappable                       |
| Agent framework | None (custom agentLoop)  | No LangChain, no Mastra — direct API control            |
| Hosting         | Node.js 22 in-process    | No external DB servers needed for Cortex                |
| Protocol        | MCP for tool exposure    | Stubbed stdio server; production tool wiring TBD        |
| Testing         | Vitest + Playwright      | Unit/integration tests plus platform-guarded E2E runner |

## What the old El Sindicato projects taught us

- ❌ 44 tools + 6 plugins before stable core = failure
- ❌ EventBus (MeliManager) as central hub = bottleneck
- ❌ 11 LLM backends with ModelRouter = complexity explosion
- ✅ Start with ONE agent, ONE memory system, ONE LLM
- ✅ Grow organically: cell → tissue → organ → organism
- ✅ Safety gates are invisible infrastructure, not the product
