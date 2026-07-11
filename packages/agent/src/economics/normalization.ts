import type { Currency, NormalizedCommerceTransaction } from "@msl/domain";
import { createMoney, createNormalizedCommerceTransaction } from "@msl/domain";

// ── Input types ──────────────────────────────────────────────────────────────

export type NormalizeOrdersInput = {
  orders: Array<{
    id: string;
    status: string;
    total_amount: number; // in ML's currency unit (e.g., CLP as-is in minor units)
    currency_id?: string; // "CLP" or "USD"
    date_created: string; // ISO date
    last_updated?: string;
    order_items: Array<{
      item: { id: string; title: string };
      quantity: number;
      unit_price: number;
    }>;
    payments?: Array<{ id: string; status: string }>;
    shipping?: { id?: string; status?: string };
    pack_id?: string;
  }>;
  sellerId: string;
  ingestionRunId: string;
};

// ── Normalization ────────────────────────────────────────────────────────────

/**
 * Normalize raw ML orders into NormalizedCommerceTransaction instances.
 *
 * Rules:
 * - One transaction per line item (not per order).
 * - If order_items is empty, zero transactions are produced for that order.
 * - Multi-item orders: each item gets its own transaction with the same orderId.
 * - quantity > 1: unitPrice = unit_price, grossRevenue = unit_price × quantity.
 * - Cancelled orders (status = "cancelled"): still normalized — adapters decide.
 * - No PII: buyer names, emails, phones, addresses, and documents are never read or stored.
 * - Currency defaults to "CLP" when currency_id is undefined.
 * - sourceVersion = last_updated ?? date_created.
 * - sourceEvidenceIds = ["order:{orderId}"].
 * - transactionId = "tx-{orderId}-{itemId}".
 * - occurredAt = parseISO(date_created) as epoch ms.
 * - updatedAt = parseISO(last_updated) ?? occurredAt.
 */
export function normalizeOrders(
  input: NormalizeOrdersInput,
): NormalizedCommerceTransaction[] {
  const results: NormalizedCommerceTransaction[] = [];

  for (const order of input.orders) {
    const currency = order.currency_id ?? "CLP";
    const sourceVersion = order.last_updated ?? order.date_created;
    const occurredAt = Date.parse(order.date_created);
    const updatedAt = order.last_updated ? Date.parse(order.last_updated) : occurredAt;
    const paymentStatus = order.payments?.[0]?.status;
    const shipmentStatus = order.shipping?.status;
    const paymentId = order.payments?.[0]?.id;
    const shipmentId = order.shipping?.id;

    if (order.order_items.length === 0) continue;

    for (const lineItem of order.order_items) {
      const unitPriceResult = createMoney(lineItem.unit_price, currency);
      if (!unitPriceResult.success) continue;

      const grossAmount = lineItem.unit_price * lineItem.quantity;
      const grossRevenueResult = createMoney(grossAmount, currency);
      if (!grossRevenueResult.success) continue;

      const txResult = createNormalizedCommerceTransaction({
        transactionId: `tx-${order.id}-${lineItem.item.id}`,
        sellerId: input.sellerId,
        channel: "mercadolibre",
        orderId: order.id,
        ...(order.pack_id !== undefined ? { packId: order.pack_id } : {}),
        ...(paymentId !== undefined ? { paymentId } : {}),
        ...(shipmentId !== undefined ? { shipmentId } : {}),
        itemId: lineItem.item.id,
        quantity: lineItem.quantity,
        unitPrice: unitPriceResult.money,
        grossRevenue: grossRevenueResult.money,
        currency: currency as Currency,
        orderStatus: order.status,
        ...(paymentStatus !== undefined ? { paymentStatus } : {}),
        ...(shipmentStatus !== undefined ? { shipmentStatus } : {}),
        occurredAt,
        updatedAt,
        sourceVersion,
        sourceEvidenceIds: [`order:${order.id}`],
        ingestionRunId: input.ingestionRunId,
      });

      if (txResult.success) {
        results.push(txResult.transaction);
      }
    }
  }

  return results;
}
