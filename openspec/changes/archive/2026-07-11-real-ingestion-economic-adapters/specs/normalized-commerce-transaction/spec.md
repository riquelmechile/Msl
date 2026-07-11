# Normalized Commerce Transaction Specification

## Purpose

A denormalized commerce-transaction type representing one line item from a MercadoLibre order, stripped of PII, ready for economic processing.

## Requirements

### Requirement: NormalizedCommerceTransaction Type

The system MUST define `NormalizedCommerceTransaction` with fields: `transactionId`, `sellerId`, `accountId?`, `channel`, `orderId`, `packId?`, `paymentId?`, `shipmentId?`, `itemId`, `variationId?`, `sku?`, `quantity`, `unitPrice` (Money), `grossRevenue` (Money), `currency`, `orderStatus`, `paymentStatus`, `shipmentStatus`, `occurredAt`, `updatedAt`, `sourceVersion`, `sourceEvidenceIds`, `ingestionRunId`, `noExternalMutationExecuted: true`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Single-item order | Order with 1 item | Normalize | 1 transaction, `itemId` populated |
| Multi-item order | Order with 3 items | Normalize | 3 transactions, same `orderId`, distinct `itemId` |
| Multi-item with pack | 2 items in pack P1 | Normalize | Both transactions get `packId: "P1"`, `orderId` preserved |
| Cancelled order | Order status `cancelled`, unpaid | Normalize | Transaction created, `orderStatus: "cancelled"`, `grossRevenue: 0` |

### Requirement: PII Exclusion

The system MUST NOT store any PII: no buyer names, addresses, phones, emails, or documents. Only seller-scoped commercial identifiers SHALL be persisted.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| ML order with buyer data | Raw order has buyer name, email, phone | Normalize | Output contains none of those fields |

### Requirement: Edge Case Handling

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Partial payment | Order partially paid | Normalize | Payment amounts reflected, `paymentStatus` shows partial |
| Multi-payment | Order paid in 2 installments | Normalize | Each payment generates separate payment reference |
| Discount applied | 10% seller discount on item | Normalize | `grossRevenue` reflects net after discount |
| Promotion | ML-funded promotion on item | Normalize | `grossRevenue` reflects price after promotion |
| Partial refund | 1 of 3 items refunded | Normalize | Refunded item's transaction reflects refund status |
| Quantity > 1 | Item with quantity=5 | Normalize | `quantity: 5, unitPrice` and `grossRevenue` reflect total |

### Requirement: Domain Type Compatibility

The system MUST use existing domain types: `Money` with `amountMinor` integer (CLP pesos), `Currency = "CLP" | "USD"`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| CLP order | ML order in CLP, price 15990 | Normalize | `grossRevenue: { amountMinor: 15990, currency: "CLP" }` |
| USD order | ML order in USD, price 49.99 | Normalize | `grossRevenue: { amountMinor: 4999, currency: "USD" }` |
