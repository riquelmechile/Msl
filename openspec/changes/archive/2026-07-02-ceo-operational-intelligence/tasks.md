# Tasks: CEO Operational Intelligence Bridge

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 300–350 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

Not needed — change fits comfortably in a single PR.

## Phase 1: Operational Data Source (Foundation)

- [x] 1.1 Create `packages/agent/src/conversation/operationalDataSource.ts`: `OperationalDailyDataSource` class implementing `DailyDataSource`. `getCategoryStats()`, `getMonthlyVolume()`, `getReputation()` each call `reader.readSnapshot<T>()` with the corresponding `snapshotKind`. Return typed data parsed from `data_json`; include `captured_at` from evidence. Graceful fallback to default/empty values when `readSnapshot` returns null.

- [x] 1.2 Create `packages/agent/tests/conversation/operationalDataSource.test.ts`: mock `OperationalReadModelReader` returning snapshot arrays per kind. Test category stats populated from mock data, volume summed correctly, reputation fields mapped. Test null-snapshot fallback.

## Phase 2: Operational Evidence Provider (Core)

- [x] 2.1 Create `packages/agent/src/conversation/operationalEvidenceProvider.ts`: `OperationalEvidenceProvider` class. Hardcoded `Map<string, BusinessSignalKind[]>` mapping `requiredEvidenceKinds` strings to `BusinessSignalKind[]` (~9 entries: cost→[listing,order], supplier→[listing], margin→[pricing], catalog→[listing,order,claim], stock→[stock], market→[pricing,product-ads-insights], product→[listing], campaign→[product-ads-insights], outcome→[order,claim]). `getEvidenceForLane(laneId, sellerId)` queries `reader.findEvidence()` per signal kind, formats compact lines: `"[kind] evt-42 captured=2026-07-02T10:00:00Z (fresh, 3h ago)"`. Unknown lane → empty string, no errors.

- [x] 2.2 Create `packages/agent/tests/conversation/operationalEvidenceProvider.test.ts`: test cost lane returns listing+order evidence, unknown lane returns empty, no-data returns empty, freshness age calculation, compact formatting per spec scenarios.

## Phase 3: Agent Loop Integration (Wiring)

- [x] 3.1 Modify `packages/agent/src/conversation/agentLoop.ts` — `buildMessages()`: add optional `blockC?: string` parameter. When provided, inject into user message: `blockC ? \`${userMessage}\n\n${blockC}\` : userMessage`. Recalculate token budget with blockC included.

- [x] 3.2 Modify `packages/agent/src/conversation/agentLoop.ts` — `AgentLoopConfig`: add `operationalReader?: OperationalReadModelReader`, `evidenceProvider?: OperationalEvidenceProvider`, `laneId?: LaneId`. Import `injectCortexContext` from cacheBlocks.

- [x] 3.3 Modify `packages/agent/src/conversation/agentLoop.ts` — `converse()` and `converseStream()`: after `getSystemPrompt()`, build `blockC` by combining Cortex context (`config.engine ? injectCortexContext(userMessage, config.engine) : ""`) + operational evidence (`config.evidenceProvider && config.laneId ? await config.evidenceProvider.getEvidenceForLane(config.laneId, sellerId) : ""`). Pass to `buildMessages(systemPrompt, state, userMessage, blockC)`.

- [x] 3.4 Add unit tests in `packages/agent/tests/conversation/agentLoop.test.ts`: verify `buildMessages` with `blockC` injects into user content, without `blockC` preserves existing behavior, token budget still enforced.

## Phase 4: Testing & Verification

- [x] 4.1 Integration test in `packages/agent/tests/conversation/operationalDataSource.test.ts`: create in-memory SQLite DB via `createSqliteOperationalReadModel`, insert snapshot rows, verify `OperationalDailyDataSource` reads real data.

- [x] 4.2 Run `npm test && npm run typecheck && npm run lint` — verify no regressions in existing suite.
