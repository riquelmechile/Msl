# Delta for ml-api-integration

## ADDED Requirements

### Requirement: Capability Matrix — Slice 1 2026 Gap Entries

Three new entries SHALL be added to the MercadoLibre Capability Classification Matrix:

| Area | Classification | Endpoint | Site support | Runtime surface |
|------|----------------|----------|-------------|-----------------|
| Image moderation status | `safe-read` | `GET /moderations/last_moderation/{id}` | MLC-to-confirm | `read-tool` |
| Communications / notices | `safe-read` | `GET /communications/notices` | MLC-to-confirm | `read-tool` |
| Questions answer | `prepare-only` | `POST /answers` | MLC-to-confirm | `prepared-action` |

#### Scenario: New matrix entries follow established classification contract

- GIVEN three API areas from 2025-2026 docs are added to the matrix
- WHEN the system evaluates runtime behavior for each
- THEN each entry MUST declare classification, evidence reference, freshness expectation, confidence, `siteSupport`, and runtime surface
- AND `safe-read` entries MUST follow existing read-tool patterns with no approval requirements
- AND the `prepare-only` entry MUST require `requiresApproval: true` with no direct MCP execution

#### Scenario: MLC support is to-be-confirmed

- GIVEN the documentation does not yet explicitly confirm MLC support for these endpoints
- WHEN the entries are classified
- THEN `siteSupport` MUST be `MLC-to-confirm`
- AND confidence MUST be low for the `prepare-only` entry
- AND mutation execution MUST be blocked until MLC site support is confirmed and execution slice exists
