## Exploration: Converge MLC Read Snapshots

### Current State
`@msl/domain` owns the canonical `ReadSnapshot<TData>`, `CacheFreshness`, freshness policy helpers, and reliability helpers. `@msl/memory` already consumes `ReadSnapshot` from `@msl/domain`, while `@msl/mercadolibre` defines parallel `MlcReadSnapshot*` types with the same shape and a duplicated freshness-risk mapping. `@msl/tools` currently returns `MlcReadSnapshot<TData>` from `@msl/mercadolibre`, so the public read-tool behavior is correct but the vocabulary can drift.

### Affected Areas
- `packages/domain/src/readSnapshot.ts` — canonical snapshot type and aliases already exist; likely no behavior change needed.
- `packages/domain/src/cacheFreshness.ts` — canonical freshness source/risk/status vocabulary and `evaluateFreshness` should be reused by MLC instead of duplicating risk windows.
- `packages/mercadolibre/src/index.ts` — local `MlcReadSnapshot*` types and `createFreshness` are the direct convergence target.
- `packages/mercadolibre/package.json` — needs a dependency on `@msl/domain` if MLC imports canonical types/helpers.
- `packages/mercadolibre/tsconfig.json` — should add a project reference to `../domain` for TypeScript build ordering.
- `packages/mercadolibre/src/mercadolibre.test.ts` — existing metadata tests should continue to prove normalized snapshots match source/freshness/confidence expectations.
- `packages/tools/src/index.ts` — can remain source-compatible through `MlcReadSnapshot` aliases, or optionally import domain `ReadSnapshot` directly if the design chooses to expose only domain vocabulary.
- `tests/tools/tools.integration.test.ts` — fixture type imports may remain via the MLC alias or be updated to `ReadSnapshot` to prove cross-package convergence.
- `package-lock.json` — dependency metadata will change when `@msl/mercadolibre` gains `@msl/domain`.
- `openspec/changes/archive/2026-06-25-mlc-read-tools-foundation/verify-report.md` — documents the current warning this follow-up addresses.

### Approaches
1. **Alias MLC snapshots to narrowed domain snapshots** — Add a one-way `@msl/mercadolibre -> @msl/domain` dependency, define `MlcReadSnapshot<TData>` as a narrowed alias/intersection of `ReadSnapshot<TData>`, and reuse `evaluateFreshness` for `mercadolibre-api` snapshots.
   - Pros: Removes duplicated vocabulary and freshness policy while preserving current MLC-specific exported names for callers.
   - Cons: Adds a domain dependency to `@msl/mercadolibre`; tests should explicitly guard the alias behavior to avoid accidental widening.
   - Effort: Low

2. **Expose only domain `ReadSnapshot` from tools** — Update `MlcApiClient`, `MlcReadTools`, and integration fixtures to use `ReadSnapshot<TData>` directly and remove most MLC snapshot aliases.
   - Pros: Strongest vocabulary convergence and less naming duplication.
   - Cons: Larger public API churn; loses useful MLC-specific semantic names such as `MlcListingsSnapshot`; higher review noise for little behavior gain.
   - Effort: Medium

3. **Keep structural compatibility and add type-level tests** — Keep `@msl/mercadolibre` independent from `@msl/domain`, but add compile-time checks documenting assignability.
   - Pros: No new package dependency and minimal code change.
   - Cons: Does not remove the parallel vocabulary or duplicated freshness policy; the archived warning would remain mostly unresolved.
   - Effort: Low

### Recommendation
Use **Approach 1** under the change name `converge-mlc-read-snapshots` as an **architecture cleanup/refactor**. The dependency direction is acceptable: `@msl/domain` remains dependency-free and infrastructure/API-boundary packages may depend inward on domain vocabulary. Keep MLC-specific alias names for compatibility, but source their shape from `ReadSnapshot`, `CacheFreshness`, and `evaluateFreshness`. This should comfortably fit under the 400-line review budget because the likely implementation is limited to package metadata, a few type/helper edits, and focused tests.

### Risks
- Adding `@msl/domain` as a runtime dependency to `@msl/mercadolibre` is safe only if `@msl/domain` stays dependency-free and does not import MLC code later.
- Narrowing `MlcReadSnapshot` to `mercadolibre-api` source must not accidentally make local-cache snapshots appear valid for MLC reads.
- Lockfile/package dependency changes add review noise; keep the code slice small and avoid unrelated cleanup.
- If tests import from package source paths instead of package exports, fixture updates can hide package-boundary issues; prefer at least one test proving compatibility through exported types.

### Ready for Proposal
Yes — propose a small architecture cleanup/refactor named `converge-mlc-read-snapshots` that converges `@msl/mercadolibre` snapshot aliases onto `@msl/domain` `ReadSnapshot`/freshness vocabulary while preserving current read-tool behavior and staying below the 400-line review budget.
