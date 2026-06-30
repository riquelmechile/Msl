# Delta for ml-api-integration

## ADDED Requirements

### Requirement: Shared MLC Item Completeness Validation

The MercadoLibre package MUST expose a runtime completeness boundary for unknown MLC item payloads and MUST use that same boundary when returning `MlItem` values from item reads. The boundary MUST accept only payloads with the required item fields needed by downstream sync preview evidence and MUST reject incomplete payloads without inventing placeholder business data.

#### Scenario: Complete item read is normalized

- GIVEN MercadoLibre returns a complete MLC item payload
- WHEN the system reads the item through `getItem()`
- THEN the returned value MUST satisfy the shared `MlItem` completeness boundary
- AND downstream callers MAY reuse the same validation contract.

#### Scenario: Incomplete item payload is rejected

- GIVEN MercadoLibre returns an item payload missing required sync-preview fields
- WHEN the shared completeness boundary evaluates the payload
- THEN it MUST reject the payload as incomplete
- AND it MUST NOT synthesize required fields from defaults or placeholders.
