# Proposal: CEO Strategy Injection via Natural Language

## Intent

The CEO/owner has no path to inject business strategies (e.g., "margen 50% en electrónica") that systematically alter agent behavior. The system prompt is static; the agent can't accept explicit strategic directives. This change lets the CEO shape business rules conversationally in Spanish.

## Scope

### In Scope
- Hybrid strategy parser (regex fast-path → LLM fallback for ambiguity)
- 9 strategy rule types: margin, stock, category focus/exclusion, pricing cap/floor, competitive, customer, risk appetite
- SQLite `business_strategies` table (active/inactive/replaced_by lifecycle)
- Block A system prompt injection (`buildSystemPrompt` accepts active strategies)
- `strategyValidator` guardrail blocking proposals that violate active strategies
- Conversation-based CRUD: create, list, update, archive strategies via natural language

### Out of Scope
- Telegram/Discord bot interface (Phase 7+)
- Real-time market data for strategy validation
- Multi-CEO/team roles
- Auto-execution without "dale" confirmation

## Capabilities

### New Capabilities
- `ceo-strategy-parsing`: Hybrid parser extracting structured rules from natural Spanish strategy text
- `ceo-strategy-management`: SQLite persistence for strategy lifecycle with activate/deactivate/supersede

### Modified Capabilities
- `conversational-business-agent`: `buildSystemPrompt(sellerName, strategies)` — appends `## Estrategia del CEO` section; `AgentLoopConfig` carries strategies
- `action-approval-safety`: New `strategyValidator(proposal, strategies): GuardResult` rejects proposals violating active constraints

## Approach

**Parsing**: Regex patterns capture ~80% of common phrasings (margen/N%, priorizá/+N stock, enfocate en/X). Low-confidence or unmatched snippets fall back to DeepSeek structured extraction via JSON mode. Graceful degradation: pattern-only when no API key.

**Storage**: Dedicated SQLite table — strategies are inspectable directives with explicit lifecycle, not learned associations. Cortex (future work) tracks strategy-outcome correlation as second-order learning.

**Injection**: Block A at token 0 (identity-level, present on every turn). Guardrails at output (catches LLM drift). One-time cache invalidation cost (~$0.005) per strategy change — acceptable given infrequent changes.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/systemPrompt.ts` | Modified | Accepts strategies param, renders `## Estrategia del CEO` |
| `packages/agent/src/conversation/agentLoop.ts` | Modified | `AgentLoopConfig` carries strategies |
| `packages/agent/src/conversation/guardrails.ts` | Modified | New `strategyValidator` |
| `packages/agent/src/conversation/types.ts` | Modified | `StrategyRule`, `StrategyInjection`, `ParseResult` |
| `packages/agent/src/conversation/strategyParser.ts` | New | Hybrid regex+LLM parser |
| `packages/agent/src/conversation/strategyStore.ts` | New | SQLite CRUD for business_strategies table |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Prefix cache invalidation (~$0.005 per strategy change) | High (on change) | Documented as acceptable; strategies change infrequently |
| Conflicting strategies (e.g., margin 50% + match competitor X) | Medium | Strategy ordering: later overrides earlier; system prompt instructs LLM reconciliation |
| Parser misses creative Spanish phrasing | Medium | LLM fallback handles ambiguity; confidence scoring rejects low-confidence pattern matches |
| LLM ignores strategy directives at inference | Low-Medium | Guardrail catches violations before seller sees them |
| No `DEEPSEEK_API_KEY` in local dev | Low | Pattern parser works standalone; LLM fallback skips with warning log |

## Rollback Plan

1. Remove `strategies` param from `buildSystemPrompt` → reverts to static prompt
2. Remove `strategies` field from `AgentLoopConfig` → no effect on agent loop
3. Comment out `strategyValidator` guardrail call → proposals pass without strategy check
4. Rename `business_strategies` table → data preserved, no queries hit it

## Dependencies

- Existing `systemPrompt.ts`, `agentLoop.ts`, `guardrails.ts` (Phase 2)
- `DEEPSEEK_API_KEY` for LLM fallback path (optional; pattern parser works standalone)

## Success Criteria

- [ ] CEO types "margen 50% en electrónica" → parsed as `{ type: 'margin', target: 50, category: 'electrónica' }` and persisted
- [ ] Block A includes active strategies on next conversation turn
- [ ] Agent proposal for low-margin electrónica action is rejected by `strategyValidator`
- [ ] "Listá mis estrategias" returns active strategy summary in Spanish
- [ ] "Cambiá margen a 45%" updates existing strategy, deactivates old, invalidates cache once
