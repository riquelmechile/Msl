# PII Safety Policy: Economic Ingestion

## Principle
The economic ingestion pipeline processes MercadoLibre order data to extract financial metrics ONLY. At no point should personally identifiable information (PII) enter persistence, logs, or output.

## PII Definition (for this pipeline)

| Category | Examples | Action |
|----------|----------|--------|
| Buyer identity | Name, email, phone, document number, nickname | STRIP at normalization boundary |
| Buyer location | Shipping address, billing address, geolocation | STRIP at normalization boundary |
| Payment instruments | Card last 4, payment method ID, transaction auth codes | STRIP at normalization boundary |
| Order content | Item titles, descriptions, variations, buyer notes | STRIP (keep SKU/listing ID only) |
| ML internals | Access tokens, refresh tokens, client secrets, signed URLs, API keys | NEVER enter pipeline |

## Normalization Boundary

The `normalization.ts` module (existing, unchanged) is the PII boundary:
- Input: raw ML API response
- Output: `NormalizedOrder` with only economic fields (price, fees, shipping cost, status, dates, listing ID, SKU)

Fields preserved after normalization:
- `orderId` (ML internal ID)
- `sellerId`
- `listingId` / `itemId`
- `sku` (when available)
- `status` (paid, shipped, delivered, cancelled)
- `dateCreated`, `dateClosed`
- `totalAmount`, `currencyId`
- `saleFee` (when available)
- `shippingCost` (when available)
- `payments` (amount, status — no instrument details)
- `claims` (type, status, amount — no buyer communication)

## Verification Checklist

Before any persistence or output:

1. [ ] Normalization layer strips all PII fields
2. [ ] No raw ML response logged at INFO or above
3. [ ] JSON CLI output does not contain buyer data
4. [ ] CEO tool responses do not contain buyer data
5. [ ] Structured logs sanitized (existing secret sanitizer)
6. [ ] Test fixtures use synthetic data (no real buyer info)
7. [ ] `.gitignore` excludes `.env.local`, SQLite files, backups

## Violation Response

If PII is detected in any persisted data:
1. Stop pipeline immediately
2. Identify source (normalization gap)
3. Delete affected records
4. Fix normalization
5. Re-ingest with corrected normalization
6. Document the incident
