# ml-shipping-status Specification

## Purpose

Safe-read shipment status via `GET /marketplace/shipments/{id}` with `x-format-new: true` header. Returns typed shipment detail including status, tracking, logistics mode, and dimensions. No mutations — label generation, tracking updates, and status changes are deferred.

## Requirements

### Requirement: Shipment Status Read

The system MUST return typed shipment status for a given shipment ID via `MlcReadSnapshot<MlcShipmentStatusSummary>`. The snapshot SHALL include `source: "mercadolibre-api"`, freshness, confidence, and `noMutationExecuted: true`.

#### Scenario: In-transit shipment read

- GIVEN valid OAuth and a shipment in `ready_to_ship` or `shipped` status
- WHEN `getShipment(sellerId, shipmentId)` is called
- THEN the snapshot MUST return id, orderId, status, substatus, trackingNumber, trackingMethod, logistic mode/type, dates, and dimensions
- AND `noMutationExecuted` MUST be `true`

#### Scenario: Delivered shipment read

- GIVEN valid OAuth and a shipment with `delivered` status
- WHEN shipment status is read
- THEN the snapshot MUST return completed status with lastUpdated timestamp

#### Scenario: Shipment not found

- GIVEN valid OAuth but an unknown or invalid shipment ID
- WHEN shipment status is read
- THEN the system MUST return an error snapshot with degraded completeness and confidence metadata

#### Scenario: OAuth token missing or expired

- GIVEN seller OAuth is missing or expired
- WHEN shipment status is called
- THEN the system MUST return `ReconnectRequired` and SHALL NOT attempt the API call

#### Scenario: Upstream rate limited

- GIVEN the ML API returns HTTP 429
- WHEN shipment status is called
- THEN the snapshot MUST surface `rate-limited` metadata and SHALL NOT retry

### Requirement: Runtime Surface Classification

The capability MUST be classified as `safe-read` with runtime surface `read-tool`. The MCP tool SHALL NOT create approval requests and SHALL NOT execute mutations.

| Field | Value |
|-------|-------|
| Classification | `safe-read` |
| Endpoint | `GET /marketplace/shipments/{id}` (x-format-new: true) |
| Site support | MLC-to-confirm |
| Runtime surface | `read-tool` |
| Confidence | Medium |
