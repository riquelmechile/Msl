# Design: Conversational Agent with DeepSeek

## Technical Approach

Replace the deterministic `answerBusinessQuestion()` with a DeepSeek-powered conversational agent using the OpenAI Agents SDK (`@openai/agents`) for infrastructure (loop, streaming, tool routing, guardrails) while retaining full control over prompt assembly via a 3-block prefix-anchored cache strategy. The deterministic agent remains as a coexisting safety fallback.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| **Agent Framework** | Raw `openai` npm vs. OpenAI Agents SDK vs. Mastra | OpenAI Agents SDK (Hybrid) | SDK handles loop/streaming/tools/guardrails; we inject custom cache blocks. Falls back to raw `openai` npm in hours if the SDK creates friction. |
| **Cortex Integration** | Inline Block C assembly vs. Tool-based | Tool-based (`get_business_context`) | Cortex called on demand, not per-turn. Tool approach keeps context fresh (traversal snapshot) and independently testable. |
| **Cache Assembly** | Prefix-anchored A+B (~20K cacheable) + dynamic C | **Block A** (system prompt ~5K, immutable), **Block B** (daily aggregates ~15K, 24h TTL), **Block C** (Cortex context, per-query via tool) | DeepSeek cache is token-0-anchored; A+B identical across all conversations achieves >90% cache hit rate. Dynamic C+hitory at end preserves prefix. |
| **Guardrail Mapping** | SDK defaults vs. Custom | Custom guardrails wrapping domain types | SDK defaults are English-patterned. Custom `SpanishValidator`, `HarmfulContentFilter`, `ActionSafetyValidator` reuse deterministic agent's `detectSafetyConflict` pattern and map LLM output → `PreparedAction` → `ApprovalRecord` → `AuditRecord`. |
| **Coexistence** | Replace vs. Add | Coexist — conversational + deterministic | Deterministic agent is 200 lines, well-tested, and serves as fallback on LLM failure. Conversational path is additive. |

## Data Flow

```
User (Spanish) → [Input Guardrails: Spanish? Harmful?]
                       ↓ (pass)
            get_business_context(query) → GraphEngine.traverse().context
                       ↓
            System Prompt (A + cached B) + Conversation History + User + Cortex
                       ↓
            DeepSeek v4 Flash (via OpenAIProvider, chat/completions)
                       ↓ streaming
            [Output Guardrails: action safe?]
                       ↓
            LLM output → PreparedAction (approvalStatus: "pending")
                       ↓
            User confirms ("dale") → execute → AuditRecord
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/types.ts` | Create | `ConversationMessage`, `AgentProposal`, `StreamingChunk` types |
| `packages/agent/src/conversation/systemPrompt.ts` | Create | Block A builder: Plasticov identity, hard rules (Spanish-only, "dale" confirmation, no prompt reveal) |
| `packages/agent/src/conversation/cacheBlocks.ts` | Create | Block B (daily aggregates, 24h TTL via `@msl/domain` `CacheFreshness`) + Block C assembly wrapper |
| `packages/agent/src/conversation/tools.ts` | Create | `get_business_context` (intent → seed nodes → spreadActivation → traverse().context) + `prepare_action` (LLM output → PreparedAction) |
| `packages/agent/src/conversation/agentLoop.ts` | Create | SDK `Agent` + `Runner` setup, conversation loop, streaming handler |
| `packages/agent/src/conversation/guardrails.ts` | Create | `SpanishValidator`, `HarmfulContentFilter`, `ActionSafetyValidator` |
| `packages/agent/src/index.ts` | Modify | Export conversational entry points; keep `answerBusinessQuestion()` |
| `packages/agent/package.json` | Modify | Add `openai`, `@openai/agents` dependencies |

## Interfaces / Contracts

```typescript
// Core types under packages/agent/src/conversation/types.ts
type ConversationMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
};

type AgentProposal = {
  action: Omit<PreparedAction, "approvalStatus" | "riskLevel">;
  naturalSummary: string; // "¿Bajo el precio del listing #42 en 10%?"
};

type StreamingChunk = { delta: string; done: boolean };

// Agent loop entry point
async function converse(
  input: { sellerId: SellerId; message: string; history: ConversationMessage[] },
  engine: GraphEngine,
): AsyncIterable<StreamingChunk>;
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| **Unit** | `systemPrompt.ts` (output includes hard rules), `cacheBlocks.ts` (Block B 24h refresh), `tools.ts` (`get_business_context` returns context shape, `prepare_action` maps LLM output), `guardrails.ts` (Spanish-only blocks English, action safety flags high-risk) | Vitest with mocked `GraphEngine` and mocked `openai` client |
| **Integration** | `agentLoop.ts` with real Cortex (in-memory SQLite), mock DeepSeek responses; full proposal pipeline: LLM output → PreparedAction → guardrail → approval | Vitest integration tests |
| **Existing** | `packages/agent/src/agent.test.ts` — 6 deterministic tests must pass unchanged | `npm test` in agent package |

## Open Questions

- [ ] DeepSeek API key available for integration testing, or use mock client?
- [ ] Daily aggregates (Block B) source: which read-snapshot API provides the 15K token aggregates? Existing `@msl/domain` readSnapshot?

## Rollback

Remove `packages/agent/src/conversation/`, remove SDK deps from `package.json`, revert `index.ts` exports. No data migration needed.
