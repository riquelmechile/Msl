# Proposal: MLC Read Tools Foundation

## Intent

Bridge the existing MercadoLibre direct API client and project-owned tool layer so the agent can safely read authorized seller business data with freshness, source, and confidence metadata. This moves the MVP beyond static demo boundaries without adding real OAuth, persistence, writes, live credentials, or UI wiring.

## Scope

### In Scope
- Add typed custom read tools for listings, orders, messages, and reputation.
- Normalize test-transport read results into seller-facing business snapshots with source, freshness, and confidence metadata.
- Block protected reads when access is revoked or mismatched.
- Prove read tools do not require approval and do not use official MCP as an executor.

### Out of Scope
- Real OAuth callback handling, credential storage, token refresh, or live API calls.
- Write execution, approval flow expansion, publication, refunds, cancellations, or messaging sends.
- Next.js demo UI wiring, daily-insights pipeline integration, pagination depth, or durable persistence.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `custom-business-mcp-tools`: Define concrete read tools and read-only approval behavior.
- `mercadolibre-account-integration`: Clarify protected read behavior through authorized direct APIs and revoked-access blocking.
- `business-memory-cache`: Define small fresh-enough snapshot metadata used by read tools.

## Approach

Implement a package-focused foundation: extend `packages/mercadolibre` normalization around the existing client, expose read tools in `packages/tools`, reuse domain and memory freshness contracts, and add integration/package tests. Official MercadoLibre MCP remains documentation-only; seller data comes only through project-owned direct API tools.

Assumptions: mocked/test transports are acceptable for this slice; API payload normalization is intentionally conservative until validated against current MercadoLibre docs; reads may return partial/low-confidence results when evidence is incomplete.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/index.ts` | Modified | Normalize read payloads and access failures. |
| `packages/tools/src/index.ts` | Modified | Add concrete read tool surface. |
| `packages/memory/src/index.ts` | Modified | Add lightweight snapshot/freshness adapter if needed. |
| `packages/domain/src/*` | Modified | Reuse/extend shared read result vocabulary. |
| `tests/tools/tools.integration.test.ts` | Modified | Cover authorized reads, metadata, and no approval requirement. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Mocked payloads drift from live MLC APIs | Med | Keep normalization conservative and documentation-backed. |
| Slice grows beyond review budget | Med | Keep UI, OAuth, persistence, and insight wiring out. |
| MCP boundary confusion | Low | Tests/specs assert official MCP is docs-only. |

## Rollback Plan

Revert the read-tool package changes and their tests/spec deltas. Existing prepared-write tools, demo UI, and access evaluation remain unchanged.

## Dependencies

- Existing `MlcApiClient`, access-state contracts, domain models, memory freshness contracts, and Vitest test setup.

## Success Criteria

- [ ] Read tools return listings/orders/messages/reputation snapshots with source, freshness, and confidence metadata.
- [ ] Revoked or mismatched access blocks protected reads with a reconnect-oriented result.
- [ ] Reads never create approval requests and never use official MCP as a seller-operation executor.
- [ ] Package/integration tests pass without real credentials or live API calls.
