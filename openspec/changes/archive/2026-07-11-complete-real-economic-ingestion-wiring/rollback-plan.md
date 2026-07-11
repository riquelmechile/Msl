# Rollback Plan: Complete Real Economic Ingestion Wiring

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CLI changes break existing tests | Low | Low | Tests rewritten to use fake factory |
| New RunStore migration fails | Low | Medium | Uses existing migration framework, tested |
| Factory breaks daemon | Low | Medium | Isolated construction, override support |
| Real smoke test fails (ML API) | Medium | Low | Read-only, dry-run first, limited scope |
| PII leak in new persistence | Low | Critical | Existing normalization, policy review |

## Rollback Triggers

Immediate rollback if:
- Any ML write operation is detected
- PII appears in persisted data
- Tests fail after changes
- Build fails after changes
- Economic DB corruption detected

## Rollback Procedure

### Code Rollback
```bash
git checkout main  # HEAD was 6fd769f before changes
# All changes are in new commits, so git revert or reset works
```

### Data Rollback
```bash
# Restore economic DB from pre-smoke backup
cp $ECONOMIC_DB_PATH.bak.$TIMESTAMP $ECONOMIC_DB_PATH
# EconomicIngestionRunStore tables only exist in the economic DB
# No other databases are modified
```

### No Infrastructure Changes
- No new services, ports, or processes
- No new dependencies
- No ML webhooks or subscriptions
- No database migrations outside economic DB

## Pre-Flight Safety

Before each phase of the real smoke test:
1. Verify `.env.local` is ignored
2. Verify working tree is clean
3. Create economic DB backup
4. Confirm zero concurrent economic processes
5. Run with `--dry-run --no-persist` first
6. Only proceed to persist after dry-run succeeds

## Post-Change Verification

After all changes and smoke test:
```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```
All must pass before push.
