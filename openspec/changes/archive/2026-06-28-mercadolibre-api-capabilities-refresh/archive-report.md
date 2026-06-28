# Archive Report: MercadoLibre API Capabilities Refresh

## Status

Archived successfully on 2026-06-28 in hybrid OpenSpec + Engram mode.

## Change

| Field | Value |
|---|---|
| Change | `mercadolibre-api-capabilities-refresh` |
| Artifact store | Hybrid: OpenSpec + Engram |
| OpenSpec archive target | `openspec/changes/archive/2026-06-28-mercadolibre-api-capabilities-refresh/` |
| Final verification | PASS WITH WARNINGS |

## Task Completion Gate

The persisted OpenSpec task artifact has no unchecked implementation tasks. Tasks 1.1 through 4.4 are complete.

The Engram task artifact also records tasks 1.1 through 4.4 as complete.

## Verification Gate

No CRITICAL issues are present in the verification report. Final command evidence records sequential passing runs for:

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`

## Spec Sync Summary

| Domain | Action | Details |
|---|---|---|
| `ml-api-integration` | Already synced / preserved | Main spec already contained the capability classification matrix with more detailed, corrected Questions vs Messages semantics. The archive preserved this newer source-of-truth content instead of replacing it with the broader delta wording. |
| `custom-business-mcp-tools` | Already synced / preserved | Main spec already contained project-owned safe capability exposure and documentation-only official MCP boundaries. |
| `mercadolibre-account-integration` | Already synced / preserved | Main spec already contained MLC account-safe capability read requirements with fail-closed OAuth, allowed seller, site, and mismatch protections. |
| `action-approval-safety` | Already synced / preserved | Main spec already contained capability refresh mutation deferral and approval/audit preservation requirements. |
| `seller-business-insights` | Already synced / preserved | Main spec already contained read-first recommendation evidence requirements with source, freshness, confidence, and partial coverage disclosure. |

No destructive or removing deltas were present. No source-of-truth spec was overwritten during archive.

## Safety Boundary Confirmation

- Existing safe reads remain available.
- New safe reads are limited to category attributes and category technical specs.
- Unknown-support reads remain unavailable.
- Question answer, message reply, and mark-read tools were not added.
- Mutation execution tools were not added.
- Official MercadoLibre MCP remains documentation lookup only.

## Engram Traceability

| Artifact | Observation ID | Topic |
|---|---:|---|
| Proposal | 403 | `sdd/mercadolibre-api-capabilities-refresh/proposal` |
| Spec | 404 | `sdd/mercadolibre-api-capabilities-refresh/spec` |
| Design | 405 | `sdd/mercadolibre-api-capabilities-refresh/design` |
| Tasks | 406 | `sdd/mercadolibre-api-capabilities-refresh/tasks` |
| Verify report | 409 | `sdd/mercadolibre-api-capabilities-refresh/verify-report` |

## Risks / Warnings

- The cumulative uncommitted worktree contains PR1-PR5 stacked slices. Final PR packaging MUST isolate intended slice(s) against the correct base before opening review.
- Historical PR5 verification failed at lint before remediation; current final verification passes.

## Archive Contents Expected

- `proposal.md`
- `design.md`
- `tasks.md`
- `verify-report.md`
- `archive-report.md`
- `specs/`
- `exploration.md` if present in the change folder

## Final Verdict

The SDD cycle is archived with warnings limited to PR packaging risk. Implementation and safety verification are complete.

## Post-Archive Review-Fix Addendum — 2026-06-28

This archive was created before later 4R review fixes. The original archive history above is preserved; the following records the final state after post-archive fixes and focused re-reviews.

### Final Verification Evidence

| Command | Result | Evidence |
|---|---|---|
| `npm test` | PASS | 35 test files passed; 709 tests passed. |
| `npm run typecheck` | PASS | TypeScript checks passed. |
| `npm run lint` | PASS | Lint passed after readability warning fixes. |
| `npm run format:check` | PASS | Format check passed. |
| Fresh focused re-reviews | PASS | Re-reviews passed with no findings after readability warnings were addressed. |

### Post-Archive Fixes Recorded

- MLC-only category/domain guardrails were added for category attributes and category technical specs.
- `siteSupport` and `sellerScope` metadata are preserved for safe-read evidence.
- Controlled degraded read responses are used for known unsupported, blocked, or invalid read paths.
- Valid-empty technical spec responses are handled without treating malformed responses as valid evidence.
- MLC reputation rules are named for readability and reviewability.
- MLC category/domain ID validation helpers are centralized.

### Safety Boundary Reconfirmation

- No mutation execution tools were added.
- No unknown-support reads were added.
- No question answer, message reply, or mark-read tools were added.
- Runtime and MCP exposure remain limited to MLC-confirmed safe reads for category attributes and category technical specs plus pre-existing safe reads.
