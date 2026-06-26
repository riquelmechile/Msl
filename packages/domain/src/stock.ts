import type { SellerId } from "./seller.js";

export type StockRecord = {
  sellerId: SellerId;
  itemId: string;
  availableQuantity: number;
  reservedQuantity: number;
  minimumThreshold: number;
  lastUpdated: string;
};
