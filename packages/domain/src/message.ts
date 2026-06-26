import type { SellerId } from "./seller.js";

export type MessageId = string & { readonly __brand: "MessageId" };

export type MessageStatus = "unanswered" | "answered" | "closed";

export type MlMessage = {
  messageId: MessageId;
  sellerId: SellerId;
  itemId: string;
  from: "buyer" | "seller";
  text: string;
  status: MessageStatus;
  createdAt: string;
  answeredAt?: string;
};
