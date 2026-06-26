# Philosophy — MSL AI Agent

> **Lead with the answer:** MSL was built to fail differently than everything before it. Every architectural decision is a reaction to something that broke. None of it is theoretical. This document distills the principles that emerged from building and breaking MercadoLibre automation tools over multiple iterations.

---

## The cognitive profile

The agent was designed to match a specific cognitive profile — one that the original project documents called "TEA functional" (high-functioning pattern recognition, focus, distrust in authority):

| Trait                   | How MSL uses it                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Pattern recognition** | Probe detection, strategy intent parsing, anomaly detection in competitor behavior — all use pattern matching before LLM calls |
| **Systemizing**         | Every business domain is modeled as typed data, not free-text; every action has structured exact changes                       |
| **Calibrated distrust** | The agent never trusts its own output — `selfVerify()` runs 6 checks on every proposal before the user sees it                 |
| **Detail focus**        | Typed audit trails, CI gates, and exact changes (not "adjust price" but `{field: "price", from: 15000, to: 13500}`)            |
| **Routine adherence**   | The agent loop always follows the same 10-step sequence; no branching, no exceptions                                           |

---

## Cell → Tissue → Organ → Organism

The growth model is biological, not architectural. Each phase adds capability to an already-working core — nothing is bolted on from scratch.

```
CELL              TISSUE              ORGAN               ORGANISM
────              ──────              ─────               ────────
Phase 0          Phase 1-2           Phase 3-4            Phase 5-7
┌──────────┐    ┌────────────┐      ┌──────────────┐    ┌─────────────────┐
│ Domain    │    │ Domain      │      │ Domain        │    │ Domain           │
│ (types)   │    │ Memory      │      │ Memory        │    │ Memory            │
│           │    │ Agent       │      │ Agent         │    │ Agent (autonomy)   │
│           │    │             │      │ Strategy CRUD  │    │ Tools (real API)   │
│           │    │             │      │ Actor Models   │    │ Workers            │
│           │    │             │      │                │    │ MCP                │
│           │    │             │      │                │    │ Bot                │
└──────────┘    └────────────┘      └──────────────┘    └─────────────────┘
```

**The rule:** A new phase starts only when the previous phase has 100% passing tests and a documented stable API. No parallel work. No speculative features. Every new capability **grows from** the previous stable core — it does not replace it.

---

## Why no commands

Commands are fragile. They require the user to learn a syntax, remember parameter order, and tolerate cryptic error messages. They also create tight coupling between the UI and the backend — every new feature needs new command parsing, new validation, new error handling.

**Natural language is the only durable interface.** The seller says "bajá el precio del listing MLC1001 un 10% porque no vende" and the agent:

1. Infers intent: price change
2. Identifies target: MLC1001
3. Calculates change: 15,000 → 13,500 CLP
4. Prepares action with exact changes
5. Waits for "dale" confirmation

No menu. No form. No command syntax. The same sentence works today and in 3 years when 20 new capabilities exist.

This is not a UX preference. It's a **durability constraint** — the interface must survive capability explosion without refactoring.

---

## Why Cortex over vector DBs

Vector databases (pgvector, Pinecone, Chroma) are the default choice for AI memory in 2026. MSL chose SQLite + recursive CTEs instead. Here's why:

| Concern                   | Vector DB approach                      | Cortex approach                                                    |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| **External dependency**   | PostgreSQL, Pinecone API, Chroma server | Single SQLite file in-process                                      |
| **Schema flexibility**    | Fixed embedding dimensions              | Arbitrary metadata JSON per node                                   |
| **Relationship modeling** | Cosine similarity only                  | Weighted directed edges with co-occurrence counts and lifecycles   |
| **Learning**              | None (static embeddings)                | Hebbian (reinforce on use, penalize on rejection)                  |
| **Forgetting**            | Manual deletion only                    | Darwinian pruning: unused edges → distilled lessons → then removed |
| **Context injection**     | Top-K similarity search                 | Spreading activation traversal with decay                          |
| **Code complexity**       | ~50 lines (SDK call)                    | ~400 lines TypeScript                                              |
| **Operational cost**      | External service billing                | Zero — runs in the same Node.js process                            |

**The key insight:** An AI agent for a business doesn't need semantic search across millions of documents. It needs a **relationship graph** that strengthens connections that work and prunes connections that don't. SQLite + recursive CTEs give you that in 400 lines without a single external service.

Cortex models the agent's world as concept nodes connected by weighted edges. When a price-change proposal is confirmed ("dale"), the edge between `proposal_price_change` and `CEO_decision` strengthens. When a guardrail blocks a proposal, the edge between that concept and `guardrail_rejection` weakens. This is **real learning** — not just "what documents are similar to this query."

---

## Why DeepSeek over GPT

| Factor                          | GPT-4o        | DeepSeek v4                                                     |
| ------------------------------- | ------------- | --------------------------------------------------------------- |
| **Context window**              | 128K          | 1M                                                              |
| **Cache discount**              | 50%           | ~98%                                                            |
| **Cost per 1M tokens (cached)** | ~$1.25        | ~$0.014                                                         |
| **API compatibility**           | OpenAI native | OpenAI-compatible (`baseURL`)                                   |
| **Spanish quality**             | Good          | Comparable (tested on MercadoLibre business domain)             |
| **Chinese alignment risk**      | N/A           | Evaluated. DeepSeek is a tool provider, not a strategy partner. |

The 3-block cache strategy makes DeepSeek ~98% cheaper because Block A (system prompt, 5K tokens) is placed at position 0 and never changes. DeepSeek's prefix cache anchors on it across all conversations for the same seller. Block B (daily aggregates, 15K) refreshes once every 24 hours. Block C (query-specific, 0.3-2K) is the only per-message cost.

At ~$0.0003 per message, the agent can handle thousands of daily conversations for less than a dollar.

---

## The "Escribano" concept

The Escribano (scribe) is a zero-cost observer that runs after every conversation turn. It watches what happens and autonomously updates Cortex:

```
Conversation turn completes
        │
        ▼
┌─────────────────────────────────────┐
│           ESCRIBANO                  │
│                                     │
│  IF proposal confirmed ("dale")     │
│    → reinforce edge weight (+1)     │
│                                     │
│  IF guardrail blocked (⛔)           │
│    → penalize edge weight (-0.5)    │
│                                     │
│  IF user mentioned strategy domain  │
│    → increment co-occurrence count  │
│                                     │
│  IF actor simulation was consulted  │
│    → reinforce actor-concept edge   │
│                                     │
│  EVERY 10 turns                     │
│    → Darwinian pruning pass         │
└─────────────────────────────────────┘
```

The Escribano has no API cost, no external dependency, and runs synchronously in the same Node.js process. It's the bridge between conversation and persistent memory — the agent doesn't "decide" to learn; learning **just happens** as a side effect of every interaction.

---

## What failed before and why

The El Sindicato ecosystem was a collection of MercadoLibre automation projects that taught hard lessons:

### MeliManager — EventBus as central hub

```
❌ FAILED PATTERN:
  ┌──────────┐   ┌──────────┐   ┌──────────┐
  │ Plugin A │   │ Plugin B │   │ Plugin C │
  └────┬─────┘   └────┬─────┘   └────┬─────┘
       │              │              │
       └──────────────┼──────────────┘
                      │
              ┌───────┴───────┐
              │   EventBus    │  ← Single point of failure
              └───────────────┘
```

**Why it failed:** When the bus goes down, everything goes down. When two plugins disagree on event format, the whole system breaks. The bus became the bottleneck — every new feature had to negotiate with every existing plugin.

**MSL's answer:** Hexagonal domain. The domain package has zero I/O and defines contracts. Packages depend on the domain, not on each other. No event bus. No plugin registry. Direct function calls between packages that need to communicate.

### ModelRouter — 11 LLM backends

**Why it failed:** Supporting 11 models meant 11 different prompt formats, 11 different tokenizers, 11 different failure modes. The router spent more code on model selection than on business logic.

**MSL's answer:** Commit to ONE model (DeepSeek) through ONE SDK (OpenAI). If DeepSeek becomes unavailable, changing `baseURL` and `model` is a one-line change. The abstraction is the SDK, not a custom router.

### Feature explosion before stable core

**Why it failed:** 44 tools and 6 plugins were built before a single end-to-end flow worked. Testing was impossible because no two components agreed on contract format. Every new feature broke existing integrations.

**MSL's answer:** Phase 0 is ONLY the domain layer and safety gates. No LLM, no memory, no tools. Just types and approval state machines with automated verification before any capability is added. Each phase adds exactly what's needed and nothing more.

---

## Summary: the principles

| #   | Principle                    | Rule                                                                                      |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | **Domain-first**             | Pure TypeScript domain layer with zero I/O. Everything else is an adapter.                |
| 2   | **Natural language only**    | No commands, no menus, no syntax. The interface is conversation.                          |
| 3   | **Organic growth**           | Cell → tissue → organ → organism. One capability at a time.                               |
| 4   | **Cortex over vectors**      | Graph relationships, not semantic similarity. Hebbian learning, not static embeddings.    |
| 5   | **Cache economics**          | 3-block prefix-anchored cache. Per-message cost: $0.0003.                                 |
| 6   | **Calibrated distrust**      | The agent verifies its own output. Never present unchecked proposals to the user.         |
| 7   | **Safety as infrastructure** | Guardrails, approval queues, and audit trails are invisible — never the product.          |
| 8   | **Escribano learning**       | Memory updates happen automatically as a side effect of conversation. Zero API cost.      |
| 9   | **Fail forward**             | Every architecture decision is a reaction to something that broke. Learn, don't abstract. |
