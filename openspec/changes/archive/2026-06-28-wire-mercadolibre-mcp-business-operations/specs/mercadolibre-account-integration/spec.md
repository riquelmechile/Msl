# Delta for MercadoLibre Account Integration

## ADDED Requirements

### Requirement: MLC Plasticov-to-Maustian Sync Preparation Boundary

MCP product sync preparation MUST enforce configured `MLC` seller roles where Plasticov is the source and Maustian is the target. The system MUST reject reversed, arbitrary, non-`MLC`, missing, or mismatched seller roles with controlled blocked responses.

#### Scenario: Configured role direction is accepted

- GIVEN valid MCP auth and configured `MLC` roles identify Plasticov as source and Maustian as target
- WHEN a single-product sync proposal targets Maustian from Plasticov
- THEN the system MUST allow proposal preparation
- AND it MUST include source seller, target seller, and site metadata

#### Scenario: Reversed direction is requested

- GIVEN configured `MLC` roles identify Plasticov as source and Maustian as target
- WHEN a request tries Maustian-to-Plasticov sync preparation
- THEN the system MUST block the request as unsafe direction
- AND it MUST NOT create a prepared proposal

#### Scenario: Seller role or site is unsafe

- GIVEN seller roles are missing, mismatched, arbitrary, or not `MLC`
- WHEN `sync_product` preparation is requested
- THEN the system MUST return a controlled blocked response
- AND it MUST NOT expose another seller's operational data or prepare a sync proposal
