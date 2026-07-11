# PII & Secrets Policy — What's Never Stored, What's Stored, Sanitization Rules

## What Is NEVER Stored

The following data fields are stripped during normalization and never reach any persistent store:

| Category | Fields | Stripping Point |
|----------|--------|----------------|
| Buyer identity | Name, email, phone number, document ID | `normalization.ts` |
| Buyer location | Street address, coordinates, neighborhood | `normalization.ts` |
| Payment details | Card brand, last digits, payment method ID, bank | `normalization.ts` |
| ML auth tokens | Access tokens, refresh tokens, client secrets | Never enter this pipeline |

## What IS Stored

| Field | Purpose | Storage |
|-------|---------|---------|
| Seller ID | Seller isolation | All tables |
| Order ID | Transaction linking | Cost components, snapshots |
| Item ID | Line-item tracking | Cost components, snapshots |
| SKU | Product identification | Snapshots |
| Gross revenue (minor units) | Financial calculation | Snapshots |
| Cost amounts (minor units) | Financial calculation | Cost components |
| Currency (CLP/USD) | Financial calculation | Cost components, snapshots |
| ML fee amounts | Marketplace commission | Cost components |
| Ad spend amounts | Advertising cost | Cost components |
| Timestamps (occurredAt, observedAt) | Temporal tracking | Cost components |
| Checksums (SHA-256 of selected economic fields) | Evidence provenance | Evidence references |
| Source system + record ID | Traceability | Cost components, evidence refs |

## Sanitization Rules

### During Normalization
```
NormalizedCommerceTransaction contains:
  ✅ sellerId
  ✅ orderId
  ✅ itemId
  ✅ quantity
  ✅ unitPrice (Money type)
  ✅ grossRevenue (Money type)
  ✅ currency
  ✅ orderStatus
  ✅ sourceVersion
  ❌ buyer name
  ❌ buyer email
  ❌ buyer phone
  ❌ buyer address
  ❌ payment method
```

### During Evidence Reference Creation
- SHA-256 hash computed over: `sellerId + sourceSystem + sourceRecordId + economicMeaning + amountMinor + currency`
- Raw data is NOT stored in the evidence reference
- The hash can be recomputed for verification without storing sensitive data

## Secrets Movement

- The pipeline reads OAuth tokens from `@msl/mercadolibre` token store (encrypted with `MSL_ENCRYPTION_KEY`)
- Tokens are never passed as bare strings through the pipeline — they stay in the ML client layer
- The daemon scheduler injects a pre-configured `MlcApiClient` with tokens already resolved
- No secrets appear in logs (observability pipeline sanitizes context)

## Audit Trail

All cost component mutations leave an audit trail:
- `insertCostComponent` — always, with idempotency
- `upsertCostComponent` — supersedes old, inserts new (old preserved)
- `reverseCostComponent` — sets `reversedAt` + `reversedReason` (row preserved)
- Snapshots are immutable — never updated, only inserted
