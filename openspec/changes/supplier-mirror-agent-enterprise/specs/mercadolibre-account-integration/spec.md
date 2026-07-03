# Delta for MercadoLibre Account Integration

## ADDED Requirements

### Requirement: Supplier ML Source Reads

Supplier Mirror MUST treat MercadoLibre supplier listings as the operational source for supplier stock. Official MercadoLibre APIs and current documentation/MCP reference MUST be used first; scraping MAY be used only as fallback evidence for data gaps and MUST remain isolated from mutation paths.

#### Scenario: API stock read succeeds
- GIVEN a supplier MercadoLibre item is readable through authorized or public API flow
- WHEN Supplier Mirror observes stock
- THEN the observation MUST cite ML API evidence as authoritative stock source

#### Scenario: API gap requires fallback
- GIVEN required supplier stock evidence is unavailable through API/docs-supported paths
- WHEN fallback collection runs
- THEN scraping MAY collect evidence with confidence metadata
- AND it MUST NOT execute MercadoLibre mutations

### Requirement: Symmetric Target Account Selection

MercadoLibre target operations for Supplier Mirror MUST select Plasticov, Maustian, or both from explicit supplier/item/category target policy. The old Plasticov→Maustian sync direction guard MUST NOT constrain Supplier Mirror targeting.

#### Scenario: Supplier targets Maustian only
- GIVEN target policy selects Maustian for a supplier item
- WHEN a mirror proposal is prepared
- THEN only Maustian account evidence and mappings MUST be used

#### Scenario: Both accounts targeted
- GIVEN target policy selects both accounts
- WHEN synchronization is evaluated
- THEN Plasticov and Maustian MUST be evaluated as independent targets
