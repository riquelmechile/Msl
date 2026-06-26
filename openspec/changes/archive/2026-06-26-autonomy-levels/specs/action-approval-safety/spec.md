# Delta Spec: Action Approval Safety

## Modified Capability: `action-approval-safety`

### MODIFIED Requirement: Human Approval for Writes

> **Original** requires explicit seller approval for every write action. This delta relaxes that requirement when the current autonomy level permits auto-approval.

The system MUST require explicit seller approval before price changes, stock changes, customer messages, cancellations, refunds, listing edits, or creative publication, **UNLESS** the current autonomy level permits auto-execution of actions at the proposal's risk level. When auto-approved, the system MUST still generate audit records with `approvalMethod: "auto"` and the effective autonomy level. Proposals MAY originate from conversational LLM or deterministic agent.

#### Scenario: Auto-approved low-risk action skips dale

- GIVEN autonomy level is 3 and the agent proposes a low-risk `stock-update`
- WHEN `autonomyLevelGate` returns `passed: true` with `autoApproved: true`
- THEN the system MUST execute the action without "dale" confirmation
- AND MUST record an `AuditRecord` with `approvalMethod: "auto"` and `autonomyLevel: 3`

#### Scenario: High-risk action still requires dale at any level

- GIVEN autonomy level is 5 and the agent proposes a high-risk `cancellation`
- WHEN `autonomyLevelGate` returns `passed: false`
- THEN the system MUST present the proposal and wait for "dale" confirmation

#### Scenario: Level 0 always requires dale (no change from original)

- GIVEN autonomy level is 0 and the agent proposes any write action
- WHEN the action is ready
- THEN the system MUST show the exact proposed change and wait for explicit approval
- (ORIGINAL behavior preserved — zero change)

#### Scenario: Agent prepares a write action (modified original)

- GIVEN the agent recommends a business write
- WHEN the action is ready
- THEN it MUST show the exact proposed change and wait for explicit approval **unless the autonomy level permits auto-approval**

#### Scenario: Conversational proposal (unchanged)

- GIVEN the LLM agent proposes a write in Spanish
- WHEN it is formatted as `PreparedAction`
- THEN it MUST meet the same safety requirements as deterministic proposals

#### Scenario: Approval is absent (modified)

- GIVEN no explicit approval has been recorded **and autonomy level does not permit auto-approval**
- WHEN execution is attempted
- THEN the system MUST block the action
