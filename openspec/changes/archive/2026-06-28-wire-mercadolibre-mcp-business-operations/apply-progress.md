# Apply Progress: Wire MercadoLibre MCP Business Operations

## Mode

Standard apply mode. Strict TDD is disabled for this project.

## Completed Tasks

- [x] 1.1 Updated `sync_product` input schema to require source/target seller IDs, item ID, rationale, expiry, `requiresApproval: true`, and `risk: "high"`.
- [x] 1.2 Added controlled blocked responses for MCP auth and validation failures without secret leakage.
- [x] 1.3 Extended MCP runtime configuration with optional MLC account-role data without adding sync execution or OAuth write dependencies.
- [x] 2.1 Replaced fake `sync_product` success with prepare-only validation for API key, seller direction, target, rationale, strict future ISO expiry, approval metadata, and high risk.
- [x] 2.2 Saved pending `listing-edit` prepared proposals only after all validations pass.
- [x] 2.3 Added source seller, target seller, site, risk, expiry, and no-mutation metadata to the JSON response.
- [x] 2.4 Preserved the existing strict Plasticov -> Maustian MLC direction helper; no new account-role helper was required.
- [x] 2.5 Avoided `sync_all`, execution tools, persistent approval storage, sync preview calculation, and `ProductSyncEngine` imports.
- [x] 3.1 Added success coverage for pending sync proposals.
- [x] 3.2 Added blocked coverage for auth, direction, seller-role, expiry, rationale, and approval metadata failures.
- [x] 3.3 Added explicit missing and non-high risk blocked coverage before repository save.
- [x] 3.4 Added regression assertions for excluded mutation tools and no MCP `ProductSyncEngine` import.
- [x] 4.1 Ran focused MCP Vitest coverage.
- [x] 4.2 Ran full Vitest, typecheck, and lint verification.

## Corrective Apply Rerun

- [x] C.1 Loosened the `sync_product` MCP SDK input boundary from strict Zod literals/required strings to handler-validated unknown optional fields for proposal metadata.
- [x] C.2 Preserved handler-level success validation for `requiresApproval: true`, `risk: "high"`, strict future expiry, target/rationale, and MLC Plasticov -> Maustian direction before repository save.
- [x] C.3 Added `packages/mcp/src/mcp.integration.test.ts` to exercise the real MCP SDK `Client` + `InMemoryTransport` call path for missing/invalid approval and risk metadata.
- [x] C.4 Preserved prepare-only scope: no mutation execution, no `ProductSyncEngine`, no `sync_all`, no persistent approval storage, and no sync preview calculation.
- [x] C.5 Ran Prettier on `packages/mcp/src/index.ts`, `packages/mcp/src/mcp.integration.test.ts`, and `packages/mcp/src/mcp.test.ts` to resolve the verify-blocking format check.
- [x] C.6 Added SDK integration coverage proving prepared `sync_product` responses disclose `approvalPersistence: "in-memory-only"`, `auditReplay: "not-available"`, and `persistentApprovalStorage: false` while keeping the proposal pending and non-executing.
- [x] C.7 Re-ran focused MCP tests, format check, typecheck, lint, and full Vitest sequentially.
- [x] C.8 Added runtime MLC site validation for injected account roles; non-MLC or incomplete role config now blocks before repository save.
- [x] C.9 Wrapped prepared-action repository save failures with a controlled blocked `prepare-write-failed` response that does not leak the thrown error message.
- [x] C.10 Added focused unit and SDK integration coverage for unsupported bulk or multi-product sync intent.

## Verification

| Command | Result |
|---|---|
| `npm test -- packages/mcp/src/mcp.test.ts` | Passed: 42 tests |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | Passed: 35 files, 721 tests |
| `npm test -- packages/mcp/src/mcp.test.ts packages/mcp/src/mcp.integration.test.ts` | Passed: 2 files, 46 tests |
| `npm run typecheck && npm run lint` | Passed |
| `npx prettier --write packages/mcp/src/index.ts packages/mcp/src/mcp.integration.test.ts packages/mcp/src/mcp.test.ts` | Passed |
| `npm test -- packages/mcp/src/mcp.test.ts packages/mcp/src/mcp.integration.test.ts` | Passed: 2 files, 47 tests |
| `npm run format:check` | Passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | Passed: 36 files, 726 tests |
| `npm test -- packages/mcp/src/mcp.test.ts packages/mcp/src/mcp.integration.test.ts` | Passed: 2 files, 56 tests after pre-commit review fixes |
| `npm test` | Passed: 36 files, 735 tests |
| `npm run typecheck` | Passed |
| `npm run lint` | Timed out after 900s with no ESLint diagnostics emitted |
| `npx eslint packages/mcp/src/index.ts packages/mcp/src/mcp.test.ts packages/mcp/src/mcp.integration.test.ts` | Timed out after 120s with no ESLint diagnostics emitted |
| `npm run format:check` | Passed |
| `npm run format:check` | Timed out after 300s on final rerun after archive-doc updates |
| `./node_modules/.bin/prettier --check packages/mcp/src/index.ts packages/mcp/src/mcp.test.ts packages/mcp/src/mcp.integration.test.ts openspec/changes/archive/2026-06-28-wire-mercadolibre-mcp-business-operations/tasks.md openspec/changes/archive/2026-06-28-wire-mercadolibre-mcp-business-operations/apply-progress.md openspec/changes/archive/2026-06-28-wire-mercadolibre-mcp-business-operations/archive-report.md` | Passed |

## Workload / PR Boundary

- Mode: single PR-sized work with work-unit discipline.
- Current work unit: prepare-only MCP `sync_product` proposal creation.
- Boundary: MCP validation, prepared-action save, runtime account-role configuration, and focused tests only.
- Review budget impact: actual post-archive diff exceeded the original 400-line forecast after SDK integration tests, verification fixes, and pre-commit review blockers; scope remains a single corrective pre-commit unit because the archived change is already uncommitted.
- Corrective rerun impact: small targeted schema/validation boundary change plus one SDK integration test file; still suitable for the same single PR-sized work unit.
- Verification-blocker corrective impact: targeted response metadata disclosure, one focused SDK integration test, and formatter-only cleanup in the three files reported by verify.
- Pre-commit review corrective impact: targeted MLC runtime role-site validation, repository-save failure handling, and explicit bulk/multi-product blocked coverage.

## Deviations from Design

None. The implementation matches the prepare-only design, routes invalid proposal metadata through controlled handler-level blocked responses on the real MCP SDK path, and discloses the deferred persistence/audit limitations without adding persistence or execution.

## Issues Found

Previous mocked-callback tests bypassed MCP SDK input validation, which could reject strict literal/required metadata before the handler returned controlled blocked responses. The first corrective integration test now covers the real SDK call path. The follow-up verification pass found missing runtime coverage for approval persistence/audit replay disclosure and format drift in three MCP files; both are now fixed. Pre-commit review then found two runtime reliability blockers: injected non-MLC role config and repository save failures could escape the intended blocked-response contract; both are now handled before success is reported.
