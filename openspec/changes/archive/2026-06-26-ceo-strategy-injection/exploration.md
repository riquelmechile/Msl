# Exploration: CEO Strategy Injection via Natural Language (Phase 3)

## Current State

The conversational agent (Phase 2) operates with a fixed, hardcoded system prompt and a 3-block
cache strategy. There is NO path for the CEO/owner to inject business strategies that systematically
alter agent behavior. The system learns from interactions via Cortex (Hebbian + spreading activation),
but only second-order — it can't accept explicit strategic directives.

### Key components and their current role

| Component | What it does now | Strategy injection gap |
|-----------|-----------------|----------------------|
| `systemPrompt.ts` | `buildSystemPrompt(sellerName)` — produces ~5K token Block A with 7 hard rules | No strategy parameter; identity is static |
| `agentLoop.ts` | `createAgentLoop(config)` — takes a single `systemPrompt` string, runs conv loop | No mechanism to refresh or inject strategies mid-session |
| `cacheBlocks.ts` | `assembleMessages(blockA, blockB, blockC, …)` — 3-block prefix-anchored cache | Block A is immutable after construction; Block C is per-query only |
| `guardrails.ts` | `spanishValidator`, `harmfulContentFilter`, `actionSafetyValidator` | No strategy-aware validation |
| `types.ts` | `ConversationState`, `AgentProposal`, `ConversationMessage` | No strategy-related types |
| Cortex (`engine.ts`) | Graph nodes with labels + metadata JSON, edges with weights + co-occurrence, Hebbian reinforcement, Darwinian pruning, spreading activation | Capable of storing strategy nodes, but no strategy-specific API or schema |

### Architecture: 3-block cache strategy

```
Token 0
 ├── Block A: System prompt + business identity (~5K, eternal)
 ├── Block B: Daily aggregates (~15K, 24h refresh)
 │   ... conversation history ...
 └── Block C: Query-specific Cortex injection (variable)
```

Because DeepSeek anchors its prefix cache at token 0, Block A+B must be IDENTICAL across all
conversations for the same seller to achieve >90% cache hit rate. If the CEO changes a strategy,
the cache is invalidated — a one-time cost spike that must be documented as acceptable.

## Affected Areas

- **`packages/agent/src/conversation/systemPrompt.ts`** — must accept strategies and render them into Block A
- **`packages/agent/src/conversation/agentLoop.ts`** — `AgentLoopConfig` must carry strategies; `buildMessages` must include them
- **`packages/agent/src/conversation/cacheBlocks.ts`** — `assembleMessages` must receive strategy-augmented Block A
- **`packages/agent/src/conversation/types.ts`** — new types: `BusinessStrategy`, `StrategyRule`, `StrategyInjection`
- **`packages/agent/src/conversation/guardrails.ts`** — new guardrail: `strategyValidator(proposal, strategies)` that validates proposals against active strategies
- **`packages/memory/src/cortex/engine.ts`** — optional: strategy-aware node creation helpers
- **New: strategy parser module** — `packages/agent/src/conversation/strategyParser.ts`
- **New: strategy store module** — strategy table + CRUD, or Cortex integration

## Strategy Rule Taxonomy

Based on the ROADMAP examples (`"apunto a 50%+ margen, priorizo +10 stock"`) and Plasticov/Maustian
business context, the following rule types emerge:

| Rule type | Example (Spanish) | Structured fields |
|-----------|-------------------|-------------------|
| **Margin** | "margen mínimo 50% en electrónica" | `target`, `category`, `comparator` (>=, <=) |
| **Stock priority** | "priorizo stock de +10 en productos estrella" | `threshold`, `product_filter` (star, high-rotation) |
| **Category focus** | "enfocate en Hogar y Muebles" | `categories` (include list) |
| **Category exclusion** | "no compitas en juguetes" | `categories` (exclude list) |
| **Pricing cap** | "precio máximo $50.000 en Herramientas" | `max_price`, `category` |
| **Pricing floor** | "precio mínimo $5.000" | `min_price`, `category` (optional) |
| **Competitive** | "igualá precio del competidor X" | `competitor_id`, `action` (match, undercut, differentiate) |
| **Customer priority** | "respondé en menos de 2 horas" | `max_response_hours` |
| **Risk appetite** | "asumí más riesgo en categoría X" | `risk_tolerance` (low, medium, high), `category` |

A single CEO message can contain multiple rules (comma-separated or multi-sentence).

## Parsing Approaches

### Approach 1: Pattern-based extraction

Use curated regex/keyword patterns for each rule type.

```
Examples:
  /margen\s*(m[ií]nimo|objetivo|>|<|>=|<=|=)?\s*(\d+)%?\s*(?:en\s+)?(.+)?/i
  /prioriz\w*\s*\+\s*(\d+)\s*(?:stock|unidades|productos)/i
  /no\s+compit\w*\s+en\s+(.+)/i
  /enfoc\w*\s+en\s+(.+)/i
```

- **Pros**: Zero cost, instant, deterministic, no API dependency
- **Cons**: Brittle — misses novel phrasings, requires ongoing pattern maintenance, hard to handle negation ("no me importa el margen, priorizá rotación")
- **Effort**: Medium-Low

### Approach 2: LLM-based extraction (DeepSeek)

Send the strategy text to DeepSeek with a structured extraction prompt using JSON mode or function calling.

```typescript
// Prompt template (simplified)
"Extraé reglas de negocio estructuradas del siguiente texto: \"${ceoText}\".
 Reglas posibles: margin, stock_priority, category_focus, category_exclusion,
 pricing, competitive, customer_priority, risk_appetite.
 Respondé en JSON: { rules: Array<{ type, params }> }"
```

- **Pros**: Flexible — handles any phrasing, understands Spanish naturally, handles multi-rule extraction, adapts to novel rule types
- **Cons**: ~$0.0001-0.0005 per parse, ~500ms latency, requires validation of LLM output, needs API key available
- **Effort**: Low

### Approach 3: Hybrid (recommended)

Fast pattern pass for 80% of common phrasings → confidence score → fallback to LLM for ambiguous/complex text.

```
parseStrategy(text):
  1. Run regex patterns → partial_rules[], unmatched_snippets[]
  2. If unmatched_snippets is non-empty → send to LLM for completion
  3. Merge, deduplicate, validate
  4. Return StrategyInjection { rules, confidence, source: "pattern"|"llm"|"hybrid" }
```

- **Pros**: Low cost on common cases, flexible on edge cases, debuggable (patterns are transparent)
- **Cons**: Two code paths, needs confidence scoring logic
- **Effort**: Medium

## Storage Approaches

### Approach A: Dedicated `business_strategies` table (SQLite)

New table in the Cortex database (or a separate SQLite file):

```sql
CREATE TABLE business_strategies (
  id INTEGER PRIMARY KEY,
  raw_text TEXT NOT NULL,
  parsed_rules JSON NOT NULL,      -- Array<StrategyRule> as JSON
  confidence REAL DEFAULT 1.0,      -- Parser confidence
  source TEXT DEFAULT 'ceo-input',  -- 'ceo-input' | 'manual' | 'learned'
  active INTEGER DEFAULT 1,         -- Boolean: active/inactive
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  replaced_by INTEGER REFERENCES business_strategies(id)
);
```

- **Pros**: Clean separation of concerns, trivial CRUD, inspectable via SQL, easy lifecycle management (activate/deactivate/supersede), predictable query performance
- **Cons**: Not integrated with Cortex's Hebbian learning model; requires separate migration and maintenance
- **Effort**: Low

### Approach B: Cortex nodes only

Store each strategy as a Cortex `GraphNode` with `metadata: { type: "strategy", rule_type, params }`.
Edge-connect strategies to relevant category/product nodes. Use Hebbian reinforcement when strategy
adherence correlates with good outcomes.

- **Pros**: Unified memory model, natural decay/pruning (Darwinian), query-relevant activation (spreading activation from strategy nodes)
- **Cons**: Strategies are directives, not learned associations — Hebbian learning doesn't fit naturally; harder to inspect (no flat table view); lifecycle management (activate/deactivate) is awkward in graph model
- **Effort**: Medium

### Approach C: Hybrid storage (recommended)

- **`business_strategies` table** for explicit CEO directives — the source of truth for what strategies are active
- **Cortex nodes** for second-order learning — when a strategy correlates with improved outcomes, reinforce strategy→outcome edges; when it correlates with bad outcomes, penalize
- At prompt assembly time: query active strategies from the table → inject into Block A; Cortex nodes surface via Block C as before

```
CEO types "margen 50% en electrónica"
  → Parser extracts: { type: margin, target: 50, category: "electrónica" }
  → Store in business_strategies table (id=1, active=1)
  → Optionally create Cortex node: label="estrategia_margen_50_electronica", metadata={...}
  → Block A now includes: "## Estrategia del CEO\n- Margen objetivo ≥50% en categoría Electrónica"
  → Over time: Cortex learns edge "estrategia_margen_50_electronica" → "resultado_margen_real_47%"
  → Darwinian pruning removes weak strategy edges naturally
```

- **Pros**: Best of both — strategies are inspectable + managed via table; learning is graph-based
- **Cons**: Two storage systems; need sync logic between table state and Cortex nodes
- **Effort**: Medium

## Injection Point Analysis

### Block A (system prompt) — PRIMARY injection point

CEO strategies become part of the seller's business identity, alongside the 7 hard rules.

```
buildSystemPrompt(sellerName, strategies) → Block A with:
  ## Identidad del negocio (existing)
  ## Tu rol (existing)
  ## Estrategia del CEO (NEW)
    - Margen objetivo ≥50% en categoría Electrónica
    - Priorizar stock ≥10 en productos estrella
    - No competir en juguetes
  ## Reglas estrictas (existing)
```

- **Why Block A**: Strategies are business identity, not per-query context. They should anchor the prefix cache alongside the hard rules. The LLM needs them on EVERY turn to make strategy-aligned decisions.
- **Cache impact**: Strategy changes invalidate the prefix cache → one-time cost spike (~$0.005 for Block A regeneration). Acceptable given strategy changes are infrequent (CEO sets them, not per-message).

### Guardrails — SECONDARY injection point

`strategyValidator(proposal, strategies)` validates `AgentProposal` objects against active strategies:

```typescript
// Example: if strategy says "no competir en juguetes"
// and proposal targets a listing in category "Juguetes"
// → passed: false, reason: "Acción bloqueada por estrategia: no competir en juguetes"
```

- **Why guardrails**: Strategies are also constraints. The LLM may occasionally propose actions that violate a strategy (especially with temperature > 0). Guardrails catch these before the seller sees them.

### NOT recommended: Block C (per-query)

Strategies aren't query-specific context. Injecting them per-query wastes token budget and breaks the prefix cache optimization. Block C is for Cortex nodes relevant to the CURRENT query, not persistent directives.

### NOT recommended: Tool-based lookup

Having the agent call a `lookup_strategies` tool adds latency, API cost, and complexity. Strategies should be ambient — always present in the system prompt, not something the agent has to "remember to look up."

## Integration with Existing Components

| Component | Change |
|-----------|--------|
| `systemPrompt.ts` | `buildSystemPrompt(sellerName, strategies?: StrategyInjection)` — appends `## Estrategia del CEO` section when strategies exist |
| `agentLoop.ts` | `AgentLoopConfig` gains optional `strategies` field; if strategies change mid-session, new agent loop instance is created |
| `cacheBlocks.ts` | `assembleMessages` receives strategy-augmented Block A (no internal change needed — it just concatenates whatever Block A it's given) |
| `guardrails.ts` | New `strategyValidator(proposal, strategies): GuardResult` — validates proposals against active strategy rules |
| `types.ts` | New types: `StrategyRuleKind`, `StrategyRule`, `StrategyInjection`, `ParseResult` |
| Cortex | Optional: strategy node creation for learning; `GraphEngine` gets helper `createStrategyNode()` |

## Recommendation

### Hybrid parsing + hybrid storage + Block A injection

1. **Parse**: Regex patterns for common structures, LLM fallback for complex/ambiguous text. Store parser confidence.
2. **Store**: `business_strategies` table for explicit directives (source of truth). Cortex nodes for second-order learning (strategy outcomes).
3. **Inject**: Block A system prompt (strategy as identity). Guardrails (strategy as constraint).
4. **Lifecycle**: CEO can update strategies conversationally ("cambiá el margen a 45%") → re-parse → update table → regenerate Block A → invalidate cache (acceptable infrequent cost).
5. **Deactivation**: `active=0` flag, `replaced_by` foreign key for audit trail.

### Justification

- **Why hybrid parsing**: The CEO writes in natural Spanish with varied phrasing. Pure regex will miss things and frustrate the CEO. Pure LLM wastes money on simple cases ("margen 50%" is trivial to regex). Hybrid gives fast+cheap for 80%, flexible for the rest.
- **Why SQLite table for strategies**: Strategies are explicit, inspectable directives with a lifecycle (activate, deactivate, supersede). This maps naturally to a relational table with status flags. Cortex is better for learned associations, not declared directives.
- **Why Block A**: Strategies ARE business identity. They should be present on every LLM turn alongside the hard rules. Block A is the architecturally correct place for identity-level directives.

## Risks

1. **Cache invalidation cost**: Strategy changes invalidate DeepSeek's prefix cache. ~$0.005 one-time cost per change. Mitigation: strategies should change infrequently (CEO sets them, not per-session). Document this as known cost.
2. **Conflicting strategies**: "Margen 50% en electrónica" + "Igualá precio de competidor X en electrónica" — resolution logic needed. Mitigation: strategies carry priority/ordering; later strategies override earlier ones; LLM in system prompt can reconcile with natural reasoning.
3. **Parser brittleness with creative Spanish**: CEO may use slang, typos, or mixed language. Mitigation: LLM fallback handles this; pattern confidence scoring rejects low-confidence matches.
4. **Strategy-LLM disconnect**: The LLM may ignore or misinterpret strategies in the system prompt (LLMs are stochastic). Mitigation: guardrails catch violations before they reach the seller; prompt engineering reinforces strategy adherence.
5. **No API key available (local testing)**: LLM-based parsing requires `DEEPSEEK_API_KEY`. Mitigation: pattern parser works standalone; LLM fallback skips gracefully when no key is available, logging a warning.

## Ready for Proposal

**Yes.** The exploration has identified two viable approaches for each concern (parsing, storage, injection), a clear recommendation with tradeoff justification, and documented risks. The next phase should produce a concrete proposal with scope, out-of-scope items, and a rollback plan.

### What the orchestrator should tell the user

The exploration found that CEO strategy injection is architecturally sound with the existing 3-block cache strategy. The primary injection point is Block A (system prompt identity), backed by guardrail constraints. The recommended approach is hybrid: regex parsing for common patterns with LLM fallback for ambiguity, a dedicated SQLite table for strategy storage, and Cortex for second-order learning from strategy outcomes. Cache invalidation on strategy change is an acceptable one-time cost given strategies change infrequently. Ready to move to proposal.
