# Delta for action-approval-safety

## ADDED Requirements

| # | Requirement | Scenarios |
|---|------------|-----------|
| R1 | **Conversational Proposal Pipeline**: MUST accept LLM natural-language proposals, format as `PreparedAction` with `approvalStatus: "pending"`, execute only after user confirms ("dale", "sí", "ok"). | (a) Agent suggests "¿bajo el precio 10%?" → `PreparedAction` pending. (b) User writes "dale" → execute + record `AuditRecord`. (c) User writes "no" or ignores → no execution. |
| R2 | **SDK Guardrail Integration**: MUST apply input guardrails (Spanish-only, no harmful) and output guardrails (safe actions) via agent SDK. | (a) English input → reject, ask Spanish. (b) Harmful intent detected → reject + Spanish explanation. (c) High-risk LLM action → flag + require extra confirmation. |
| R3 | **Natural-Language Rejection**: When guardrails block, MUST explain in natural Spanish, not raw errors. | (a) Input blocked → clear Spanish why. (b) Output action blocked → Spanish explanation of safety concern. |

## MODIFIED Requirements

### Requirement: Human Approval for Writes
MUST require seller approval before writes (price, stock, messages, cancellations, refunds, listings, creative). Proposals MAY originate from conversational LLM or deterministic agent.
(Previously: deterministic agent only.)

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Write action ready | Agent recommends business write | Action prepared | Show exact change, wait for approval |
| Conversational proposal | LLM agent proposes write in Spanish | Formatted as `PreparedAction` | Same safety requirements as deterministic |
| Approval absent | No approval recorded | Execution attempted | Block action |

### Requirement: Risk Audit Trail
MUST record approver, change, rationale, timestamp, and risk. Audit records MUST distinguish deterministic vs conversational proposer.
(Previously: no proposer-source differentiation.)

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Action executed | Seller approves prepared action | System executes | Audit record with rationale + status |
| Conversational recorded | LLM proposal approved + executed | Audit trail written | Includes original proposal text + confirmation phrase |
| High-risk action | Action affects claims/refunds/reputation | Approval requested | Highlight risk before acceptance |
