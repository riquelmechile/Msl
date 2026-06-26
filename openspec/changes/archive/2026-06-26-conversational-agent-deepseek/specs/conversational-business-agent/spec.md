# Delta for conversational-business-agent

## ADDED Requirements

| # | Requirement | Scenarios |
|---|------------|-----------|
| R1 | **Natural Language Intent Inference**: MUST infer seller intent from natural Spanish without topic enums, commands, or menus. | (a) Seller writes "cómo andamos con los márgenes" → identifies margin-analysis intent. (b) Vague question → asks clarifying questions in Spanish. |
| R2 | **DeepSeek LLM Integration**: MUST use DeepSeek v4 Flash via `openai` npm with `baseURL: "https://api.deepseek.com"`. Falls back to deterministic `answerBusinessQuestion()` on failure. | (a) Valid `DEEPSEEK_API_KEY` → response from `chat/completions`. (b) Unreachable → Spanish error + fallback. |
| R3 | **3-Block Prefix-Anchored Cache**: MUST assemble prompts as Block A (system prompt ~5K, immutable) + Block B (daily aggregates ~15K, 24h refresh) at prefix for caching, then Block C (Cortex context) per query. | (a) New conversation → A first, B second (~20K cacheable prefix). (b) Cached A+B → only Block C + user message incurs cost. |
| R4 | **Cortex Context via Tool**: MUST expose `get_business_context` tool reading `GraphEngine.traverse().context`. Agent calls it on demand. | (a) Seller asks about category → tool returns Cortex neural context. (b) No learned data → empty context, no error. |
| R5 | **Conversation State**: MUST maintain message history across turns; truncate oldest when context window overflows while preserving A+B and recent turns. | (a) 5 prior messages → included in next request. (b) Overflow → oldest truncated, A+B+recent preserved. |
| R6 | **Streaming Responses**: MUST stream LLM responses token-by-token for real-time UX. | (a) Question received → tokens delivered as produced. (b) Connection drops → partial response with Spanish error note. |

## MODIFIED Requirements

### Requirement: Spanish Business Conversation
The system MUST provide a Spanish conversational interface. Responses are LLM-generated via DeepSeek, not template-matched.
(Previously: template-based responses, no LLM generation.)

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Business advice | Seller asks about ML business case | Agent answers | Spanish recommendation + rationale |
| Missing context | Seller question lacks context | Agent cannot produce reliable answer | Asks for missing context |
| Streaming delivery | Seller asks for advice | LLM generates response | Tokens streamed token-by-token |
