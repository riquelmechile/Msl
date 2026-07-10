# cache-friendly-prompt-builder Specification

## Purpose

Prompt construction separating stable prefix from variable evidence to maximize DeepSeek disk cache hits. Stable prefix MUST change infrequently; variable evidence appended at tail.

## Requirements

### Requirement: Stable Prefix Construction

`buildStableAgentPrompt(config)` MUST assemble: system policy + agent role + company rules + safety policy + account context + recent compressed memory. Output SHALL be deterministic for same inputs.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Same agent/account | Same agentId + sellerId + accountContext | `buildStableAgentPrompt()` called twice | Same output, same `stablePromptHash` |
| Account context changed | Plasticov profit goal updated | Prompt rebuilt | `stablePromptHash` changes (one-time cache miss) |
| Seller A ≠ Seller B | agentId same, sellerId differs | Prompt built per seller | Outputs differ — Plasticov context ≠ Maustian context |

### Requirement: Variable Evidence Block

`buildVariableEvidenceBlock(config)` MUST assemble: new operational evidence + open questions + expected JSON output schema. Output changes per cycle.

#### Scenario: New evidence → new hash

- GIVEN evidence block built with 3 unanswered questions
- WHEN a new question arrives next cycle
- THEN `evidenceHash` differs from previous cycle

### Requirement: Full Prompt Assembly

`buildAgentWorkPrompt(config)` MUST produce complete prompt as: `stablePrefix + variableEvidence`. Stable block first (cached), evidence tail per cycle.

#### Scenario: Cached prefix

- GIVEN stable prefix unchanged from prior DeepSeek call
- WHEN new call uses same prompt
- THEN `prompt_cache_hit_tokens > 0`

### Requirement: Safety and Write Prohibition

Prompt MUST include write prohibition directive and explicit `noMutationExecuted: true` in expected output.

#### Scenario: Safety policy always present

- GIVEN prompt built for any agent
- WHEN prompt inspected
- THEN contains safety policy and write prohibition

### Requirement: Lessons Injection

Stable prefix SHALL include recent transferable lessons for the agent. Max 3 most recent, seller-scoped.

#### Scenario: Recent lessons injected

- GIVEN 5 transferable lessons exist for product-ads-profitability/plasticov
- WHEN stable prompt built
- THEN top 3 most recent included
