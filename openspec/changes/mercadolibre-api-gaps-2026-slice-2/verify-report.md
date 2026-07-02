# Verify Report — mercadolibre-api-gaps-2026-slice-2

**Change**: mercadolibre-api-gaps-2026-slice-2
**Version**: N/A
**Mode**: Standard verification (Strict TDD inactive)
**Date**: 2026-07-02
**Artifact store**: openspec
**Verification type**: Remediation rerun

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 22 |
| Tasks complete | 22 |
| Tasks incomplete | 0 |
| Task 2.4 | ✅ Complete — all 4 claim sub-resource methods remain checked and implemented |

## Build & Tests Execution

**Focused package typecheck**: ✅ Passed

```text
npm run typecheck --workspace @msl/mercadolibre
> tsc -b --pretty false

npm run typecheck --workspace @msl/mcp
> tsc -b --pretty false
```

**Focused package tests**: ✅ Passed

```text
npm test --workspace @msl/mercadolibre
Test Files  2 passed (2)
Tests       163 passed (163)

npm test --workspace @msl/mcp
Test Files  1 passed (1)
Tests       136 passed (136)
```

**Root quality gates**: ✅ Passed

```text
npm run typecheck
> tsc -b --pretty false && npm run typecheck --workspace @msl/web
> @msl/web typecheck: tsc --noEmit --pretty false

npm run lint
> eslint .

npm run format:check
Checking formatting...
All matched files use Prettier code style!

npm test
Test Files  41 passed (41)
Tests       1062 passed (1062)
```

**Patch hygiene**: ✅ Passed

```text
git diff --check
```

**Coverage**: ➖ Not available — no coverage command/threshold was configured for this verification slice.

## Prior Blocker Remediation Evidence

| Prior blocker | Runtime evidence | Result |
|---------------|------------------|--------|
| Claims 429 no-retry rate-limited snapshot | `packages/mercadolibre/src/mercadolibre.test.ts` > `surfaces claims search 429 as rate-limited without retry`; source passes `retryOnRateLimit: false` and returns `blockedMetadata.reason: "rate-limited"` | ✅ Resolved |
| Shipping 429 no-retry rate-limited snapshot | `packages/mercadolibre/src/mercadolibre.test.ts` > `surfaces shipment 429 as rate-limited without retry`; source passes `retryOnRateLimit: false` and returns `blockedMetadata.reason: "rate-limited"` | ✅ Resolved |
| `prepare_answer` invalid auth | `packages/mcp/src/mcp.test.ts` > `prepare_answer auth gate blocks invalid API key before preparation` | ✅ Resolved |
| Expected resolutions empty state | `packages/mercadolibre/src/mercadolibre.test.ts` > `returns complete empty result when a claim has no expected resolutions` | ✅ Resolved |
| Image diagnostic failure branch | `packages/mercadolibre/src/mercadolibre.test.ts` > `surfaces diagnostic failure details and does not advance upload` | ✅ Resolved |
| Task 2.4 checked | `openspec/changes/mercadolibre-api-gaps-2026-slice-2/tasks.md` line 44 remains `[x]` | ✅ Resolved |

## Spec Compliance Matrix

| Requirement | Scenario | Test / evidence | Result |
|-------------|----------|-----------------|--------|
| custom-business-mcp-tools — Slice 1 read-only MCP tools | Moderation status tool returns snapshot | `packages/mcp/src/mcp.test.ts` > `read_moderation_status tool calls getModerationStatus with seller and item scoping` | ✅ COMPLIANT |
| custom-business-mcp-tools — Slice 1 read-only MCP tools | Notices tool returns paginated snapshot | `packages/mcp/src/mcp.test.ts` > `read_notices tool calls getNotices with pagination options` | ✅ COMPLIANT |
| custom-business-mcp-tools — Slice 1 read-only MCP tools | Unauthenticated request is blocked | `packages/mcp/src/mcp.test.ts` > `read_moderation_status auth gate blocks invalid API key`; shared API-key gate pattern also covers injected read tools | ⚠️ PARTIAL |
| custom-business-mcp-tools — Slice 1 read-only MCP tools | OAuth token is missing or expired | Shared OAuth client tests cover reconnect-required and no transport call; not repeated per new MCP tool | ⚠️ PARTIAL |
| custom-business-mcp-tools — Prepare-only answer tool | Answer preparation returns pending snapshot | `packages/mcp/src/mcp.test.ts` > `prepare_answer tool returns pending answer snapshot` | ✅ COMPLIANT |
| custom-business-mcp-tools — Prepare-only answer tool | Empty question or text is blocked/degraded | `packages/mcp/src/mcp.test.ts` > `prepare_answer tool handles empty questionId gracefully` | ✅ COMPLIANT |
| custom-business-mcp-tools — Prepare-only answer tool | Unauthenticated request is blocked | `packages/mcp/src/mcp.test.ts` > `prepare_answer auth gate blocks invalid API key before preparation` | ✅ COMPLIANT |
| custom-business-mcp-tools — MCP registration pattern | Custom registration follows existing pattern | Source inspection in `packages/mcp/src/index.ts`; registration test asserts tool presence | ⚠️ PARTIAL |
| ml-api-integration — Slice 2 matrix entries | New entries follow classification contract | Delta spec present; runtime tests cover safe-read/prepare-only behavior for implemented surfaces | ⚠️ PARTIAL |
| ml-api-integration — Slice 2 matrix entries | MLC support is to-be-confirmed | Delta specs declare `MLC-to-confirm`; main spec still contains older/conflicting Slice 2 rows pending archive reconciliation | ⚠️ PARTIAL |
| ml-api-integration — Slice 2 matrix entries | Infrastructure entries have no runtime surface | Source inspection confirms infrastructure row is spec-only; MCP tools are the runtime surfaces | ⚠️ PARTIAL |
| ml-claims — Claims Search | Search with stage/status filter | `packages/mercadolibre/src/mercadolibre.test.ts` > `passes search claims with status filter`; `normalizeClaimsSearch` scenarios | ✅ COMPLIANT |
| ml-claims — Claims Search | Search returns empty results | `packages/mercadolibre/src/mercadolibre.test.ts` > `returns empty results with pagination metadata` | ✅ COMPLIANT |
| ml-claims — Claims Search | OAuth token missing or expired | Shared OAuth read-client tests cover reconnect-required and no transport call; no claim-search-specific test | ⚠️ PARTIAL |
| ml-claims — Claims Search | Upstream rate limited | `packages/mercadolibre/src/mercadolibre.test.ts` > `surfaces claims search 429 as rate-limited without retry` | ✅ COMPLIANT |
| ml-claims — Claims Sub-Resources | Claim detail with messages | `packages/mercadolibre/src/mercadolibre.test.ts` > `getClaimDetail`; `getClaimMessages`; task 2.4 focused sub-resource tests | ✅ COMPLIANT |
| ml-claims — Claims Sub-Resources | Claim has no expected resolutions | `packages/mercadolibre/src/mercadolibre.test.ts` > `returns complete empty result when a claim has no expected resolutions` | ✅ COMPLIANT |
| ml-claims — Runtime surface classification | Safe-read, no approval, no mutation | Claim sub-resource snapshots expose `noMutationExecuted: true`; MCP read tools validate API key and call read methods | ✅ COMPLIANT |
| ml-image-orchestration — Flow definition | Full flow sequence defined | `packages/mercadolibre/src/mercadolibre.test.ts` > `normalizeImageOrchestration returns 4-step orchestration...` | ✅ COMPLIANT |
| ml-image-orchestration — Flow definition | Diagnostic step fails | `packages/mercadolibre/src/mercadolibre.test.ts` > `surfaces diagnostic failure details and does not advance upload` | ✅ COMPLIANT |
| ml-image-orchestration — Flow definition | Upload step requires approval gate | `normalizeImageOrchestration` test asserts `requiresApproval: true`; branch-level upload gate remains spec-only | ⚠️ PARTIAL |
| ml-image-orchestration — Prepare-only classification | No mutation executed by spec | `normalizeImageOrchestration` test asserts `noMutationExecuted: true` and `requiresApproval: true` | ✅ COMPLIANT |
| ml-shipping-status — Shipment status read | In-transit shipment read | `packages/mercadolibre/src/mercadolibre.test.ts` > `parses in-transit shipment with minimal fields`; header test | ✅ COMPLIANT |
| ml-shipping-status — Shipment status read | Delivered shipment read | `packages/mercadolibre/src/mercadolibre.test.ts` > `parses delivered shipment status` | ✅ COMPLIANT |
| ml-shipping-status — Shipment status read | Shipment not found | `packages/mercadolibre/src/mercadolibre.test.ts` > `returns partial completeness when payload is not an object` | ⚠️ PARTIAL |
| ml-shipping-status — Shipment status read | OAuth token missing or expired | Shared OAuth read-client tests cover reconnect-required and no transport call; no shipment-specific test | ⚠️ PARTIAL |
| ml-shipping-status — Shipment status read | Upstream rate limited | `packages/mercadolibre/src/mercadolibre.test.ts` > `surfaces shipment 429 as rate-limited without retry` | ✅ COMPLIANT |
| ml-shipping-status — Runtime surface classification | Safe-read, no approval, no mutation | Source inspection and MCP read tool behavior confirm read-only surface | ✅ COMPLIANT |

**Compliance summary**: 18 compliant, 9 partial, 0 untested, 0 failing.

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Claims search/detail | ✅ Implemented | `searchClaims`, `getClaimDetail`, normalizers, and tests are present. |
| Claim sub-resources / task 2.4 | ✅ Implemented | `getClaimMessages`, `getClaimExpectedResolutions`, `getClaimAffectsReputation`, and `getClaimStatusHistory` exist; paths match delta spec, including hyphenated `/affects-reputation`; snapshots include `noMutationExecuted: true`. |
| Shipping status | ✅ Implemented | `getShipmentStatus` calls `/marketplace/shipments/{id}` with `x-format-new: true`; normalizer/tests are present. |
| MCP Slice 1 wiring | ✅ Implemented | `read_moderation_status`, `read_notices`, and `prepare_answer` are registered with custom `server.registerTool()` pattern. |
| MCP Slice 2 wiring | ✅ Implemented | Additional `read_claims`, `read_claim_detail`, `read_shipment_status`, and claim sub-resource read tools are present. |
| Image orchestration | ✅ Implemented beyond original spec-only minimum | `normalizeImageOrchestration` and `prepare_image_orchestration` prepare-only surface exist and preserve no-mutation semantics. |
| Rate-limit behavior | ✅ Implemented for Slice 2 blockers | Claims search and shipment status pass `retryOnRateLimit: false`, return blocked `rate-limited` metadata on 429, and preserve default retry semantics for unrelated calls. |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Additive per-endpoint pattern: types → normalizers → optional client methods → MCP registrations | ✅ Yes | Implementation follows existing `MlcReadSnapshot`/normalizer/client-method structure. |
| Custom `server.registerTool()` for new MCP tools | ✅ Yes | New tool registrations are custom and validate `msl_api_key` before client calls. |
| No mutation execution by default | ✅ Yes | New surfaces are read-only or prepare-only; task 2.4 snapshots explicitly include `noMutationExecuted: true`. |
| `x-format-new: true` for shipping status | ✅ Yes | Verified by focused test and source inspection. |
| Classification/site-support contract | ⚠️ Partial | Delta specs use `MLC-to-confirm`, but current main spec has older/conflicting Slice 2 rows (`MLC-confirmed`, underscore `affects_reputation`) pending archive/spec reconciliation. |

## Issues Found

**CRITICAL**

- None.

**WARNING**

- Several OAuth/reconnect scenarios are covered by shared OAuth client tests rather than per new claims/shipping method tests.
- Current main OpenSpec files appear partially pre-synced and contain stale Slice 2 classification/endpoint text; archive reconciliation should correct this before final archive.

**SUGGESTION**

- Archive reconciliation should preserve the focused Slice 2 429 exception while leaving unrelated transport retry behavior intact.

## Verdict

PASS

Task completion is correct (22/22, including task 2.4), all named remediation blockers now have passing runtime coverage, and focused plus root verification commands pass.
