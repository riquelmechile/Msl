# Exploration: MercadoLibre API Gaps 2026 — Slice 2

**Date**: 2026-07-01
**Trigger**: Combined explore + propose for Slice 2, building on archived Slice 1

---

## Current State

Slice 1 (archived 2026-07-01) added 3 ML API capabilities to `MlcApiClient`:

| Capability | Classification | Endpoint | Status |
|-----------|---------------|----------|--------|
| Image moderation status | `safe-read` | `GET /moderations/last_moderation/{id}` | ✅ Implemented |
| Communications / notices | `safe-read` | `GET /communications/notices` | ✅ Implemented |
| Questions answer | `prepare-only` | `POST /answers` | ✅ Implemented |

The client now covers 30 endpoints. 917 tests pass, typecheck clean. All Slice 1 capabilities exist at the client layer (`createMlcReadMethods`) with full types, normalizers, and OAuth support. However, NONE of the Slice 1 capabilities are wired as MCP tools — they're accessible only through direct client calls.

### Existing Image Flow Pieces (all exist post-Slice 1)

| Step | Method | Endpoint |
|------|--------|----------|
| 1. Diagnose | `diagnoseImage()` | `POST /moderations/pictures/diagnostic` |
| 2. Upload | `uploadImage()` | `POST /pictures/items/upload` |
| 3. Associate | `updateItem()` (on `MlClient`, not `MlcApiClient`) | `PUT /items/{id}` |
| 4. Check moderation | `getModerationStatus()` (Slice 1) | `GET /moderations/last_moderation/{id}` |

The GAP: no typed/orchestrated flow binding these 4 steps together, and step 3 (associate) is only on the older `MlClient` type, not on `MlcApiClient`.

---

## Gap Analysis: Slice 2

### Gap 1: Claims / Mediations — `GET /post-purchase/v1/claims/search`

**Documentation**: [Working with Claims](https://developers.mercadolibre.com/en_us/working-with-claims), last updated 2024-05-06. **CONFIRMED** — full endpoint documentation with response shapes, filtering, sorting, and sub-resources.

**Endpoints**:
| Method | Path | Purpose | Classification |
|--------|------|---------|----------------|
| GET | `/post-purchase/v1/claims/search` | Search claims by stage/status/resource | `safe-read` |
| GET | `/post-purchase/v1/claims/{id}` | Claim detail | `safe-read` |
| GET | `/post-purchase/v1/claims/{id}/messages` | Claim messages | `safe-read` |
| GET | `/post-purchase/v1/claims/{id}/expected_resolutions` | Expected resolutions | `safe-read` |
| GET | `/post-purchase/v1/claims/{id}/affects-reputation` | Reputation impact check | `safe-read` |
| GET | `/post-purchase/v1/claims/{id}/status_history` | Status history | `safe-read` |
| POST | `/post-purchase/v1/claims/{id}/messages` | Send message | `prepare-only` (out of scope) |
| POST | `/post-purchase/v1/claims/{id}/attachments` | Upload attachment | `prepare-only` (out of scope) |
| POST | `/post-purchase/v1/claims/{id}/expected_resolutions` | Propose resolution | `prepare-only` (out of scope) |
| PUT | `/post-purchase/v1/claims/{id}/expected_resolutions` | Accept resolution | `prepare-only` (out of scope) |

**Slice 2 scope**: `safe-read` only — search + detail + messages + expected_resolutions + affects-reputation. The 5 `prepare-only` mutation endpoints are deferred to a future execution slice.

**Response shape** (claim search):
```json
{
  "paging": { "offset": 0, "limit": 30, "total": 170 },
  "data": [{
    "id": 2342342432, "type": "mediations", "stage": "dispute",
    "status": "closed", "resource": "order", "resource_id": 234342342,
    "reason_id": "PDD316", "site_id": "MLM",
    "players": [{ "role": "complainant", "type": "buyer", "user_id": 44234343,
      "available_actions": [{ "action": "recontact", "due_date": "...", "mandatory": null }]
    }],
    "resolution": { "reason": "payment_refunded", "date_created": "...", "benefited": ["complainant"] },
    "date_created": "...", "last_updated": "..."
  }]
}
```

**Type design approach**: Follow existing pattern with `MlcClaimSummary`, `MlcClaimDetailSummary` (including players, resolution, coverages, labels), and `MlcClaimMessagesSummary`. The nested `players.available_actions` structure is the most complex part — similar complexity to the existing promotion handling.

**Site support**: Site-agnostic endpoint. Example responses show `site_id` field (MLA, MLM, MLB, etc.) — MLC likely supported.

**Effort**: ~200 lines (types + normalizers + 6 client methods). This is the largest single gap in Slice 2.

---

### Gap 2: Shipping Status — `GET /marketplace/shipments/{id}`

**Documentation**: [Manage Shipments](https://developers.mercadolibre.com/en_us/manage-shipments), last updated 2026-02-19. **CONFIRMED** — full endpoint documentation.

**Modern endpoint**: `GET /marketplace/shipments/$SHIPMENT_ID` with `x-format-new: true` header. Also available: `GET /orders/$ORDER_ID/shipments` and `GET /shipments/$SHIPMENT_ID` (legacy).

**Response shape** (abbreviated):
```json
{
  "id": 40531399184,
  "order_id": 2000013668125782,
  "status": "ready_to_ship",
  "substatus": "printed",
  "tracking_number": "MMXQP014735497E",
  "tracking_method": "CBT MA",
  "date_created": "...", "last_updated": "...",
  "logistic": { "mode": "me2", "type": "drop_off", "direction": "forward" },
  "dimensions": { "height": 3, "length": 45, "weight": 345, "width": 33 },
  "origin": { "sender_id": ..., "shipping_address": { ... } },
  "destination": { "receiver_id": ..., "shipping_address": { ... } },
  "lead_time": { "estimated_delivery_time": { ... } }
}
```

**Status values**: pending, handling, ready_to_ship, shipped, delivered, not_delivered, cancelled

**Slice 2 scope**: Single `safe-read` client method: `getShipment(sellerId, shipmentId)`. Read-only status check — no tracking updates, no label generation, no status mutation.

**Type design**: `MlcShipmentSummary` with status, substatus, tracking_number, tracking_method, logistic mode/type, dates, and dimensions. Flatten destination info for simplicity. The full address objects are large — we use summary approach (essential fields only).

**Site support**: Site-agnostic (example responses show MLC, MLB, MLM). `site_id` appears in response `source.site_id`.

**Effort**: ~100 lines (type + normalizer + client method).

---

### Gap 3: MCP Tool Wiring for Slice 1 Capabilities

**Current state**: Slice 1 added `getModerationStatus`, `getNotices`, and `prepareAnswer` to `MlcApiClient`. They are NOT exposed as MCP tools. The existing MCP tool surface in `packages/mcp/src/index.ts` already exposes:
- `read_mercadolibre_listings` (via `registerMlcReadTool`)
- `read_mercadolibre_orders`
- `read_mercadolibre_messages`
- `read_mercadolibre_reputation`
- `read_product_ads_insights` (custom registration)
- `read_mercadolibre_category_attributes`
- `read_mercadolibre_category_technical_specs`
- `read_mercadolibre_listing_prices`

**Pattern**: 
- Simple reads use `registerMlcReadTool(server, name, tool)` — accepts `{ sellerId, msl_api_key }`
- Complex reads (product ads, listing prices) use custom `server.registerTool()` with expanded input schemas

**What to wire**:
1. `read_mercadolibre_moderation_status` — uses `registerMlcReadTool` pattern but needs `itemId` in addition to `sellerId`. Requires a new tool in `MlcReadTools` first, OR a custom registration in the MCP layer that calls `mlcClient.getModerationStatus` directly.
2. `read_mercadolibre_notices` — similar pattern, needs optional `{ limit?, offset? }` params.
3. `prepare_mercadolibre_answer` — prepare-only. Needs special treatment (not a read tool). Could be registered separately or left as client-only until a future execution slice.

**Design decision**: Since `MlcReadTools` in `packages/tools/src/index.ts` doesn't currently include moderation/notices, we have two options:
- **Option A**: Add new tools to `MlcReadTools` → wire in MCP via `registerMlcReadTool`. More plumbing, but consistent.
- **Option B**: Custom registration in MCP that calls `mlcClient.getModerationStatus(sellerId, itemId)` directly. Less plumbing.

**Recommendation**: Option B for Slice 2 — custom registration following existing complex-tool pattern (like `read_product_ads_insights`). The tool layer (`MlcReadTools`) can be extended in a later refactor.

**Effort**: ~50 lines (3 MCP tool registrations + input schemas).

---

### Gap 4: Image Orchestration Flow

**What exists**: All 4 steps are individually typed (post-Slice 1):
1. `diagnoseImage()` — client method ✅
2. `uploadImage()` — client method ✅
3. `updateItem()` — on `MlClient` (older type), not on `MlcApiClient` 🔶
4. `getModerationStatus()` — client method ✅

**What's missing**: A documented/prepared flow that sequences these steps. The flow must:
1. Diagnose image against target category
2. If no issues, upload image to CDN
3. Associate uploaded image to listing (requires `updateItem` with updated `pictures` array)
4. Check moderation status post-association

**Design**: This is a `prepare-only` capability. It does NOT execute mutations itself, but defines a sequenced workflow that the agent follows with approval gates at each mutation step (upload, associate). 

The deliverable is:
- A spec document defining the 4-step orchestrated flow with pre-conditions, validation, and evidence requirements
- Optionally a typed helper that stages the flow as a prepared action (if time permits)

**Classification**: `prepare-only` — the flow involves mutations (upload, update) that should go through approval. The orchestration definition is the primary deliverable.

**Effort**: ~60 lines (spec/type definition + flow documentation).

---

## Classification Summary

| Gap | Classification | Confidence | Site Support | Est. Lines |
|-----|---------------|------------|-------------|------------|
| Claims search/detail (safe-read) | `safe-read` | High | Site-agnostic (MLC likely) | ~200 |
| Claims actions (messages, resolutions) | `prepare-only` | — | — | Deferred |
| Shipping status | `safe-read` | High | Site-agnostic (MLC confirmed) | ~100 |
| MCP tool wiring (Slice 1 capabilities) | Meta/infrastructure | High | N/A | ~50 |
| Image orchestration flow | `prepare-only` | High | N/A | ~60 |
| **Total Slice 2** | | | | **~410** |

---

## Affected Areas

| File | What changes |
|------|-------------|
| `packages/mercadolibre/src/index.ts` | 2 new types (`MlcClaimSummary`, `MlcShipmentSummary`) + 2 new normalizers + 2 new optional client methods (~300 lines) |
| `packages/mcp/src/index.ts` | 3 new MCP tool registrations: `read_mercadolibre_moderation_status`, `read_mercadolibre_notices`, `read_mercadolibre_claims`, `read_mercadolibre_shipping_status` (~50 lines) |
| `openspec/specs/ml-api-integration/spec.md` | 2 new capability matrix entries (claims, shipping) |
| `openspec/specs/custom-business-mcp-tools/spec.md` | 3 new MCP tool specs |
| New: `openspec/changes/.../specs/ml-image-orchestration/spec.md` | Image orchestration flow spec |

---

## Approaches

### Approach: Single PR (~410 lines)

Follow the established 30-endpoint pattern: summary types → normalizers → optional MlcApiClient methods → MCP tool registrations.

| Pros | Cons |
|------|------|
| Follows proven Slice 1 pattern | ~410 lines is marginally over 400-line budget |
| All additive, no refactoring | Claims normalizer is the riskiest piece (nested `players.available_actions`) |
| Single diff for review | |

**Effort**: Medium

## Recommendation

Single PR at ~410 lines. The 10-line overage is negligible — all changes are additive, follow existing patterns, and have zero refactoring risk. MCP tool wiring is mechanical registrations. Claims normalizer is the only significant piece and benefits from the existing `pushOptional`/`asArray`/`asRecord` helper pattern.

---

## Risks

- **Claims API complexity**: The deeply nested `players.available_actions` shape requires careful normalization. Risk of over-typing what can't be executed yet. Mitigation: model only the `safe-read` fields; defer mutation `available_actions` interpretation to a future execution slice.
- **Shipping endpoint versioning**: The modern endpoint uses `/marketplace/shipments/` with `x-format-new: true` header. The legacy `/shipments/` endpoint may return a different shape. Mitigation: use the modern endpoint path; test with real API response.
- **Image orchestration ambiguity**: Step 3 (associate image to listing) requires understanding the current `updateItem` on `MlClient` vs future `MlcApiClient`. Mitigation: spec-only for Slice 2; implementation deferred.
- **MCP tool for prepareAnswer**: The `prepareAnswer` method is prepare-only and generates no API call. Wiring it as an MCP tool requires careful design to not imply it executes. Mitigation: consider deferring to a future execution slice where the full approval pipeline handles it.

---

## Ready for Proposal

**Yes** — with the following confirmed:

1. **Claims scope**: safe-read only (search + detail + messages + expected_resolutions + affects-reputation). Mutations deferred.
2. **Shipping scope**: Single `getShipment(sellerId, shipmentId)` method — read-only status check.
3. **MCP wiring**: Custom registrations in MCP layer, not through `MlcReadTools` (avoids tool-layer refactor).
4. **Image orchestration**: Spec-only flow definition, not client code.
