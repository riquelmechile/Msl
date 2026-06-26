# Design: CEO Strategy Injection

## Technical Approach

Hybrid parsing (regex fast-path → LLM fallback) extracts structured rules from natural Spanish. Strategies persist in a dedicated SQLite table with active/archived/superseded lifecycle. Block A system prompt injection makes strategies ambient on every LLM turn. `strategyValidator` guardrails catch LLM drift on output. Pattern rules handle ~80% of common phrasings at zero cost; unmatched snippets fall back to DeepSeek structured extraction.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|-----------|
| Storage | SQLite `ceo_strategies` table | Cortex graph nodes | Strategies are explicit directives with lifecycle — relational fits naturally. Cortex is for learned associations (Hebbian), not declared commands. |
| Parsing | Pattern-first regex, LLM fallback | Pure regex, pure LLM | Zero-cost instant parse for "margen 50%". Flexible fallback for creative Spanish. Works offline (no API key). |
| Injection | Block A (system prompt, token 0) | Block C, tool lookup | Strategies are business identity, not per-query context. Ambient on every turn. One-time cache miss (~$0.005) per change is acceptable. |
| Guardrail | `strategyValidator` blocks violations | LLM-only trust | LLM is stochastic (temperature >0). Guardrails catch drift before seller sees violations. |

## Data Flow

```
CEO: "margen 50% en electrónica"
  │
  ▼
strategyParser.parse()
  ├─ regex pass → { type: 'margin', target: 50, category: 'electrónica' }
  └─ (unmatched → LLM fallback)
  │
  ▼
strategyStore.insert(parsed) → ceo_strategies row (status='active')
  │
  ├─► buildSystemPrompt(seller, strategies)
  │     → Block A appends: "## Estrategia del CEO\n- [margen] Margen ≥50% en Electrónica"
  │
  └─► agentLoop.converse()
         └─ strategyValidator(proposal, strategies) ← blocks violating proposals
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/strategyParser.ts` | Create | Hybrid parser: regex patterns for 9 rule types, DeepSeek LLM fallback, confidence scoring |
| `packages/agent/src/conversation/strategyStore.ts` | Create | SQLite CRUD: insert, listActive, archive, update — follows `GraphEngine` pattern (accepts `Database`) |
| `packages/agent/src/conversation/systemPrompt.ts` | Modify | `buildSystemPrompt(sellerName, strategies?)` — appends `## Estrategia del CEO` when strategies exist |
| `packages/agent/src/conversation/guardrails.ts` | Modify | New `strategyValidator(proposal, strategies): GuardResult` |
| `packages/agent/src/conversation/types.ts` | Modify | New types: `StrategyRule`, `Strategy`, `ParseResult`, `StrategyRuleType` |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | `AgentLoopConfig` gains optional `strategies` field; `converse()` validates proposals against strategies |

## Interfaces / Contracts

```typescript
// types.ts — new types
type StrategyRuleType =
  | 'margin' | 'stock_priority' | 'category_focus' | 'category_exclusion'
  | 'pricing_cap' | 'pricing_floor' | 'competitive' | 'customer_priority' | 'risk_appetite';

type StrategyRule = {
  type: StrategyRuleType;
  target?: number;
  category?: string;
  comparator?: '>=' | '<=' | '=';
  categories?: string[];
  product_filter?: 'star' | 'high-rotation';
};

type Strategy = {
  id: number; rule_type: string;
  rule_text: string; parsed_rule: string; // JSON of StrategyRule
  confidence: number; status: 'active' | 'archived' | 'superseded';
};

type ParseResult = { rules: StrategyRule[]; unparsed: string[]; confidence: number; };

// guardrails.ts — new function
function strategyValidator(proposal: AgentProposal, strategies: Strategy[]): GuardResult;
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Parser: all 9 rule types, multi-rule extraction, confidence scoring, Spanish variations | Vitest with Spanish text fixtures |
| Unit | Store: CRUD lifecycle (insert→listActive→archive→supersede) | Vitest + in-memory SQLite |
| Unit | Validator: margin constraint, category exclusion, empty strategies pass-through | Vitest with mock proposals |
| Unit | System prompt: strategies injected, empty strategies omits section | Vitest string assertions |
| Integration | Full parse→store→inject→validate flow | Vitest + real SQLite |

## Migration / Rollout

No data migration required — new table, new files. Rollback: remove `strategies` param from `buildSystemPrompt`, drop `strategies` field from `AgentLoopConfig`, comment out `strategyValidator` call. Rename table to preserve data (don't drop).

## Open Questions

- [ ] Should `strategyValidator` return blocked proposals to the LLM for retry, or surface rejection directly to seller?
- [ ] Should `ceo_strategies` live in the Cortex DB file (shared) or a separate SQLite file?
- [ ] Should strategy CRUD surface as explicit tool calls (`manage_strategy`) or natural-language intent detection in the agent loop?
