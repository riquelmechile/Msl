# Apply Progress: Creative Budget Reservations and Generation Attempts

Mode: Standard. Delivery: auto-chain, stacked-to-main. Current slice: A / PR1.

## Completed

- [x] A.1-A.3: branded micros and reservation/attempt/send-proof domain contracts.
- [x] A.4-A.5: standalone canonical creative v4 DDL, indexes, FK/CHECK predicates, and exact sqlite_master/table/FK/index PRAGMA ownership proof.
- [x] A.6: focused money and migration coverage.

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused tests | `npx vitest run packages/domain/src/money.test.ts packages/creative-studio/src/__tests__/creativeDurabilityMigration.test.ts` -> 2 files, 23 tests passed |
| Planned slice command | `npx vitest run packages/domain/src/money.test.ts packages/creative-studio/src/__tests__/` -> 12 files, 162 tests passed |
| Migration harness | Focused migration suite above -> 3 tests passed: fresh/legacy/idempotent, ownership +/-, FK and state CHECKs |
| Static/format/diff | `npm run typecheck`, `npm run lint`, targeted `npx prettier --check ...`, and `git diff --check` -> exit 0 |
| Rollback boundary | Revert `package-lock.json`, `packages/creative-studio/package.json`, `packages/creative-studio/tsconfig.json`, `packages/creative-studio/src/index.ts`, `packages/domain/src/{index.ts,money.ts,money.test.ts}`, and new `packages/creative-studio/src/{domain/budgetReservation.ts,domain/generationAttempt.ts,infrastructure/storage/creativeDurabilityMigration.ts,__tests__/creativeDurabilityMigration.test.ts}`; remove creative v4 types/schema while preserving bus v1-v3 and existing database tables/history. |

## Remaining

B.1-B.4, C.1-C.5, D.1-D.3, E.1-E.5, F.1-F.4, G.1-G.6 remain pending (27/33); no later-slice runtime wiring was implemented.
