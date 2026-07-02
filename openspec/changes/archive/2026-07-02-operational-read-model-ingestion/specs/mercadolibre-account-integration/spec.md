# Delta for mercadolibre-account-integration

## ADDED Requirements

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
