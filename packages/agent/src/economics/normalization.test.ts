import { describe, it, expect } from "vitest";
import { normalizeOrders, type NormalizeOrdersInput } from "./normalization.js";

const BASE_INPUT: NormalizeOrdersInput = {
  sellerId: "seller-1",
  ingestionRunId: "run-1",
  orders: [],
};

function makeInput(overrides: Partial<NormalizeOrdersInput>): NormalizeOrdersInput {
  return { ...BASE_INPUT, ...overrides };
}

describe("normalizeOrders", () => {
  it("produces one transaction per line item from a single-item order", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-1",
          status: "paid",
          total_amount: 15990,
          currency_id: "CLP",
          date_created: "2025-07-01T10:00:00Z",
          order_items: [
            {
              item: { id: "item-a", title: "Product A" },
              quantity: 1,
              unit_price: 15990,
            },
          ],
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toHaveLength(1);
    const tx = result[0]!;
    expect(tx.transactionId).toBe("tx-order-1-item-a");
    expect(tx.itemId).toBe("item-a");
    expect(tx.quantity).toBe(1);
    expect(tx.unitPrice.amountMinor).toBe(15990);
    expect(tx.grossRevenue.amountMinor).toBe(15990);
    expect(tx.currency).toBe("CLP");
    expect(tx.orderStatus).toBe("paid");
    expect(tx.channel).toBe("mercadolibre");
    expect(tx.sellerId).toBe("seller-1");
    expect(tx.ingestionRunId).toBe("run-1");
    expect(tx.sourceEvidenceIds).toEqual(["order:order-1"]);
  });

  it("produces N transactions for a multi-item order with same orderId", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-2",
          status: "paid",
          total_amount: 30000,
          currency_id: "CLP",
          date_created: "2025-07-02T14:00:00Z",
          order_items: [
            {
              item: { id: "item-x", title: "Product X" },
              quantity: 2,
              unit_price: 10000,
            },
            {
              item: { id: "item-y", title: "Product Y" },
              quantity: 1,
              unit_price: 10000,
            },
          ],
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toHaveLength(2);

    // Both share the same orderId
    expect(result[0]!.orderId).toBe("order-2");
    expect(result[1]!.orderId).toBe("order-2");

    const itemX = result.find((t) => t.itemId === "item-x")!;
    expect(itemX).toBeDefined();
    expect(itemX.quantity).toBe(2);
    expect(itemX.unitPrice.amountMinor).toBe(10000);
    expect(itemX.grossRevenue.amountMinor).toBe(20000); // 10000 × 2

    const itemY = result.find((t) => t.itemId === "item-y")!;
    expect(itemY).toBeDefined();
    expect(itemY.quantity).toBe(1);
    expect(itemY.unitPrice.amountMinor).toBe(10000);
    expect(itemY.grossRevenue.amountMinor).toBe(10000);
  });

  it("handles quantity > 1 with correct unitPrice and grossRevenue", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-3",
          status: "paid",
          total_amount: 50000,
          currency_id: "CLP",
          date_created: "2025-07-03T09:00:00Z",
          order_items: [
            {
              item: { id: "item-bulk", title: "Bulk Item" },
              quantity: 5,
              unit_price: 10000,
            },
          ],
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toHaveLength(1);
    const tx = result[0]!;
    expect(tx.quantity).toBe(5);
    expect(tx.unitPrice.amountMinor).toBe(10000);
    expect(tx.grossRevenue.amountMinor).toBe(50000); // 10000 × 5
  });

  it("still normalizes cancelled orders without exclusion", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-cancelled",
          status: "cancelled",
          total_amount: 10000,
          currency_id: "CLP",
          date_created: "2025-07-04T08:00:00Z",
          order_items: [
            {
              item: { id: "item-q", title: "Cancelled Item" },
              quantity: 1,
              unit_price: 10000,
            },
          ],
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toHaveLength(1);
    const tx = result[0]!;
    expect(tx.orderStatus).toBe("cancelled");
    expect(tx.grossRevenue.amountMinor).toBe(10000);
  });

  it("ensures no PII fields exist in output (no buyer names, emails, phones, addresses)", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-pii",
          status: "paid",
          total_amount: 10000,
          currency_id: "CLP",
          date_created: "2025-07-05T12:00:00Z",
          order_items: [
            {
              item: { id: "item-p", title: "PII Test" },
              quantity: 1,
              unit_price: 10000,
            },
          ],
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toHaveLength(1);
    const tx = result[0]!;

    // Verify no PII keys exist anywhere
    const record = tx as Record<string, unknown>;
    const allKeys = Object.keys(record);
    const piiKeys = allKeys.filter(
      (k) =>
        k.toLowerCase().includes("buyer") ||
        k.toLowerCase().includes("email") ||
        k.toLowerCase().includes("phone") ||
        k.toLowerCase().includes("address") ||
        k.toLowerCase().includes("document") ||
        k.toLowerCase().includes("dni") ||
        k.toLowerCase().includes("passport"),
    );
    expect(piiKeys).toEqual([]);
  });

  it("defaults currency to CLP when currency_id is undefined", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-nocurrency",
          status: "paid",
          total_amount: 20000,
          // no currency_id
          date_created: "2025-07-06T10:00:00Z",
          order_items: [
            {
              item: { id: "item-d", title: "Default Currency" },
              quantity: 1,
              unit_price: 20000,
            },
          ],
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toHaveLength(1);
    const tx = result[0]!;
    expect(tx.currency).toBe("CLP");
    expect(tx.unitPrice.currency).toBe("CLP");
    expect(tx.grossRevenue.currency).toBe("CLP");
  });

  it("propagates pack_id to normalized transactions", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-pack",
          status: "paid",
          total_amount: 15000,
          currency_id: "CLP",
          date_created: "2025-07-07T11:00:00Z",
          pack_id: "pack-xyz",
          order_items: [
            {
              item: { id: "item-e", title: "Packed Item" },
              quantity: 1,
              unit_price: 15000,
            },
          ],
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toHaveLength(1);
    const tx = result[0]!;
    expect(tx.packId).toBe("pack-xyz");
  });

  it("returns empty array for empty order_items", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-empty",
          status: "paid",
          total_amount: 0,
          currency_id: "CLP",
          date_created: "2025-07-08T09:00:00Z",
          order_items: [],
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toEqual([]);
  });

  it("returns empty array for mixed orders (one empty, one with items)", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-empty-2",
          status: "paid",
          total_amount: 0,
          currency_id: "CLP",
          date_created: "2025-07-08T09:00:00Z",
          order_items: [],
        },
        {
          id: "order-with-item",
          status: "paid",
          total_amount: 5000,
          currency_id: "CLP",
          date_created: "2025-07-08T10:00:00Z",
          order_items: [
            {
              item: { id: "item-f", title: "Valid Item" },
              quantity: 1,
              unit_price: 5000,
            },
          ],
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.orderId).toBe("order-with-item");
  });

  it("sets paymentStatus from payments[0].status when present", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-payment",
          status: "paid",
          total_amount: 10000,
          currency_id: "CLP",
          date_created: "2025-07-09T10:00:00Z",
          order_items: [
            {
              item: { id: "item-pay", title: "Paid Item" },
              quantity: 1,
              unit_price: 10000,
            },
          ],
          payments: [{ id: "pay-1", status: "approved" }],
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toHaveLength(1);
    const tx = result[0]!;
    expect(tx.paymentStatus).toBe("approved");
    expect(tx.paymentId).toBe("pay-1");
  });

  it("sets shipmentStatus from shipping.status when present", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-ship",
          status: "paid",
          total_amount: 10000,
          currency_id: "CLP",
          date_created: "2025-07-10T10:00:00Z",
          order_items: [
            {
              item: { id: "item-s", title: "Shipped Item" },
              quantity: 1,
              unit_price: 10000,
            },
          ],
          shipping: { id: "ship-1", status: "delivered" },
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toHaveLength(1);
    const tx = result[0]!;
    expect(tx.shipmentStatus).toBe("delivered");
    expect(tx.shipmentId).toBe("ship-1");
  });

  it("uses last_updated for sourceVersion when available", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-updated",
          status: "paid",
          total_amount: 10000,
          currency_id: "CLP",
          date_created: "2025-07-11T08:00:00Z",
          last_updated: "2025-07-11T12:00:00Z",
          order_items: [
            {
              item: { id: "item-u", title: "Updated" },
              quantity: 1,
              unit_price: 10000,
            },
          ],
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toHaveLength(1);
    const tx = result[0]!;
    expect(tx.sourceVersion).toBe("2025-07-11T12:00:00Z");
    expect(tx.updatedAt).toBe(Date.parse("2025-07-11T12:00:00Z"));
  });

  it("falls back to date_created for sourceVersion when last_updated is missing", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-noupdate",
          status: "paid",
          total_amount: 10000,
          currency_id: "CLP",
          date_created: "2025-07-12T10:00:00Z",
          order_items: [
            {
              item: { id: "item-v", title: "No Update" },
              quantity: 1,
              unit_price: 10000,
            },
          ],
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toHaveLength(1);
    const tx = result[0]!;
    expect(tx.sourceVersion).toBe("2025-07-12T10:00:00Z");
    expect(tx.updatedAt).toBe(Date.parse("2025-07-12T10:00:00Z"));
  });

  it("sets correct occurredAt from date_created", () => {
    const input = makeInput({
      orders: [
        {
          id: "order-time",
          status: "paid",
          total_amount: 10000,
          currency_id: "CLP",
          date_created: "2025-07-13T15:30:00Z",
          order_items: [
            {
              item: { id: "item-t", title: "Timed" },
              quantity: 1,
              unit_price: 10000,
            },
          ],
        },
      ],
    });

    const result = normalizeOrders(input);
    expect(result).toHaveLength(1);
    const tx = result[0]!;
    expect(tx.occurredAt).toBe(Date.parse("2025-07-13T15:30:00Z"));
  });
});
