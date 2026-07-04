# Supplier Mirror Rollout

Supplier Mirror mirrors supplier evidence into the CEO workflow without exposing supplier workers or executing broad automation. The first rollout is evidence-first: read supplier data, learn CEO preferences, and propose safe actions before any external mutation.

## Quick path

1. Keep the Supplier Mirror worker disabled until a supplier has an approved source adapter, target policy, and pricing policy.
2. Ingest supplier evidence read-only, then review opportunities through CEO-facing tools.
3. Enable monitoring only after stock authority, confidence thresholds, and target seller IDs are explicit.
4. Allow emergency pause only for verified stock breaks and approved target policies.
5. Keep publication and price updates proposal-only until a later autonomy gate is approved.

## Jinpeng dry-run bootstrap

Run the Jinpeng bootstrap as an admin/operator smoke path before any runtime enablement decision. It opens only the SQLite database named by env, writes local disabled seed/readiness evidence, and prints a redacted report.

```bash
MSL_SUPPLIER_MIRROR_DB_PATH=/absolute/path/to/supplier-mirror.sqlite \
MSL_JINPENG_ML_SELLER_ID=<operator-provided seller id> \
MSL_JINPENG_XKP_URL=https://www.xkp.cl/products \
npm run supplier-mirror:jinpeng:dry-run
```

### Required and optional env

| Env                                                         | Required for ready report | Notes                                                                    |
| ----------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| `MSL_SUPPLIER_MIRROR_DB_PATH`                               | Yes                       | Explicit SQLite path. The script has no default DB path.                 |
| `MSL_JINPENG_ML_SELLER_ID` or `MSL_JINPENG_ML_NICKNAME`     | Yes                       | Supplier identity evidence; values stay in runtime env/operator records. |
| `MSL_JINPENG_ML_PROFILE_URL`                                | No                        | Optional supporting identity evidence.                                   |
| `MSL_JINPENG_XKP_URL`                                       | Yes                       | Enrichment source URL only; XKP is not stock authority.                  |
| `MSL_MAUSTIAN_SELLER_ID`                                    | No                        | Defaults to `maustian` if omitted. Use real seller ID outside git.       |
| `MSL_PLASTICOV_SELLER_ID`                                   | No                        | Defaults to `plasticov` if omitted. Use real seller ID outside git.      |
| `MELI_ACCESS_TOKEN`, `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET` | Yes for ready report      | Presence is reported; secret values are not stored or printed.           |

### What the operator/CEO reviews

- `readinessReport.status`: `blocked` means missing credentials/source decisions; `ready-for-ceo-decision` still requires explicit CEO approval before runtime.
- `missingCredentials` and `missingSourceInfo`: resolve these outside git and rerun the dry-run.
- `targetProposals`: Maustian uses proposed `x2.5` owned/improved titles and descriptions; Plasticov uses proposed `x2`. Both remain proposals requiring CEO confirmation.
- `ledgerIds`: stable local evidence for skipped validation, target proposals, and blocked/deferred enablement.
- `safety`: confirm `noMutationExecuted: true`, `workerEnabled: false`, and all external mutation flags are `false`.

### Safety boundaries

- The dry-run does not publish listings, pause listings, update prices, enable the worker, store secrets, or call external APIs.
- MercadoLibre remains the stock authority. XKP enrichment may support catalog/spec/photo/description context but MUST NOT override ML stock evidence.
- Runtime workers remain disabled unless `MSL_SUPPLIER_MIRROR_WORKER_ENABLED=true` and stored Jinpeng readiness has been explicitly approved after CEO confirmation.

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
