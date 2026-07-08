# ml-api-integration Specification

## Purpose

Multi-account OAuth management, ML API read/write client, real HTTP transport, and a configured Plasticov → Maustian Product Sync Engine boundary on MLC. Plasticov and Maustian remain parallel seller accounts, not factory/store roles.

## Current Boundary

This specification covers the production integration foundation. The current MCP package still exposes a stubbed compatible surface, and the web `/api/chat` route remains demo-backed; neither should be described as production business-operation wiring yet.

## Requirements

### Requirement: Multi-Account OAuth

The system MUST store and manage OAuth tokens for the configured Plasticov and Maustian MercadoLibre seller accounts independently on the `MLC` site. `MLC` is the MercadoLibre Chile site code, not an account identity. Each account SHALL have its own encrypted token record with refresh cycle, using per-seller OAuth application credentials for token exchange and refresh. OAuth token storage MUST validate the returned MercadoLibre `user_id` against a configured allowed seller account before saving.

#### Scenario: Two accounts connected

- GIVEN Plasticov and Maustian OAuth tokens are stored via separate OAuth applications
- WHEN API requests target each account by sellerId
- THEN the correct token and app credentials MUST be resolved without cross-account leakage

#### Scenario: Token refresh on expiry

- GIVEN Maustian access token expires
- WHEN next API call requires Maustian access
- THEN the system MUST use Maustian's app credentials and stored refresh token to obtain a new access token BEFORE the call proceeds

#### Scenario: Refresh token also expired

- GIVEN both access and refresh tokens are expired
- WHEN an API call targets that seller
- THEN the system MUST return `ReconnectRequired` and SHALL NOT attempt the API call

### Requirement: Telegram Bot Runtime Integration

The Telegram bot runtime MUST create its ML API clients through the multi-seller OAuth infrastructure (`createOAuthMlcApiClient`, `createMlClient`) instead of `createMlcApiClient({tokenState})`. The bot MUST wire `mlClient` into agent tool registration so write tools (publish, update, sync) are available from chat.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Bot reads via OAuth MLC client | OAuth tokens valid for both sellers | Bot queries MercadoLibre | `mlcClient.getItem()` uses per-seller token resolution |
| Bot registers write tools | `mlClient` created via `createMlClient` | Agent loop initializes | Publish, update, and sync tools available in chat |
| Write respects seller context | User says "publicá en Maustian" | Write tool called | `sellerId` resolved to Maustian; API call uses correct token |
| Legacy static token bypassed | OAuth env vars configured | Bot starts | `createMlcApiClient({tokenState})` NOT called; zero legacy token usage |

### Requirement: Encrypted Token Storage

The system MUST encrypt OAuth tokens at rest. Current storage uses AES-256-GCM with a per-instance key derived from `MSL_ENCRYPTION_KEY`. Plaintext tokens MUST NOT be written to disk. Missing encryption keys MUST fail closed outside explicit local/demo/test mode.

#### Scenario: Token saved encrypted

- GIVEN an OAuth authorization code exchange succeeds
- WHEN tokens are persisted
- THEN access and refresh tokens MUST be encrypted before SQLite INSERT

#### Scenario: Token read decrypts on load

- GIVEN valid encrypted tokens exist in SQLite
- WHEN the OAuth manager loads tokens at startup
- THEN decryption MUST succeed and tokens MUST be usable for API calls

### Requirement: ML API Write Operations

The system MUST expose `publishItem` (POST /items for new listings), `updateItem` (PUT /items/{id} for existing), `changeItemStatus` (PUT /items/{id} with status body). Callers MUST resolve create-vs-update before invoking. Writes SHALL return snapshots with id, permalink, freshness metadata.
(Previously: no explicit create-vs-update resolution contract.)

#### Scenario: Publish to Maustian

- GIVEN valid Maustian OAuth and listing absence confirmed
- WHEN `publishItem` is called with payload
- THEN it MUST POST to /items and return itemId and permalink

#### Scenario: Update existing listing

- GIVEN valid Maustian OAuth and known itemId
- WHEN `updateItem` is called
- THEN it MUST PUT to /items/{id} and return updated itemId and permalink

#### Scenario: Write fails on token mismatch

- GIVEN Plasticov token is active
- WHEN write targets Maustian sellerId
- THEN the system MUST reject with `seller-access-mismatch`

### Requirement: Create vs Update API Semantics

`publishItem` SHALL call POST /items for listings not yet on target account; `updateItem` SHALL call PUT /items/{id} for existing listings. Callers MUST resolve existence before selecting endpoint. Speculative fallback MUST NOT occur.

#### Scenario: Publish resolves to POST

- GIVEN target listing is absent from Maustian
- WHEN `publishItem` is called
- THEN it MUST POST to /items with full payload

#### Scenario: Update resolves to PUT

- GIVEN target exists with known Maustian itemId
- WHEN `updateItem` is called
- THEN it MUST PUT to /items/{id} with delta payload

### Requirement: Product Sync Engine

The system SHALL provide `ProductSyncEngine` for bulk/differential sync. For the approved execution path, the engine is OBSOLETE: execution MUST use the orchestrated flow (readiness → idempotency → resolve → ML API → audit). Execution tools SHALL NOT import, instantiate, or call `ProductSyncEngine`.
(Previously: ProductSyncEngine was the only defined sync path.)

#### Scenario: Full sync publishes listing batch

- GIVEN Plasticov has listings and Maustian is empty
- WHEN `syncProducts` runs with margin strategy
- THEN listings MUST be extracted, priced, published, and mapped in sync state

#### Scenario: Differential sync skips unchanged

- GIVEN prior sync published 40 products
- WHEN only 5 listings changed
- THEN `syncProducts` MUST detect changed set and SHALL NOT republish unchanged

#### Scenario: Engine bypassed for approved execution

- GIVEN an approved proposal reaches execution
- WHEN the orchestrated flow processes it
- THEN `ProductSyncEngine` MUST NOT be invoked

### Requirement: MCP Tool Surface

The current MCP package exposes a stubbed tool surface (`simulate_actor`, `detect_probes`, `sync_product`, `check_account`, `list_strategies`, `consult_cortex`). Production write/sync tools SHALL require approval through the existing approval pipeline before any sync engine call. `sync_product` MAY compute inline read-only preview evidence for a pending proposal, but MCP MUST NOT import, instantiate, or execute `ProductSyncEngine` for that preview.

#### Scenario: Agent invokes sync_products

- GIVEN the agent receives CEO instruction "publicá electrónica en Maustian"
- WHEN the agent calls `sync_product` or a future production sync tool with category filter "electrónica"
- THEN the tool MUST prepare an approval-required proposal and SHALL NOT execute the sync engine directly from the LLM tool call

#### Scenario: MCP computes read-only preview evidence

- GIVEN `sync_product` has read-only source data and pure strategy evidence
- WHEN it prepares a pending proposal with preview metadata
- THEN MCP MUST NOT import, instantiate, or call `ProductSyncEngine`
- AND it MUST NOT call `publishItem`, `updateItem`, or `changeItemStatus`

#### Scenario: Write tool requires approval

- GIVEN autonomy level is below auto-approval threshold
- WHEN `publish_product` is invoked
- THEN the tool MUST prepare an approval request instead of executing directly

### Requirement: MercadoLibre Capability Classification Matrix

The system MUST classify documented MercadoLibre API areas before adding runtime behavior. The matrix is a specification contract, not an execution registry: `docs-only` entries MUST NOT map to tools, `safe-read` entries MAY be implemented later through project-owned read tools, `prepare-only` entries MAY only prepare approval-bound proposals, and `future-execute-with-approval` entries MUST remain non-executable until a later approved slice adds explicit execution controls.

| Area | Classification | Evidence reference | Freshness expectation | Confidence | Site support | Runtime surface |
|------|----------------|--------------------|-----------------------|------------|--------------|-----------------|
| Listing quality | `safe-read` | Official docs: `listings-quality`; GET `/item/{item_id}/performance` and `/user-product/{user_product_id}/performance` include `calculated_at`, score, buckets, variables, and actions. | Use API `calculated_at`; stale or missing values lower confidence. | Low | unknown | No runtime surface until MLC support is confirmed. |
| Category attributes/specs | `safe-read` | Official docs: `categories-and-listings`; `/sites` includes `MLC`, and category/domain resources expose `/sites/{site_id}/categories`, `/categories/{category_id}/attributes`, and `/domains/{domain_id}/technical_specs`. | Use retrieval time when the endpoint omits calculation timestamps; refresh before recommendations. | High | `MLC-confirmed` | Future project-owned read tool only. |
| Pictures | `prepare-only` | Official docs: `working-with-pictures`; upload/link/replace endpoints mutate item media, while picture requirements are also observable through listing quality and category settings. | Safe evidence MUST come from listing quality/category reads; upload validation or replacement is not a read surface. | Low | unknown | Prepared action only; no direct execution. |
| Shipping | `prepare-only` | Official docs: `items-shipping-attributes-and-dimensions`; dimensions and ME2/fulfillment updates can be rejected or managed by logistics. | Treat evidence as validation guidance until a read-only shipping endpoint is explicitly confirmed for MLC. | Low | unknown | Prepared action only; no direct execution. |
| Visits/metrics | `safe-read` | Official docs: `visits-resource`; GET visit resources support user and item windows and return totals/details with request date ranges. | Use requested `date_from`/`date_to`, `last`, and `unit`; maximum documented window is 150 days. | Low | unknown | No runtime surface until MLC support is confirmed. |
| Product Ads insights | `safe-read` | Official docs: `pads-read` updated 2026-02-18; advertiser lookup uses GET `/advertising/advertisers?product_id=PADS` with `Api-Version: 1`, and campaign/ad metrics use current Product Ads search endpoints with `api-version: 2`. | Use requested `date_from`/`date_to`; ROAS is the standard 2026 performance metric. The read metric `acos` remains requested by default, while the transitional target field `acos_target` is intentionally omitted from default metrics until its 2026-03-30 deprecation. | High | `MLC-confirmed` | Project-owned read tool only; campaign/ad budget, status, and strategy changes remain prepare-only/approval-bound. |
| Reputation | `safe-read` | Official docs: `sellers-reputation`; GET `/users/{user_id}` returns `seller_reputation`, and the docs explicitly describe MLC thresholds and limits. | Use retrieval time and documented metric periods such as 60 or 365 days for MLC. | High | `MLC-confirmed` | Future project-owned read tool only. |
| Questions | `prepare-only` | Official docs: `questions`; reads exist, but answer, blacklist, and public question-answering flows can create public or stateful effects. | Read evidence MUST preserve status/date metadata; answer-question behavior remains approval-bound proposal work only. | Low | unknown | Prepared action only; no direct execution. |
| Messages | `safe-read` | Existing project-owned MLC read snapshots already expose non-mutating message summaries through authorized direct API reads. Official docs: `pending-messages`; post-sale replies and mark-read flows can create stateful effects and are not included in this read surface. | Read snapshots MUST preserve status/date metadata, seller scope, blocked-result handling, freshness, and confidence; they MUST NOT mark messages read, send replies, or execute mutation operations. | Medium | project-owned existing MLC read | Existing project-owned read tool only; answering, mark-read, and reply operations remain prepared-action-only or future approval work. |

#### Scenario: Matrix entry has complete classification metadata

- GIVEN an API area appears in the capability matrix
- WHEN the system evaluates whether runtime behavior may be added
- THEN the entry MUST declare classification, evidence reference, freshness expectation, confidence, `siteSupport`, and runtime surface
- AND runtime implementation MUST follow the declared runtime surface instead of inferring execution from documentation.

#### Scenario: Product Ads insights are read before ad strategy changes

- GIVEN a connected Plasticov or Maustian seller account has Product Ads access
- WHEN the agent evaluates exposure, budget, status, title, or listing strategy for a product
- THEN the system MUST read Product Ads advertiser, campaign, ad, and metrics evidence first through current `pads-read` endpoints
- AND the read MUST preserve seller scope and disclose `noMutationExecuted: true`
- AND Product Ads mutations, legacy endpoints, budget changes, campaign status changes, and ad edits MUST remain out of scope for this safe-read capability.

#### Scenario: MLC support is unknown

- GIVEN an API area's documentation does not explicitly confirm MLC support
- WHEN the area is classified
- THEN `siteSupport` MUST be `unknown`
- AND confidence MUST be low for executable or stateful behavior
- AND the area MUST NOT expose mutation execution.

### Requirement: Capability Matrix — Mutation Entries

The matrix MUST include create, update, status-change, and relist rows backed by real API evidence with confirmed MLC site support.

| Area | Classification | Endpoint | Site support | Runtime surface |
|------|----------------|----------|-------------|-----------------|
| Create listing | `future-execute-with-approval` | POST /items | MLC-confirmed | Orchestrated flow |
| Update listing | `future-execute-with-approval` | PUT /items/{id} | MLC-confirmed | Orchestrated flow |
| Status change | `future-execute-with-approval` | PUT /items/{id} (status body) | MLC-confirmed | Recovery-only |
| Relist | `future-execute-with-approval` | POST /items/{id}/relist | MLC-confirmed | Recovery-only |

#### Scenario: Mutation entries reference real endpoints

- GIVEN a mutation entry in the matrix
- WHEN classified
- THEN it MUST reference documented ML endpoint with MLC-confirmed site support

### Requirement: Capability Matrix — Slice 1 2026 Gap Entries

Three new entries SHALL be added to the MercadoLibre Capability Classification Matrix:

| Area | Classification | Endpoint | Site support | Runtime surface |
|------|----------------|----------|-------------|-----------------|
| Image moderation status | `safe-read` | `GET /moderations/last_moderation/{id}` | MLC-confirmed | `read-tool` |
| Communications / notices | `safe-read` | `GET /communications/notices` | MLC-confirmed | `read-tool` |
| Questions answer | `prepare-only` | `POST /answers` | MLC-confirmed | `prepared-action` |

#### Scenario: New matrix entries follow established classification contract

- GIVEN three API areas from 2025-2026 docs are added to the matrix
- WHEN the system evaluates runtime behavior for each
- THEN each entry MUST declare classification, evidence reference, freshness expectation, confidence, `siteSupport`, and runtime surface
- AND `safe-read` entries MUST follow existing read-tool patterns with no approval requirements
- AND the `prepare-only` entry MUST require `requiresApproval: true` with no direct MCP execution

#### Scenario: MLC support is to-be-confirmed

- GIVEN the documentation does not yet explicitly confirm MLC support for these endpoints
- WHEN the entries are classified
- THEN `siteSupport` MUST be `MLC-to-confirm`
- AND confidence MUST be low for the `prepare-only` entry
- AND mutation execution MUST be blocked until MLC site support is confirmed and execution slice exists

### Requirement: Capability Matrix — Slice 2 2026 Gap Entries

Four new entries SHALL be added to the MercadoLibre Capability Classification Matrix:

| Area | Classification | Endpoint | Site support | Runtime surface |
|------|----------------|----------|-------------|-----------------|
| Claims search/detail | `safe-read` | `GET /post-purchase/v1/claims/search`, `GET /post-purchase/v1/claims/{id}`, 4 sub-resources | MLC-to-confirm | `read-tool` |
| Shipping status | `safe-read` | `GET /marketplace/shipments/{id}` (x-format-new: true) | MLC-to-confirm | `read-tool` |
| MCP tool wiring (Slice 1) | Infrastructure | N/A (MCP layer only) | N/A | `read-tool` / `prepared-action` |
| Image orchestration flow | `prepare-only` | Multi-step: diagnose → upload → associate → check | MLC-to-confirm | `prepared-action` |

#### Scenario: New entries follow established classification contract

- GIVEN claims, shipping, MCP wiring, and image orchestration are added to the matrix
- WHEN the system evaluates runtime behavior for each
- THEN each entry MUST declare classification, evidence reference, freshness expectation, confidence, `siteSupport`, and runtime surface
- AND `safe-read` entries MUST follow existing read-tool patterns with no approval requirements
- AND `prepare-only` entries MUST require `requiresApproval: true` with no direct MCP execution

#### Scenario: MLC support is to-be-confirmed

- GIVEN the documentation does not yet explicitly confirm MLC support for claims and shipping
- WHEN the entries are classified
- THEN `siteSupport` MUST be `MLC-to-confirm`
- AND confidence MUST be low for `prepare-only` entries
- AND mutation execution MUST be blocked until MLC site support is confirmed

### Requirement: Shared MLC Item Completeness Validation

The MercadoLibre package MUST expose a runtime completeness boundary for unknown MLC item payloads and MUST use that same boundary when returning `MlItem` values from item reads. The boundary MUST accept only payloads with the required item fields needed by downstream sync preview evidence and MUST reject incomplete payloads without inventing placeholder business data.

#### Scenario: Complete item read is normalized

- GIVEN MercadoLibre returns a complete MLC item payload
- WHEN the system reads the item through `getItem()`
- THEN the returned value MUST satisfy the shared `MlItem` completeness boundary
- AND downstream callers MAY reuse the same validation contract.

#### Scenario: Incomplete item payload is rejected

- GIVEN MercadoLibre returns an item payload missing required sync-preview fields
- WHEN the shared completeness boundary evaluates the payload
- THEN it MUST reject the payload as incomplete
- AND it MUST NOT synthesize required fields from defaults or placeholders.

---

### Requirement: Non-Mutating ML Execution Readiness Evidence

Readiness MUST require API capability evidence, source completeness, dry-run/revalidation, seller/account safeguards, target availability, idempotency candidate, rollback plan, rate/error handling, and redaction. Missing mutation evidence MUST return `api-capability-evidence-missing`. API evidence MUST reference a matrix entry with MLC-confirmed site support.
(Previously: no explicit matrix tie for capability evidence.)

#### Scenario: API evidence is unavailable

- GIVEN ML docs lack mutation evidence for target behavior
- WHEN readiness evaluates prerequisites
- THEN result MUST be `blocked`/`degraded` with `api-capability-evidence-missing`

#### Scenario: Mutation runtime remains forbidden

- GIVEN any readiness path runs
- WHEN ML integration code is selected
- THEN it MUST NOT call publishItem, updateItem, changeItemStatus, ProductSyncEngine, sync_all, or audit replay

---

### Requirement: Capability Matrix — Slice 3 2026 Gap Entries

Four claim sub-resource entries and image orchestration entry SHALL be added:

| Area | Classification | Endpoint | Site support | Runtime surface |
|------|----------------|----------|-------------|-----------------|
| Claim messages | `safe-read` | `GET /post-purchase/v1/claims/{id}/messages` | MLC-to-confirm | `read-tool` |
| Claim expected resolutions | `safe-read` | `GET /post-purchase/v1/claims/{id}/expected_resolutions` | MLC-to-confirm | `read-tool` |
| Claim reputation impact | `safe-read` | `GET /post-purchase/v1/claims/{id}/affects-reputation` | MLC-to-confirm | `read-tool` |
| Claim status history | `safe-read` | `GET /post-purchase/v1/claims/{id}/status_history` | MLC-to-confirm | `read-tool` |
| Image associate + orchestration | `prepare-only` | `POST /items/{id}/pictures` + multi-step flow | MLC-to-confirm | `prepared-action` |

### Requirement: Capability Matrix — Return Safe Reads

Three return read entries SHALL be added to the MercadoLibre capability matrix. They MUST be classified as safe reads, use project-owned runtime surfaces only, and preserve explicit MLC uncertainty.

| Area | Classification | Endpoint | Site support | Runtime surface |
|------|----------------|----------|--------------|-----------------|
| Claim return detail | `safe-read` | `GET /post-purchase/v2/claims/{claim_id}/returns` | `MLC-to-confirm` | `read-tool` |
| Return reviews | `safe-read` | `GET /post-purchase/v1/returns/{return_id}/reviews` | `MLC-to-confirm` | `read-tool` |
| Claim return cost | `safe-read` | `GET /post-purchase/v1/claims/{claim_id}/charges/return-cost` | `MLC-to-confirm` | `read-tool` |

#### Scenario: Return safe reads are classified

- GIVEN return GET endpoints are added to the matrix
- WHEN runtime behavior is evaluated
- THEN each entry MUST declare `safe-read`, `MLC-to-confirm`, confidence metadata, and `read-tool`
- AND implementation MUST preserve `noMutationExecuted: true`

#### Scenario: Return reads degrade when unavailable

- GIVEN MLC support is unconfirmed or upstream returns unavailable, unauthorized, or not-found
- WHEN a return read is attempted
- THEN the integration MUST return controlled degraded metadata
- AND it MUST NOT infer execution support from documentation

### Requirement: Capability Matrix — Return Non-Executable Actions

Return-review POST, attachment upload, refund, dispute, and return action endpoints MUST be classified as non-executable for this slice. They SHALL NOT map to runtime tools, approvals, prepared actions, or direct API calls in `operational-returns-ingestion`.

| Area | Classification | Runtime surface |
|------|----------------|-----------------|
| Return-review POST | non-executable | None |
| Return attachments/upload | non-executable | None |
| Refund/dispute/return actions | non-executable | None |

#### Scenario: Mutation-like return endpoint is requested

- GIVEN a caller requests return-review POST, attachment upload, refund, dispute, or return action execution
- WHEN the capability matrix is consulted
- THEN the request MUST be blocked as non-executable in this slice
- AND no approval, prepared action, or ML mutation call MUST be created
