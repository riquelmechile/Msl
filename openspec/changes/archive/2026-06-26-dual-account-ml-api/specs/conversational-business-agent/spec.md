# Delta for conversational-business-agent

## ADDED Requirements

### Requirement: ML API Tool Access for Dual-Account Operations

The agent loop MUST register ML API sync tools (`sync_products`, `list_ml_categories`, `get_sync_status`, `initiate_sync`, `publish_product`, `get_ml_account_info`) alongside existing tools. The agent SHALL route sync-related user intents to these tools. Product sync operations SHALL respect the existing autonomy engine for approval gating.

#### Scenario: Agent routes sync instruction

- GIVEN the CEO sends "publicá todos los productos de electrónica en Maustian con 50% de margen"
- WHEN the agent processes the message
- THEN it MUST infer sync intent and invoke `sync_products` with category "electrónica" and margin 50%

#### Scenario: Sync tools registered at startup

- GIVEN the agent loop initializes
- WHEN tools are registered
- THEN `sync_products`, `publish_product`, `initiate_sync`, `get_sync_status`, `list_ml_categories`, and `get_ml_account_info` MUST appear in the LLM tool list

#### Scenario: Autonomy engine gates sync

- GIVEN autonomy level requires seller confirmation for writes
- WHEN agent invokes `publish_product` or `sync_products`
- THEN the tool MUST route through the approval pipeline
- AND SHALL NOT execute without valid approval

#### Scenario: Non-sync queries skip sync tools

- GIVEN seller asks "¿cuántas ventas tuve hoy?"
- WHEN the agent processes the message
- THEN sync tools SHALL NOT be invoked (read-only listing query)
