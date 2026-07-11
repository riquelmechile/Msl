# Idempotency Policy — Supersede, Reverse, Source Update Handling

## Idempotency Key

Every cost component insert is idempotent. The deduplication key is:

```
sellerId + source + sourceRecordId + economicMeaning + sourceVersion
```

| Field | Source | Example |
|-------|--------|---------|
| `sellerId` | From normalized transaction | `"plasticov"` |
| `source` | Adapter data source | `"mercadolibre"` |
| `sourceRecordId` | ML entity identifier | `"2000006234567890"` (order ID) |
| `economicMeaning` | What this cost represents | `"marketplace_fee"` |
| `sourceVersion` | Version/staleness tracking | `"v1.0.20260711"` or checksum |

## Insert Behavior

| Scenario | Behavior |
|----------|----------|
| New component (key doesn't exist) | Insert new row |
| Exact duplicate (same key, no version change) | No-op, return existing |
| Newer version (same key, higher sourceVersion) | Supersede old + insert new |
| Same version, different data (shouldn't happen with proper versioning) | Log warning, supersede |

## Supersede Mechanism

When a newer version arrives for an existing cost component:

1. Old row: `superseded_at = now()` (not deleted, not reversed)
2. New row: inserted with new `sourceVersion` and updated values
3. Old row remains queryable for audit/history (use `includeReversed` or query by sourceRecordId)
4. `listCostComponents` excludes superseded rows by default

## Reverse (Soft-Delete)

Cost components are NEVER hard-deleted. Instead:

```
reverseCostComponent(id: string, reason: string)
  → sets reversed_at = now()
  → sets reversed_reason = provided reason
  → DOES NOT delete the row
```

Reversed components:
- Are excluded from `listCostComponents()` by default
- Can be included with `includeReversed: true`
- Remain queryable via `listBySourceRecord`
- The reversal is logged with reason for audit trail

## Source Update Handling

When source data changes (e.g., ML corrects a fee amount):

1. A new version arrives with updated data
2. The old version is superseded (kept for history)
3. The new version becomes the active record
4. All old snapshots keep their original cost data (snapshots are immutable)
5. A re-ingestion will create new snapshots with the corrected data

## Reingestion Safety

Re-running ingestion for the same seller:
- New run creates new cost components with potentially new sourceVersions
- Existing components with same key + same version are no-ops
- No data is lost — superseded and reversed components are preserved
- Reingestion is safe to run repeatedly
