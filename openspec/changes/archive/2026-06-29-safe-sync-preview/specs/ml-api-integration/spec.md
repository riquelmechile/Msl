# Delta for ml-api-integration

## MODIFIED Requirements

### Requirement: MCP Tool Surface

The current MCP package exposes a stubbed tool surface (`simulate_actor`, `detect_probes`, `sync_product`, `check_account`, `list_strategies`, `consult_cortex`). Production write/sync tools SHALL require approval through the existing approval pipeline before any sync engine call. `sync_product` MAY compute inline read-only preview evidence for a pending proposal, but MCP MUST NOT import, instantiate, or execute `ProductSyncEngine` for that preview.
(Previously: MCP sync calls could only prepare approval-required proposals and had no explicit read-only preview boundary.)

#### Scenario: Agent invokes sync_products

- GIVEN the agent receives CEO instruction "publicá electrónica en Maustian"
- WHEN the agent calls `sync_product` or a future production sync tool with category filter "electrónica"
- THEN the tool MUST prepare an approval-required proposal and SHALL NOT execute the sync engine directly from the LLM tool call

#### Scenario: MCP computes read-only preview evidence

- GIVEN `sync_product` has read-only source data and pure strategy evidence
- WHEN it prepares a pending proposal with preview metadata
- THEN MCP MUST NOT import, instantiate, or call `ProductSyncEngine`
- AND it MUST NOT call `publishItem`, `updateItem`, or `changeItemStatus`

#### Scenario: Write tool requires approval

- GIVEN autonomy level is below auto-approval threshold
- WHEN `publish_product` is invoked
- THEN the tool MUST prepare an approval request instead of executing directly
