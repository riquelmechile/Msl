# MercadoLibre Account Integration Specification

## Purpose

Define account connection behavior for MercadoLibre Chile using official APIs, OAuth, and strict documentation-only MCP boundaries.

## Requirements

### Requirement: OAuth Account Connection

The system MUST connect seller accounts through MercadoLibre OAuth using per-seller application credentials. Each seller (Plasticov, Maustian) SHALL use its own `{clientId, clientSecret, redirectUri}`. The system MUST only request scopes needed for enabled capabilities.

#### Scenario: Seller connects account

- GIVEN the seller starts account connection with per-seller OAuth credentials
- WHEN OAuth authorization succeeds
- THEN the system MUST store access state and identify the account as `MLC`

#### Scenario: Authorization fails or is revoked

- GIVEN OAuth authorization fails or access is revoked
- WHEN protected data is requested
- THEN the system MUST block access and ask the seller to reconnect

### Requirement: Bot Multi-App OAuth Routing

The Telegram bot MUST resolve per-seller OAuth configurations via `resolveOAuthConfigs(env)` and create a `MultiAppOAuthManager` via `createMultiAppOAuthManager(configs)`, replicating the MCP pattern. The bot MUST pass both `MERCADOLIBRE_SOURCE_SELLER_ID` and `MERCADOLIBRE_TARGET_SELLER_ID` so both Plasticov and Maustian accounts are usable from chat.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Bot resolves per-seller configs | SOURCE/TARGET_CLIENT_ID env vars set | `resolveOAuthConfigs(env)` called | Plasticov→App A, Maustian→App B configs returned |
| Bot creates multi-app manager | Both configs resolved | `createMultiAppOAuthManager` called | OAuth manager routes per sellerId to correct app credentials |
| Ingestion uses same manager | Bot background ingestion starts | MercadoLibre API calls made | Same `oauthManager` used for both sellers' data ingestion |

### Requirement: Direct API and Official MCP Boundary

The system MUST use direct MercadoLibre APIs for seller data and actions. The official MercadoLibre MCP MUST be treated only as updated API documentation lookup and MUST NOT be represented as an executor of seller operations.

#### Scenario: Agent needs seller data

- GIVEN the agent needs listings, orders, messages, or reputation data
- WHEN it retrieves operational data
- THEN it MUST use authorized MercadoLibre APIs, not MCP documentation tools

#### Scenario: API behavior is unclear

- GIVEN implementation guidance is needed
- WHEN the agent consults documentation
- THEN it MAY use official MercadoLibre MCP/docs as reference only

#### Scenario: Seller operation is requested

- GIVEN a seller operation requires data retrieval or mutation
- WHEN the system selects an execution path
- THEN it MUST route through authorized project-owned tools backed by direct MercadoLibre APIs

### Requirement: Protected Direct API Reads

The system MUST protect listings, orders, messages, and reputation reads with the current MercadoLibre access state. Protected reads MUST use authorized direct APIs through project-owned tools and MUST NOT use official MCP as a seller-operation executor.

#### Scenario: Access allows protected read

- GIVEN the seller has valid MLC access matching the requested account
- WHEN protected listing, order, message, or reputation data is requested
- THEN the system MUST allow the read through authorized direct API tooling
- AND the result MUST identify the seller data source

#### Scenario: Access is revoked

- GIVEN seller access is revoked or authorization failed
- WHEN protected data is requested
- THEN the system MUST block the read
- AND it MUST return a reconnect-oriented result

#### Scenario: Access belongs to a different account

- GIVEN valid access exists for a different seller account than the requested one
- WHEN protected data is requested
- THEN the system MUST block the read as mismatched access
- AND it MUST NOT return seller business data

### Requirement: Documentation-Only MCP During Reads

The system MAY consult official MercadoLibre MCP or docs for API reference, but protected seller reads MUST be executed only by project-owned direct API tooling.

#### Scenario: API behavior needs verification

- GIVEN implementation guidance is needed for a protected read
- WHEN documentation is consulted
- THEN official MercadoLibre MCP MAY be used as reference only
- AND it MUST NOT receive or execute seller operational requests

### Requirement: MLC Account-Safe Capability Reads

The system MUST preserve fail-closed OAuth, configured allowed seller IDs, MLC seller scope, and account mismatch blocking for every read-first MercadoLibre capability, including listing quality, category attributes/specs, pictures, shipping, visits/metrics, reputation, questions, and messages. Unknown MLC support MUST remain unsupported or low confidence and MUST NOT bypass account protections.

#### Scenario: Allowed MLC seller requests capability evidence

- GIVEN a valid OAuth token belongs to the requested allowed `MLC` seller
- WHEN capability evidence is read through project-owned direct API tooling
- THEN the system MUST scope the read to that seller and `MLC`
- AND it MUST return seller identity, site, source, freshness, and confidence metadata

#### Scenario: Read access is unsafe

- GIVEN OAuth access is missing, revoked, mismatched, not allowed, non-`MLC`, or unsupported for `MLC`
- WHEN capability evidence is requested
- THEN the system MUST block the read or mark the evidence unsupported with low confidence
- AND it MUST NOT return another seller's operational data

### Requirement: MLC Plasticov-to-Maustian Sync Preparation Boundary

MCP product sync preparation MUST enforce the configured `MLC` Plasticov → Maustian direction as a specific sync/safety boundary. Plasticov and Maustian MUST otherwise be treated as separate seller accounts with the same business capabilities, not as manufacturer/store roles. The system MUST reject reversed, arbitrary, non-`MLC`, missing, or mismatched seller roles with controlled blocked responses.

#### Scenario: Configured role direction is accepted

- GIVEN valid MCP auth and configured `MLC` roles identify the approved Plasticov → Maustian sync boundary
- WHEN a single-product sync proposal targets Maustian from Plasticov
- THEN the system MUST allow proposal preparation
- AND it MUST include source seller, target seller, and site metadata

#### Scenario: Reversed direction is requested

- GIVEN configured `MLC` roles identify the approved Plasticov → Maustian sync boundary
- WHEN a request tries Maustian-to-Plasticov sync preparation
- THEN the system MUST block the request as unsafe direction
- AND it MUST NOT create a prepared proposal

#### Scenario: Seller role or site is unsafe

- GIVEN seller roles are missing, mismatched, arbitrary, or not `MLC`
- WHEN `sync_product` preparation is requested
- THEN the system MUST return a controlled blocked response
- AND it MUST NOT expose another seller's operational data or prepare a sync proposal

### Requirement: Seller-Scoped Operational Reads per Lane

Each seller lane (Plasticov, Maustian) MUST execute protected MercadoLibre reads scoped to its own configured `seller_id`. The system MUST NOT execute a read for one seller's lane using another seller's OAuth access.

#### Scenario: Plasticov lane reads own listings
- GIVEN Plasticov's OAuth access is valid and matches the configured seller_id
- WHEN the Plasticov lane reads listings via the operational ingestion pipeline
- THEN the system MUST use Plasticov's access token and return Plasticov's data only

#### Scenario: Cross-seller read blocked
- GIVEN Plasticov's OAuth token is the only valid access
- WHEN the Maustian lane attempts a protected read
- THEN the system MUST block the read as mismatched seller
- AND MUST NOT return Plasticov's operational data

### Requirement: Lane Ingestion Isolation

Background ingestion MUST respect seller-lane boundaries: Plasticov ingestion MUST use Plasticov's MercadoLibre access, Maustian MUST use Maustian's access. CEO aggregate reads SHALL NOT execute MercadoLibre API calls — only read from the operational store.

#### Scenario: Maustian ingestion scoped correctly
- GIVEN Maustian's background ingestion job starts
- WHEN it calls MercadoLibre APIs to fetch listings
- THEN it MUST pass Maustian's seller_id and use Maustian's OAuth access
- AND ingested snapshots MUST be tagged with Maustian's seller_id

### Requirement: Supplier ML Source Reads

Supplier Mirror MUST treat MercadoLibre supplier listings as the operational source for supplier stock. Official MercadoLibre APIs and current documentation/MCP reference MUST be used first; scraping MAY be used only as fallback evidence for data gaps and MUST remain isolated from mutation paths.

#### Scenario: API stock read succeeds
- GIVEN a supplier MercadoLibre item is readable through authorized or public API flow
- WHEN Supplier Mirror observes stock
- THEN the observation MUST cite ML API evidence as authoritative stock source

#### Scenario: API gap requires fallback
- GIVEN required supplier stock evidence is unavailable through API/docs-supported paths
- WHEN fallback collection runs
- THEN scraping MAY collect evidence with confidence metadata
- AND it MUST NOT execute MercadoLibre mutations

### Requirement: Symmetric Target Account Selection

MercadoLibre target operations for Supplier Mirror MUST select Plasticov, Maustian, or both from explicit supplier/item/category target policy. The old Plasticov→Maustian sync direction guard MUST NOT constrain Supplier Mirror targeting.

#### Scenario: Supplier targets Maustian only
- GIVEN target policy selects Maustian for a supplier item
- WHEN a mirror proposal is prepared
- THEN only Maustian account evidence and mappings MUST be used

#### Scenario: Both accounts targeted
- GIVEN target policy selects both accounts
- WHEN synchronization is evaluated
- THEN Plasticov and Maustian MUST be evaluated as independent targets
