# Proposal: MercadoLibre API Capabilities Refresh

## Intent

Refresh MSL's MercadoLibre capability model so the agent can reason from a documented, project-owned, read-first API surface before seller-impacting actions. The first slice improves evidence without expanding mutations.

## Scope

### In Scope
- Classify documented API areas as `docs-only`, `safe-read`, `prepare-only`, or `future-execute-with-approval`.
- Define read-first coverage for listing quality, category attributes/specs, pictures, shipping, visits/metrics, reputation, questions, and messages.
- Preserve fail-closed OAuth, allowed MLC sellers, account boundaries, freshness/confidence metadata, approvals, and audit expectations.

### Out of Scope
- No official MercadoLibre MCP execution; it remains documentation lookup only.
- No direct seller-impacting mutation execution by default.
- No broad promotions, billing, complaints, coupons, discounts, or advanced reporting beyond matrix classification.
- No answer-question, listing-edit, catalog-fix, promotion, or sync execution slice.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `ml-api-integration`: classify API coverage and add read-first boundaries.
- `custom-business-mcp-tools`: expose only project-owned safe reads/prepared actions.
- `mercadolibre-account-integration`: preserve direct API, OAuth, MLC seller, and mismatch protections.
- `action-approval-safety`: keep mutations/public actions prepared and approval/audit-gated.
- `seller-business-insights`: improve evidence sources and confidence metadata for recommendations.

## Approach

Use exploration Approach 1: capability inventory plus read/validation foundations. Protect the 400-line review budget by separating matrix/spec work from endpoint/tool expansion and deferring mutations.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/specs/ml-api-integration/spec.md` | Modified | Matrix and read-first API boundaries. |
| `openspec/specs/custom-business-mcp-tools/spec.md` | Modified | Safe custom tool exposure rules. |
| `openspec/specs/mercadolibre-account-integration/spec.md` | Modified | OAuth/seller protection. |
| `openspec/specs/action-approval-safety/spec.md` | Modified | Mutation deferral and approval/audit boundaries. |
| `openspec/specs/seller-business-insights/spec.md` | Modified | Evidence/freshness expectations. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Scope exceeds review budget | Med | First slice is spec/matrix/read-first only; later tasks should chain PRs. |
| Official MCP mistaken for executor | Low | Repeat docs-only boundary in affected specs. |
| MLC endpoint support varies | Med | Require site support and partial/confidence metadata. |
| Mutation pressure returns too early | Med | Defer writes to prepared-action specs with approval/audit gates. |

## Rollback Plan

Revert this change folder and resulting delta specs. No runtime behavior changes are introduced.

## Dependencies

- Existing OAuth, allowed-seller, custom tool, approval, and audit boundaries.
- Current MercadoLibre documentation lookup through official MCP as reference only.

## Success Criteria

- [ ] Specs can derive an explicit capability matrix without adding execution paths.
- [ ] First implementation slice can remain reviewable near the 400-line budget.
- [ ] Future mutation work is clearly separated into prepared-action slices.
