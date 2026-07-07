# deep-evidence-query Specification

## Purpose

Rich-filter snapshot search with composable SQL-level and JSON-path filters, returning full data payloads ordered by capture recency.

## Requirements

### Requirement: Rich Snapshot Search

`OperationalReadModelReader.searchSnapshots<TData>(query)` MUST accept the following filters, all optional and composable (applying multiple filters narrows results):

| Filter | Type | Column | Description |
|--------|------|--------|-------------|
| `sellerId` | `string` | `seller_id` | Seller identifier (required) |
| `kind` | `string[]` | `kind` | Snapshot kind(s); multi-kind via `IN` |
| `status` | `string` | `data_json → .status` | `json_extract` filter |
| `categoryId` | `string` | `data_json → .category_id` | `json_extract` filter |
| `itemId` | `string` | `item_id` | Exact match |
| `priceMin` | `number` | `data_json → .price` | `json_extract` >= value |
| `priceMax` | `number` | `data_json → .price` | `json_extract` <= value |
| `capturedAfter` | `string` | `captured_at` | ISO-8601; >= value |
| `capturedBefore` | `string` | `captured_at` | ISO-8601; <= value |
| `freshness` | `'fresh' \| 'allow-stale'` | `freshness` | Post-query freshness match |
| `limit` | `number` | — | Default: 100 |

Results MUST include the full `data` payload and be ordered by `captured_at DESC`. The method MUST build a dynamic SQL `WHERE` clause combining table-column filters; JSON-path filters (status, categoryId, priceMin, priceMax) SHALL use `json_extract`. Freshness SHALL apply post-query using the operational freshness logic (`fresh` → `complete && fresh && confidence !== "low"`; `allow-stale` → always matches).

#### Scenario: Multi-kind search with date range

- GIVEN snapshots for `["listing", "order"]` captured within the last 48h
- WHEN `searchSnapshots({ sellerId: "S1", kind: ["listing", "order"], capturedAfter: "2026-07-05T00:00:00Z" })` is called
- THEN results MUST include only listing and order snapshots captured at or after that timestamp

#### Scenario: Status filter combined with price range

- GIVEN listing snapshots with mixed statuses and prices
- WHEN `searchSnapshots({ sellerId: "S1", kind: ["listing"], status: "active", priceMin: 1000, priceMax: 50000 })` is called
- THEN SQL SHALL use `json_extract(data_json, '$.status')` and `json_extract(data_json, '$.price')`
- AND results MUST only contain active listings priced between 1000 and 50000

#### Scenario: Default limit

- GIVEN more than 100 matching snapshots
- WHEN `searchSnapshots` is called without an explicit limit
- THEN exactly 100 results MUST be returned

#### Scenario: Freshness filter respects operational logic

- GIVEN snapshots with mixed freshness, completeness, and confidence
- WHEN `searchSnapshots({ sellerId: "S1", freshness: "fresh" })` is called
- THEN results MUST exclude any row where freshness != "fresh" OR completeness != "complete" OR confidence === "low"

#### Scenario: Composable filters converge

- GIVEN snapshots across multiple sellers, kinds, and date ranges
- WHEN three filters are applied simultaneously (e.g., kind + capturedAfter + status)
- THEN results MUST match all three conditions (AND semantics)

#### Scenario: No matching results

- GIVEN no snapshots match the search criteria
- WHEN `searchSnapshots(...)` is called
- THEN it MUST return an empty array (not null, not throw)
