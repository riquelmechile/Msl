# Proposal: Converge MLC Read Snapshots

## Intent

Resolve the prior verification warning that `@msl/mercadolibre` maintains parallel read-snapshot/freshness vocabulary beside canonical `@msl/domain` `ReadSnapshot`. Reduce drift risk while preserving read-tool behavior and MLC-specific exported names where possible.

## Scope

### In Scope
- Source MLC snapshot aliases from domain `ReadSnapshot`, `CacheFreshness`, and freshness helpers.
- Add the minimal `@msl/mercadolibre` dependency/reference on `@msl/domain` needed for build order and imports.
- Keep listing/order/message/reputation snapshots behavior-compatible, with focused alias/metadata tests.

### Out of Scope
- Changing runtime read-tool behavior, OAuth/access checks, approval rules, or API transport behavior.
- Removing public MLC-specific aliases unless unavoidable.
- Adding persistence, UI, write tools, or broad package cleanup.

## Capabilities

### New Capabilities
- None — this is a refactor of existing read snapshot implementation vocabulary.

### Modified Capabilities
- None — `business-memory-cache`, `custom-business-mcp-tools`, and `mercadolibre-account-integration` requirements remain unchanged.

## Approach

Use exploration Approach 1: make `@msl/mercadolibre` depend inward on `@msl/domain`, define MLC snapshot exports as narrowed aliases/intersections of domain snapshots, and replace duplicated freshness-risk mapping with `evaluateFreshness`. Keep `mercadolibre-api` as the source constraint so local-cache snapshots are not accepted as MLC API reads.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/index.ts` | Modified | Converge snapshot types/helpers onto domain vocabulary. |
| `packages/mercadolibre/package.json` | Modified | Add `@msl/domain` workspace dependency. |
| `packages/mercadolibre/tsconfig.json` | Modified | Add project reference to `../domain`. |
| `packages/mercadolibre/src/mercadolibre.test.ts` | Modified | Guard normalized metadata and alias compatibility. |
| `packages/tools/src/index.ts` | Modified | Preserve source-compatible read-tool return types if needed. |
| `tests/tools/tools.integration.test.ts` | Modified | Optionally prove cross-package compatibility through exports. |
| `package-lock.json` | Modified | Reflect workspace dependency metadata. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Dependency direction regresses | Low | Keep one-way import: MLC imports domain, never reverse. |
| Alias narrowing rejects valid MLC snapshots | Med | Test listing/order/message/reputation snapshots and exported aliases. |
| Review noise exceeds budget | Low | Limit to dependency metadata, type/helper edits, and focused tests. |

## Rollback Plan

Revert implementation changes: remove the MLC dependency/reference on `@msl/domain`, restore local MLC snapshot/freshness definitions, and restore lockfile metadata. Existing read-tool behavior should remain available because this is vocabulary convergence only.

## Dependencies

- Existing canonical `@msl/domain` snapshot and freshness exports.
- Existing read-tool tests and package build/typecheck scripts.

## Success Criteria

- [ ] MLC-specific exported snapshot names remain usable while deriving shape from domain vocabulary.
- [ ] Duplicated MLC freshness-risk mapping is removed or delegated to domain helpers.
- [ ] Tests/typecheck prove read-tool metadata behavior remains unchanged.
- [ ] Implementation remains under the 400 changed-line review budget.
