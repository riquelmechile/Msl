import type { ImageQualityDecision, ProductLaunchStatus } from "@msl/domain";
import type { AgentMessage, AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";

export type ProductLaunchTask =
  | "vision-analyst"
  | "market-researcher"
  | "catalog-specialist"
  | "photo-director"
  | "image-scout"
  | "studio-artist"
  | "copywriter"
  | "spec-technician"
  | "quality-inspector";

export type ProductLaunchEnvelope = {
  launchId: string;
  sellerId: string;
  stage: ProductLaunchStatus;
  task: ProductLaunchTask;
  productId?: string;
  chatId?: number;
  imageUrls: string[];
  caption?: string;
  brand?: string;
  model?: string;
  color?: string;
  category?: string;
  categoryId?: string;
  searchTerms?: string[];
  specs?: string;
  suggestedPrice?: number;
  priceCurrency?: string;
  competitorPrices?: Array<{ source: string; price: number; currency?: string }>;
  catalogProductId?: string;
  qualityScore?: number;
  qualityDecision?: ImageQualityDecision;
  referenceUrls?: string[];
  images?: string[];
  listingTitle?: string;
  listingDescription?: string;
  attributesJson?: string;
  gtin?: string;
  hasFreeShipping?: boolean;
};

export function parseProductLaunchEnvelope(claim: AgentMessage): ProductLaunchEnvelope | undefined {
  let value: unknown;
  try {
    value = JSON.parse(claim.payloadJson);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const envelope = value as Partial<ProductLaunchEnvelope>;
  if (
    typeof envelope.launchId !== "string" ||
    !envelope.launchId ||
    typeof envelope.sellerId !== "string" ||
    !envelope.sellerId ||
    typeof envelope.stage !== "string" ||
    typeof envelope.task !== "string" ||
    !Array.isArray(envelope.imageUrls) ||
    (claim.sellerId !== null && claim.sellerId !== envelope.sellerId)
  ) {
    return undefined;
  }
  return envelope as ProductLaunchEnvelope;
}

export function enqueueProductLaunchResult(
  bus: AgentMessageBusStore,
  claim: AgentMessage,
  envelope: ProductLaunchEnvelope,
  updates: Partial<ProductLaunchEnvelope>,
): AgentMessage {
  const result: ProductLaunchEnvelope = { ...envelope, ...updates };
  return bus.enqueue({
    senderAgentId: claim.receiverAgentId,
    receiverAgentId: "product-launch",
    messageType: "launch_stage_complete",
    payloadJson: JSON.stringify(result),
    dedupeKey: `launch-result:${result.launchId}:${result.stage}:${result.task}`,
    correlationId: result.launchId,
    parentMessageId: claim.messageId,
    sellerId: result.sellerId,
  });
}
