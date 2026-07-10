# Apply Progress — PR 2: Validator + Evidence Planner

**Change**: `owned-ecommerce-deepseek-advisor`
**Batch**: PR 2 of 4
**Date**: 2026-07-10

## Completed Tasks

### Task 2.1: MerchandisingAdvisorValidator ✅
- **File**: `packages/agent/src/ecommerce/merchandisingAdvisorValidator.ts` (407 lines)
- **Type**: `validate(result: MerchandisingAdvisorResult): AdvisorValidationResult`
- **6 blocked patterns implemented**:
  1. Superlatives without evidenceIds (best, guaranteed, official, number one, top rated, leading)
  2. Publish/checkout language (publish, activate checkout, go live, make available, enable payments)
  3. Medical/technical claims without evidenceIds (curativo, FDA, ISO, health, certified by, etc.)
  4. Mixed-account cross-references without comparison flag (Plasticov/Maustian)
  5. Invalid targetAgentIds (warns, doesn't block)
  6. Invented stock/margin data (numeric claims without evidenceIds)
- **Safety**: Never throws. `usable: true` only when zero blocked claims.
- **Sanitization**: Strips blocked fields, preserves valid content.

### Task 2.2: EcommerceEvidenceRequestPlanner ✅
- **File**: `packages/agent/src/ecommerce/ecommerceEvidenceRequestPlanner.ts` (163 lines)
- **Class**: `EcommerceEvidenceRequestPlanner` with optional deps (`messageBus?`, `clock?`, `logger?`)
- **Method**: `planRequests(requests, candidateId): EvidenceRequestMessage[]`
- **Deduplication**: SHA-256 hash of `candidateId + targetAgentId + question`
- **Fire-and-forget**: Enqueues via `AgentMessageBusStore` when available; returns structured messages when absent
- **All 5 target agents supported**: cost-supplier, market-catalog, creative-assets, account-brain, supplier-manager

### Task 2.3: Unit Tests ✅
- **Validator tests**: `packages/agent/src/ecommerce/merchandisingAdvisorValidator.test.ts` (374 lines, 17 tests)
- **Planner tests**: `packages/agent/src/ecommerce/ecommerceEvidenceRequestPlanner.test.ts` (315 lines, 13 tests)
- **Total**: 30 tests across both files, 0 real HTTP

## Test Results
```
✓ 5 test files, 93 tests total (all pass)
✓ TypeScript compilation: clean (tsc --noEmit)
✓ 0 real HTTP calls
✓ 0 secrets in code/tests
```

## Remaining Tasks (Phase 3 + 4)
- [ ] 3.1 Wire advisor into `ownedEcommerceIntelligenceService.ts` step 7
- [ ] 3.2 Pass `DeepSeekEnrichment` into `buildProjection`
- [ ] 3.3 Export new classes/types from `index.ts`
- [ ] 3.4 Write integration tests
- [ ] 4.1 Create architecture docs
- [ ] 4.2 Update existing architecture docs

## PR Size Note
Actual implementation is larger than original estimate (~1259 lines vs ~330 estimated). The validator required substantial sanitization logic and 6 pattern checks. Test coverage is comprehensive at 30 scenarios.
