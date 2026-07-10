# Proposal: account-assets-strategic-memory

## Intent

Strategic stores (Cortex, strategies, autonomy, consensus, lessons, approvals) lack `seller_id` — Plasticov and Maustian patterns contaminate each other. The CEO can't answer "which account maximizes profit?" Add `seller_id` to every strategic store, `AccountAsset` domain model, per-account context to every daemon.

## Scope

**In**: 10-store `seller_id` migrations (idempotent, `'unknown'` defaults), `AccountAsset`/`AccountCapability`/`MemoryScope` types, `AccountAssetStore`, Cortex API scoping, autonomy per-seller, daemon per-seller iteration, approval per-account "dale", AgentLoop account context, 12 tests, architecture doc.

**Out**: Secrets, ML API calls, VPS, MercadoLibre writes, CEO dashboard UI, agent work-sessions, repo refactor, memory deletion.

## Capabilities

### New
- `account-asset-model` — `AccountAsset`, `AccountCapability`, `AccountHealthSnapshot`, `AccountStrategy`, `AccountRisk`, `MemoryScope`
- `account-asset-store` — SQLite store for account strategic state, seed data

### Modified
| Capability | Change |
|-----------|--------|
| `neural-graph-memory` | `seller_id` on nodes; scoped Hebbian/spreading/Darwinian |
| `autonomy-engine` | Singleton → per-seller `(seller_id)` |
| `agent-consensus` | `seller_id` on `agent_reviews` |
| `learning-pipeline` | `seller_id` on `company_agent_lessons` |
| `action-approval-safety` | `seller_id` on approval/audit tables; per-account "dale" |
| `daemon-scheduler` | Per-seller account context in daemon input |
| `conversational-business-agent` | AgentLoop wired with account capabilities/outcomes |

## Approach

Backward-compatible: `ALTER TABLE ADD COLUMN seller_id TEXT DEFAULT 'unknown'` (idempotent). Column scoping complements existing file-level bot isolation — additive safety. `MemoryScope`: `seller_id` column, `NULL` = global. AutonomyEngine migrates singleton to `(seller_id)` key; current level → `'default'` seller. Daemons iterate `sellerIds` scoping queries (pattern: `backgroundIngestion`). Phased: Foundation → Cortex → Agents → Approvals → Learning → Tests/docs.

## Risks

| Risk | Mitigation |
|------|-----------|
| Backfill `'unknown'` for existing data | Accept; new writes scoped |
| 2085 tests break on `sellerId` params | Controlled fixture update; tests already inject `sellerId` |
| Autonomy singleton → per-seller | Preserve current level as `'default'`; auto-migrate |

## Rollback

Revert code → `sellerId` params optional → global behavior restored. Bot file-level isolation untouched. No destructive ALTER.

## Delivery

**Estimate**: 1500–2500 lines, ~35–40 files. **Strategy**: Feature Branch Chain, 4 PRs → `feat/account-assets-strategic-memory`.

| PR | Focus | ~Lines |
|----|-------|--------|
| PR1 | Domain types + 9 store migrations | 500 |
| PR2 | Cortex `seller_id` + engine scoping + Darwinian | 600 |
| PR3 | Daemon iteration + autonomy per-seller + approval | 500 |
| PR4 | AccountAssetStore + 12 tests + architecture + audit | 500 |

CI: 2085 Vitest suite green per PR.

## Success Criteria

- [ ] 10 stores have `seller_id` with `'unknown'` defaults
- [ ] `AccountAsset`, `AccountCapability`, `MemoryScope` types exist
- [ ] Cortex `createNode`/`spread`/`traverse` accept `sellerId`
- [ ] AutonomyEngine loads per-seller state
- [ ] Daemons iterate sellerIds; findings scoped
- [ ] "dale" resolves per bot's configured seller
- [ ] 12 scenarios pass; 2085 suite green
- [ ] Architecture doc + audit addendum present
