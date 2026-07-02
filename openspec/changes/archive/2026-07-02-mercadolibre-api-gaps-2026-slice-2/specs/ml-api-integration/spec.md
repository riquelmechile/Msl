# Delta for ml-api-integration

## ADDED Requirements

### Requirement: Capability Matrix — Slice 2 2026 Gap Entries

Four new entries SHALL be added to the MercadoLibre Capability Classification Matrix:

| Area | Classification | Endpoint | Site support | Runtime surface |
|------|----------------|----------|-------------|-----------------|
| Claims search/detail | `safe-read` | `GET /post-purchase/v1/claims/search`, `GET /post-purchase/v1/claims/{id}`, 4 sub-resources | MLC-to-confirm | `read-tool` |
| Shipping status | `safe-read` | `GET /marketplace/shipments/{id}` (x-format-new: true) | MLC-to-confirm | `read-tool` |
| MCP tool wiring (Slice 1) | Infrastructure | N/A (MCP layer only) | N/A | `read-tool` / `prepared-action` |
| Image orchestration flow | `prepare-only` | Multi-step: diagnose → upload → associate → check | MLC-to-confirm | `prepared-action` |

#### Scenario: New entries follow established classification contract

- GIVEN claims, shipping, MCP wiring, and image orchestration are added to the matrix
- WHEN the system evaluates runtime behavior for each
- THEN each entry MUST declare classification, evidence reference, freshness expectation, confidence, `siteSupport`, and runtime surface
- AND `safe-read` entries MUST follow existing read-tool patterns with no approval requirements
- AND `prepare-only` entries MUST require `requiresApproval: true` with no direct MCP execution

#### Scenario: MLC support is to-be-confirmed

- GIVEN the documentation does not yet explicitly confirm MLC support for claims and shipping
- WHEN the entries are classified
- THEN `siteSupport` MUST be `MLC-to-confirm`
- AND confidence MUST be low for `prepare-only` entries
- AND mutation execution MUST be blocked until MLC site support is confirmed

#### Scenario: Infrastructure entries have no runtime surface

- GIVEN the MCP tool wiring entry is classified as infrastructure
- WHEN the matrix is evaluated
- THEN its runtime surface MUST reference the specific tool surface of each wired capability
- AND the infrastructure entry itself MUST NOT expose independent execution behavior
