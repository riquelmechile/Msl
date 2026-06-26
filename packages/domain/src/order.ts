import type { SellerId } from "./seller.js";

export type OrderId = string & { readonly __brand: "OrderId" };

export type OrderStatus = "pending" | "paid" | "shipped" | "delivered" | "cancelled" | "returned";

export type MlOrder = {
  orderId: OrderId;
  sellerId: SellerId;
  buyerId: string;
  status: OrderStatus;
  totalAmount: number; // CLP
  items: ReadonlyArray<{
    itemId: string;
    title: string;
    quantity: number;
    unitPrice: number;
  }>;
  createdAt: string;
  shippedAt?: string;
  deliveredAt?: string;
};
