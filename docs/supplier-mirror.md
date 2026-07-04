# Supplier Mirror Rollout

Supplier Mirror mirrors supplier evidence into the CEO workflow without exposing supplier workers or executing broad automation. The first rollout is evidence-first: read supplier data, learn CEO preferences, and propose safe actions before any external mutation.

## Quick path

1. Keep the Supplier Mirror worker disabled until a supplier has an approved source adapter, target policy, and pricing policy.
2. Ingest supplier evidence read-only, then review opportunities through CEO-facing tools.
3. Enable monitoring only after stock authority, confidence thresholds, and target seller IDs are explicit.
4. Allow emergency pause only for verified stock breaks and approved target policies.
5. Keep publication and price updates proposal-only until a later autonomy gate is approved.

## Safety gates

| Gate             | Requirement                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CEO-only UX      | The user speaks only with the CEO; supplier workers stay internal.                                                                                                           |
| Source authority | MercadoLibre API evidence is stock-authoritative; scraper fallback is evidence-only.                                                                                         |
| Targeting        | Supplier Mirror uses explicit target policies and does not reuse the Plasticov→Maustian guard.                                                                               |
| Mutations        | No blind publishing or price mutation. Emergency pause requires verified stock break, approved policy, ledger, and CEO notice.                                               |
| Learning         | User answers and notification suppressions are saved as local fallback lessons before broader autonomy.                                                                      |
| Cost/cache       | DeepSeek V4 Flash is the default for routine supplier extraction/classification; V4 Pro is reserved for hard policy conflicts with ledgered reason and token/cache evidence. |

## Supplier onboarding checklist

- [ ] Register supplier with an enabled source adapter.
- [ ] Confirm stock-authoritative source and fallback evidence boundaries.
- [ ] Record target seller IDs for Plasticov, Maustian, or both.
- [ ] Approve pricing policy (`x2`, `x3`, `x4`, fixed CLP uplift, or learned policy proposal).
- [ ] Review first notification events with the CEO and record suppressions if requested.
- [ ] Verify cost/cache evidence before high-volume DeepSeek use.

## Staged autonomy

| Stage             | Allowed behavior                                                                                         | Out of scope                   |
| ----------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1. Evidence       | Read supplier items, stock observations, mappings, policies, notifications, and cost/cache evidence.     | External mutations.            |
| 2. Proposals      | Prepare pricing, publishing, mapping, and policy proposals for CEO approval.                             | Blind publish or price update. |
| 3. Verified pause | Pause mapped target listings only after verified stock break, policy membership, ledger, and CEO notice. | Broad autonomous sync.         |
| 4. Learned policy | Propose deterministic policies from repeated CEO answers and saved fallback lessons.                     | Self-approved autonomy.        |

## Stacked PR verification

- PR 1: domain and operational store.
- PR 2: API-first supplier source adapters and isolated fallback evidence.
- PR 3a: disabled-by-default worker foundation.
- PR 3b: stock-break monitor and safe pause planning.
- PR 4: CEO tools and deterministic pricing policy proposals.
- PR 6 final slice: Cortex fallback learning foundations, DeepSeek cost/cache evidence, and rollout documentation.

Run focused tests for the changed package, then `npm run typecheck`, `npm run lint`, and `npm run format:check` before review.
