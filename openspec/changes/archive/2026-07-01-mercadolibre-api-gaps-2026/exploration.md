# Exploration: MercadoLibre API Gaps 2026

**Date**: 2026-07-01
**Trigger**: Orchestrator launch for `mercadolibre-api-gaps-2026`

---

## Current State

The `@msl/mercadolibre` package (3405 lines) is a mature, hexagonal TypeScript ML API client with extensive typed coverage. The `MlcApiClient` interface (lines 615–701) defines 27 typed endpoints, and `createMlcReadMethods` (lines 2406–2750) implements every one with full normalizers, OAuth validation, and real HTTP transport.

### ✅ Confirmed — Already typed and in the client

| Surface | Type | Lines | Endpoint | Site |
|---------|------|-------|----------|------|
| Listings | `getListings` | 616–620, 2408–2423 | GET /users/{id}/items/search | MLC |
| Item detail | `getItem` | 621, 2424–2428 | GET /items/{id} | MLC |
| Orders | `getOrders` | 622, 2429–2435 | GET /orders/search | MLC |
| Messages | `getMessages` | 623, 2436–2442 | GET /messages/search | MLC |
| Reputation | `getReputation` | 624, 2443–2449 | GET /users/{id} | MLC-confirmed |
| Category attributes | `getCategoryAttributes` | 624–627, 2450–2454 | GET /categories/{id}/attributes | MLC-confirmed |
| Technical specs | `getCategoryTechnicalSpecs` | 628–631, 2455–2459 | GET /domains/{id}/technical_specs | MLC-confirmed |
| Product Ads insights | `getProductAdsInsights` | 632–635, 2460–2484 | GET /advertising/.../product_ads/{campaigns,ads}/search | MLC-confirmed |
| Listing prices | `getListingPrices` | 636–639, 2485–2492 | GET /sites/{id}/listing_prices | MLC-confirmed |
| Item sale price | `getItemSalePrice` | 640–644, 2493–2503 | GET /items/{id}/sale_price | MLC |
| Item prices | `getItemPrices` | 645, 2504–2508 | GET /items/{id}/prices | MLC |
| Price to win | `getItemPriceToWin` | 646, 2509–2515 | GET /items/{id}/price_to_win (v2) | MLC |
| Pricing automation | `getPricingAutomation` | 647, 2516–2528 | GET /pricing-automation/items/{id}/automation | MLC |
| PA item rules | `getPricingAutomationItemRules` | 648–651, 2529–2542 | GET /pricing-automation/items/{id}/rules | MLC |
| PA product rules | `getPricingAutomationProductRules` | 652–655, 2543–2556 | GET /pricing-automation/products/{id}/rules | MLC |
| PA price history | `getPricingAutomationPriceHistory` | 656–660, 2557–2585 | GET /pricing-automation/items/{id}/price/history | MLC |
| PA items list | `getPricingAutomationItems` | 661–664, 2586–2606 | GET /pricing-automation/users/{id}/items | MLC |
| Seller promotions | `getSellerPromotions` | 665, 2607–2616 | GET /seller-promotions/users/{id} | MLC |
| Promotion detail | `getPromotionDetail` | 666–670, 2617–2626 | GET /seller-promotions/promotions/{id} | MLC |
| Promotion items | `getPromotionItems` | 671–682, 2627–2660 | GET /seller-promotions/promotions/{id}/items | MLC |
| Item promotions | `getItemPromotions` | 683, 2661–2667 | GET /seller-promotions/items/{id} | MLC |
| Item visits | `getItemVisits` | 684, 2668–2672 | GET /visits/items | MLC |
| Visits time window | `getItemVisitsTimeWindow` | 685–689, 2673–2693 | GET /items/{id}/visits/time_window | MLC |
| Item performance | `getItemPerformance` | 690, 2694–2698 | GET /items/{id}/performance | MLC |
| Relist | `relistItem` | 691, 2699–2713 | POST /items/{id}/relist | MLC |
| Image diagnostic | `diagnoseImage` | 692–695, 2714–2733 | POST /moderations/pictures/diagnostic | MLC |
| Image upload | `uploadImage` | 696–700, 2734–2748 | POST /pictures/items/upload | MLC |

This is essentially 27 endpoints typed and functional — far more than the 10 originally estimated.

### 🟡 Already typed at type level but NOT wired as MCP tools

The tools and MCP layers expose a subset of the full client surface:
- Tools: `MlcReadTools` (lines 82–116) exposes: listings, orders, messages, reputation, productAdsInsights, listingPrices, categoryAttributes, categoryTechnicalSpecs
- Not yet in tools/MCP: visits, performance, sale price, item prices, price to win, pricing automation, promotions, relist, image diagnostic, image upload

### 🟡 The image flow gap

Each step exists: `diagnoseImage` (pre-upload check, line 2714), `uploadImage` (upload to CDN, line 2734), and `getItem` can be used to check if image is attached. But there is no "moderation status check" after upload AND no orchestrated flow that binds them together. The missing piece is `GET /moderations/last_moderation/{id}` — documented in ML docs (updated 2025-07-21) but not typed in MSL.

---

## Gap Analysis: 6 New APIs

### Gap 1: Image Moderation Status — `GET /moderations/last_moderation/{id}`

**Documentation**: [Image Moderation](https://developers.mercadolibre.com/en_us/image-moderation), last updated 2025-07-21
**Classification**: `safe-read`
**MLC support**: Likely (site-agnostic moderation endpoint)

**Endpoint**: `GET https://api.mercadolibre.com/moderations/last_moderation/{id}`
**Response shape** (array):
```json
[{
  "name": "WATERMARK" | "MULTIPLE",
  "id": "7123400333",
  "date_created": "2022-03-22 09:08:06.0",
  "wordings": [
    { "type": "REASON" | "REMEDY", "value": "..." }
  ],
  "evidence": [
    { "text_matched": "623362-MLA...", "section_name": "pictures" }
  ]
}]
```

**What it enables**: Post-upload moderation check. The flow becomes:
1. `diagnoseImage` (pre-upload diagnostic) ✅ exists
2. `uploadImage` (upload to CDN) ✅ exists
3. Associate image to listing (via item update, not yet typed)
4. `getModerationStatus(moderationRefId)` ← **MISSING**

**Type design**:
```ts
type MlcModerationWording = { type: "REASON" | "REMEDY"; value: string };
type MlcModerationEvidence = { text_matched: string; section_name: string };
type MlcModerationEntry = {
  name: string; id: string; date_created: string;
  wordings: ReadonlyArray<MlcModerationWording>;
  evidence: ReadonlyArray<MlcModerationEvidence>;
};
type MlcModerationSnapshot = MlcReadSnapshot<ReadonlyArray<MlcModerationEntry>>;
```

**Effort**: Low — ~80 lines of types + normalizer + client method. The moderation reference ID comes from item moderation data (`GET /items/{id}` includes `moderation` info).

---

### Gap 2: Communications / Notices — `GET /communications/notices`

**Documentation**: [Communications](https://developers.mercadolibre.com/en_us/seller-news), last updated 2025-12-19
**Classification**: `safe-read`
**MLC support**: Likely (user-scoped, not site-scoped)

**Endpoint**: `GET https://api.mercadolibre.com/communications/notices?limit={limit}&offset={offset}`
**Response shape**:
```json
{
  "paging": { "total": 2, "offset": 0, "limit": 20 },
  "results": [{
    "id": "3691",
    "label": "Welcome integrators...",
    "description": "<p>HTML content</p>",
    "highlighted": true,
    "from_date": "2021-07-12T15:00:00.000Z",
    "tags": [{ "tag": "BLACK_FRIDAY", "type": "EVENTS" }],
    "actions": [{ "text": "More info", "link": "https://..." }],
    "dismiss_key": "...",       // integrator only
    "title": "Review request"   // integrator only
  }]
}
```

**Tag types documented**: METRICS, CANCELLATIONS, RETURNS, SHIPPING (multiple variants), BILLING, PROMOTIONS, PUBLICATIONS, EVENTS (CHRISTMAS, BLACK_FRIDAY, etc.)
**Categories documented**: ALERT (Blocking, Requirement, Restriction, Warning), NEW (Operational contingency, Pre-moderation notice, Business rule change, Other), RELEASE, PUBLICITY, MODAL, OPPORTUNITY

**Business value**: Proactive seller health monitoring. An AI agent could surface "your account has a new restriction alert" or "Black Friday preparation notice."

**Type design**:
```ts
type MlcNoticesTag = { tag: string; type: string };
type MlcNoticeAction = { text: string; link: string };
type MlcNoticeEntry = {
  id: string; label: string; description: string;
  highlighted: boolean; from_date: string;
  tags: ReadonlyArray<MlcNoticesTag>;
  actions: ReadonlyArray<MlcNoticeAction>;
  dismiss_key?: string; title?: string;
};
type MlcNoticesSummary = {
  paging: { total: number; offset: number; limit: number };
  results: ReadonlyArray<MlcNoticeEntry>;
};
```

**Effort**: Low — ~70 lines of types + normalizer + pagination. Straightforward GET with offset/limit.

---

### Gap 3: Claims / Mediations — `GET /post-purchase/v1/claims/search`

**Documentation**: [Claims](https://developers.mercadolibre.com/en_us/working-with-claims), last updated 2024-05-06
**Classification**: `safe-read` (search/detail); `prepare-only` (messages, actions, resolutions)
**MLC support**: Likely (site-agnostic)

**Endpoints**:
| Method | Path | Purpose | Classification |
|--------|------|---------|----------------|
| GET | `/post-purchase/v1/claims/search` | Search claims by stage/status/resource | `safe-read` |
| GET | `/post-purchase/v1/claims/{id}` | Claim detail | `safe-read` |
| GET | `/post-purchase/v1/claims/{id}/messages` | Claim messages | `safe-read` |
| GET | `/post-purchase/v1/claims/{id}/expected_resolutions` | Expected resolutions | `safe-read` |
| GET | `/post-purchase/v1/claims/{id}/affects-reputation` | Reputation impact check | `safe-read` |
| POST | `/post-purchase/v1/claims/{id}/messages` | Send message | `prepare-only` |
| POST | `/post-purchase/v1/claims/{id}/attachments` | Upload attachment | `prepare-only` |
| POST | `/post-purchase/v1/claims/{id}/expected_resolutions` | Propose resolution | `prepare-only` |
| PUT | `/post-purchase/v1/claims/{id}/expected_resolutions` | Accept resolution | `prepare-only` |

**Response shape** (claim):
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

**Business value**: Claims are the #1 seller pain point. A read-only claims dashboard would let the AI agent surface open claims with deadlines, available actions, and reputation impact — without ever mutating. The prepare-only actions (send message, propose refund) can be wired later through the approval pipeline.

**Effort for safe-read minimum**: Medium — ~200 lines. Claim data is deeply nested with players, available_actions, resolutions, coverages, and labels. Need careful normalization similar to promotion handling.

**Effort for full prepare-only**: High — ~400 additional lines for action endpoints (messages, attachments, resolutions, evidence).

---

### Gap 4: Questions Answer Workflow — `POST /answers`

**Documentation**: [Manage Questions & Answers](https://developers.mercadolibre.com/en_us/manage-questions-and-answers), updated 2026-01-15
**Classification**: `prepare-only`
**MLC support**: Likely (site-agnostic)

**Endpoint**: `POST https://api.mercadolibre.com/answers`
**Body**: `{ "question_id": 3957150025, "text": "Test answer..." }`

**Current state**: Questions are READ-ONLY through `getMessages` (which reads `/questions/search` under the hood, normalized by `normalizeQuestions` at line 3113). The `MlQuestion` type exists in `types.ts` (lines 37–43) but is re-exported, not directly used in the client's question normalizer.

**What's missing**: The write path. `POST /answers` to respond to buyer questions. This is a classic prepare-only mutation.

**Business value**: Automated draft responses for common questions, with human approval. The response time resource (`GET /users/{id}/questions/response_time`) could also be added as a `safe-read`.

**Effort**: Low — ~50 lines. Simple POST with question_id + text body. Response shape is `{ "id": ..., "status": ... }`.

---

### Gap 5: Brand Protection Program

**Documentation**: [Brand Protection Program](https://developers.mercadolibre.com/en_us/what-is-the-brand-protection-program)
**Classification**: `docs-only`
**MLC support**: Unknown

The BPP is a program — not a single API. It covers rights holders reporting IP violations, with associated endpoints for brand registration, report filing, and review. The ML docs describe the program conceptually but individual API endpoints are not well-documented in the public developer site.

**Recommendation**: Classify as `docs-only` for now. The program's API surface is not well-enough documented to build types against. If Plasticov or Maustian participate in BPP, revisit when endpoints are clearer.

**Effort**: N/A — cannot estimate without documented endpoints.

---

### Gap 6: Shipping Status/Options

**Documentation**: [Shipping](https://developers.mercadolibre.com/en_us/shipping), [Manage Shipments](https://developers.mercadolibre.com/en_us/manage-shipments)
**Classification**: `safe-read` (status queries); `prepare-only` (label generation)
**MLC support**: Likely

Multiple endpoints exist:
| Endpoint | Purpose |
|----------|---------|
| GET `/shipments/{id}` | Shipment detail with status, tracking, costs |
| GET `/shipments/search` | Search shipments by seller/status |
| GET `/shipments/{id}/costs` | Cost breakdown |

**Current state**: MSL already has `listingPrices` with logistics-aware params (logisticType, shippingMode, billableWeight). But there's no typed shipping status endpoint.

**Type design** (minimum viable):
```ts
type MlcShipmentStatusSummary = {
  id: string; status: string; substatus?: string;
  trackingNumber?: string; trackingMethod?: string;
  dateCreated?: string; dateFirstPrinted?: string;
  shippingMode?: string; logisticType?: string;
};
```

**Effort**: Low–Medium — ~100 lines. Multiple filtering params, pagination. Status values vary by logistics provider.

---

## Image Flow Gap Analysis (Orchestration)

Each step is individually typed:

```
diagnoseImage(sellerId, { pictureUrl, categoryId, title?, pictureType? })
  → POST /moderations/pictures/diagnostic
  → MlcImageDiagnosticSnapshot { diagnosticId, diagnostics[], hasIssues }

uploadImage(sellerId, imageBuffer, filename)
  → POST /pictures/items/upload
  → MlcImageUploadSnapshot { pictureId, variations[] }

??? attach image to listing ??? (via updateItem, not an image-specific endpoint)

(MISSING) getModerationStatus(moderationRefId)
  → GET /moderations/last_moderation/{id}
  → MlcModerationSnapshot
```

**What's missing**:
1. No "associate image to listing" helper — currently only possible via `updateItem` with raw pictures array
2. No orchestrated flow — each step must be called manually by the AI agent
3. No moderation status check — Gap 1 above

**Approach**: Two options:
- **Option A — Add types only**: Type `getModerationStatus` and document the flow in specs. Agent chains calls manually.
- **Option B — Prepared action**: Create a `prepareImageFlow` tool that stages all steps as one approval-bound action, with pre-upload diagnostic evidence and post-upload moderation verification.

**Recommendation**: Option A first (types + spec), Option B later when the approval pipeline matures.

---

## Classification Summary

| Gap | Classification | Confidence | Site Support | Estimated Lines | Priority |
|-----|---------------|------------|-------------|-----------------|----------|
| Image moderation status | `safe-read` | Medium | Likely MLC | ~80 | P1 — completes image flow |
| Communications / notices | `safe-read` | High | Site-agnostic | ~70 | P1 — proactive monitoring |
| Claims search/detail | `safe-read` | High | Site-agnostic | ~200 | P1 — pain point visibility |
| Claims actions | `prepare-only` | Medium | Likely | ~400 | P3 — future |
| Questions answer | `prepare-only` | High | Site-agnostic | ~50 | P2 — common automation |
| Brand Protection Program | `docs-only` | Low | Unknown | N/A | P4 — revisit later |
| Shipping status | `safe-read` | Medium | Likely MLC | ~100 | P2 — logistics visibility |
| Image orchestration | `docs-only` (types exist) | — | — | ~0 (types) | P2 — spec work |

---

## Affected Areas

| File | What changes |
|------|-------------|
| `packages/mercadolibre/src/index.ts` | Add 6 new types, 5 new client methods, 5 new normalizers |
| `packages/mercadolibre/src/types.ts` | Add moderation-specific base types if used outside normalizer |
| `packages/tools/src/index.ts` | Add new read tools for notices, claims, shipping; add prepare-only for answers |
| `packages/mcp/src/index.ts` | Register new MCP tools for safe-read gaps |
| `openspec/specs/ml-api-integration/spec.md` | Add requirement rows and capability matrix entries for each new area |
| `openspec/specs/custom-business-mcp-tools/spec.md` | Add new MCP tool specs |
| `openspec/specs/action-approval-safety/spec.md` | Add prepare-only surface for claims actions and answers |

---

## Recommendation

**Phase 1 — Safe-read types (Low effort, ~450 lines total)**:
1. Image moderation status (`getModerationStatus`)
2. Communications / notices (`getNotices`)
3. Claims search/detail (`getClaims`, `getClaimDetail`, `getClaimMessages`)
4. Shipping status (`getShipment`, `getShipments`)

**Phase 2 — Prepare-only (Medium effort, ~50–100 lines)**:
5. Questions answer (`answerQuestion`)
6. Claims message (send message to buyer/mediator — part of claims actions)

**Phase 3 — Orchestration (Spec work)**:
7. Image flow documentation as a planned orchestrated action

**Phase 4 — Docs-only (defer)**:
8. Brand Protection Program — revisit when API surface is documented

### Approach

Single approach: follow the existing pattern. Every new endpoint gets:
1. Summary type (flat camelCase fields)
2. Snapshot type (`MlcReadSnapshot<TSummary>`)
3. Normalizer function
4. Client method (with OAuth, MLC validation where applicable)
5. Tool layer wrapper (for safe-read endpoints)
6. MCP tool registration

No alternatives needed — the pattern is well-established across 27+ existing endpoints.

### Risks

- **Claims API complexity**: The deeply nested `players.available_actions` shape and the distinction between GET and mutation endpoints means careful type design is needed. Risk of over-typing what can't be executed yet.
- **Shipping site-specificity**: Shipping status endpoints may return MLC-specific data shapes. Need real API testing before finalizing types.
- **Integrator vs seller notices**: `/communications/notices` returns different shapes for seller tokens vs. integrator tokens (dismiss_key, title only for integrators). Types must handle both.
- **Moderation reference ID source**: The `MODERATION_REFERENCE_ID` comes from item moderation data — may need to extend `getItem` to expose moderation references.

---

## Ready for Proposal

**Yes** — with the following clarification needed from the orchestrator/user:

1. **Prioritization**: Do we do all Phase 1 safe-reads in one change, or split per domain (notices, claims, shipping, moderation)?
2. **Claims scope**: Do we stop at safe-read (search + detail + messages) or go into prepare-only actions in the same change?
3. **Image orchestration**: Is the image flow orchestration (prepareImageFlow tool) in scope, or are we just adding the moderation status type?

**Recommended**: Start with Phase 1 safe-reads as a single change (~450 lines, all read-only, no approval pipeline changes). This is well within the 400-line PR budget if the normalizers reuse existing `pushOptional`/`asRecord`/`asArray` helpers.
