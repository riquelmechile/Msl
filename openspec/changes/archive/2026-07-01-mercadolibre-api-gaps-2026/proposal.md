# Proposal: MercadoLibre API Gaps 2026

## Intent

Add typed coverage for 3 ML API gaps from 2025-2026 docs. The `@msl/mercadolibre` client covers 27 endpoints; these gaps complete the known read surface for proactive monitoring plus one prepare-only mutation.

## Scope

### In Scope (Slice 1 — ~200 lines)
- `GET /moderations/last_moderation/{id}` — image moderation status (`safe-read`)
- `GET /communications/notices` — seller notices with pagination, tags, categories (`safe-read`)
- `POST /answers` — draft answer to buyer question (`prepare-only`)

### Out of Scope (deferred)
- Claims search/detail — Slice 2 (~200 lines)
- Shipping status — Slice 2 (~100 lines)
- Image orchestration flow — Slice 3 (spec-only)
- Brand Protection Program — `docs-only`
- MCP tool wiring — Slice 2+

## Capabilities

### New Capabilities
- `ml-notices`: Read seller communications with pagination, tags, and category metadata
- `ml-moderation-status`: Check image moderation result by reference ID post-upload
- `ml-questions-answer`: Prepare-only answer to buyer questions via `POST /answers`

### Modified Capabilities
- `ml-api-integration`: Add 3 matrix entries (docs evidence, MLC support, runtime surface)

## Approach

Per-endpoint pattern: summary type → `MlcReadSnapshot<T>` → normalizer → client method (OAuth + seller scope). `POST /answers` as prepare-only, execution blocked. Reuse `pushOptional`/`asArray`/`asRecord` helpers.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/index.ts` | Modified | 3 client methods + normalizers |
| `packages/mercadolibre/src/types.ts` | Modified | Moderation + notices base types |
| `openspec/specs/ml-api-integration/spec.md` | Modified | 3 new matrix entries |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Notices shape differs integrator vs seller token | Medium | Model both as optional fields (`dismiss_key?`, `title?`) |
| Moderation reference ID source unclear | Low | Extend `getItem` to expose moderation data if needed |
| Claims complexity spills into next slice | Medium | Isolated to Slice 2, zero coupling |

## Rollback Plan

Revert commit. Safe-reads have no side effects. Prepare-only question answer has no execution path.

## Dependencies

None. All additive to existing client.

## Success Criteria

- [ ] `getModerationStatus` returns typed `MlcModerationSnapshot`
- [ ] `getNotices({ limit, offset })` returns typed paginated `MlcNoticesSummary`
- [ ] `answerQuestion({ question_id, text })` returns prepare-only typed response
- [ ] Pass `npm run typecheck` and `npm test`

---

## Proposal Question Round

Before finalizing, confirm:

1. **Slice 1 scope**: moderation + notices + questions-answer (~200 lines, under 400-line budget). Or bundle all 4 safe-reads (~450 lines, needs single chained PR)?
2. **Notices noise**: Return full feed (alerts + promotions + releases) and let tool/agent filter, or pre-filter to actionable alert categories only?
3. **Questions answer**: Confirm `prepare-only` — typed client method only, execution path wired later through approval pipeline.
