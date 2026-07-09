# Delta for conversational-business-agent

## ADDED Requirements

### Requirement: AgentLoop Account Context
`AgentLoopConfig` MUST include `accountContext?: { sellerId, asset?: AccountAsset }`. When set, business tools, approvals, and outcome attribution SHALL be account-scoped.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Wired with capabilities | `accountContext.asset` has profitGoal=40, capabilities | Agent initializes | `get_business_context` includes capabilities and profit goal |
| No account context | `accountContext` undefined | Agent initializes | Functions globally (backward compatible) |

### Requirement: Account-Aware System Prompt
`buildSystemPrompt(name, strategies, accountContext?)` MUST inject account name, capabilities, profit goal, and risk into Block A when context provided.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Context injected | Plasticov: goal 40%, risk low | Prompt built | Block A includes name, goal, risk |
| No context | `accountContext` undefined | Prompt built | No account section (backward compatible) |

### Requirement: DeepSeek Cache Prompt Stability
Block A+B MUST remain stable for prefix caching. Account context changes SHALL regenerate Block A accepting one-time cache miss.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Cache hit | A+B cached, context unchanged | New message | `prompt_cache_hit_tokens > 0` |
| Cache miss | Strategy changes between turns | New message | Block A regenerated, one-time miss cost |

### Requirement: Outcome Attribution per Account
Cortex reinforcement and lesson creation MUST use active `sellerId`. Maustian outcome MUST NOT affect Plasticov edges.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Maustian outcome isolated | AgentLoop in Maustian session, price confirmed | Escribano processes | Node scoped to Maustian; only Maustian edges reinforced |
| Plasticov outcome isolated | AgentLoop in Plasticov session | Outcome processed | All artifacts scoped to `seller_id = "plasticov"` |

### Requirement: Per-Account "dale" in AgentLoop
`turnResolution` MUST scope confirmation to active `sellerId`. Multi-account ambiguity SHALL reject with disambiguation prompt.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Active account resolves | AgentLoop in Maustian session, pending proposal | User: "dale" | Maustian proposal confirmed |
| Multi-account ambiguity | Both Plasticov and Maustian pending | User: "dale" | Rejected; asks "¿para cuál cuenta?" |
| "dale la de Maustian" | Both pending | User specifies account | Only Maustian confirmed |

## MODIFIED Requirements

### Requirement: Cortex Context via Tool
`get_business_context` MUST read `GraphEngine.traverse()` scoped to active `sellerId`, including `AccountAsset` capabilities.

(Previously: Cortex context was global, not account-scoped.)

#### Scenario: Scoped context
- GIVEN active account is Plasticov
- WHEN agent calls `get_business_context`
- THEN Plasticov-scoped nodes and capabilities returned; Maustian account-scoped nodes excluded
- AND global nodes included for both

### Requirement: DeepSeek LLM Integration
(Unchanged. Cache `user_id` MAY incorporate `sellerId` for per-account cache separation.)

### Requirement: 3-Block Prefix-Anchored Cache
Blocks A+B remain cacheable prefix. Block C injects account-scoped new evidence per query. (Logic unchanged; account context injected in Block A.)
