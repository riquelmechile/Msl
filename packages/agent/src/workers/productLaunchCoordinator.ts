import type { ProductLaunchStatus } from "@msl/domain";
import type { AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";
import type { CeoHandlerContext, DaemonFinding, DaemonHandler } from "./daemonTypes.js";
import {
  parseProductLaunchEnvelope,
  type ProductLaunchEnvelope,
  type ProductLaunchTask,
} from "./productLaunchEnvelope.js";

type CoordinatorContext = Parameters<DaemonHandler>[0];

function alert(summary: string, messageId: string): DaemonFinding {
  return { kind: "alert", severity: "warning", summary, evidenceIds: [messageId] };
}

function parseLaunchRequest(ctx: CoordinatorContext): ProductLaunchEnvelope | undefined {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(ctx.claim.payloadJson) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const launchId = typeof payload.launchId === "string" ? payload.launchId : "";
  const sellerId = typeof payload.sellerId === "string" ? payload.sellerId : "";
  if (!launchId || !sellerId || (ctx.claim.sellerId && ctx.claim.sellerId !== sellerId)) {
    return undefined;
  }
  return {
    launchId,
    sellerId,
    stage: "photo_received",
    task: "vision-analyst",
    imageUrls: Array.isArray(payload.imageUrls)
      ? payload.imageUrls.filter((value): value is string => typeof value === "string")
      : typeof payload.imageUrl === "string"
        ? [payload.imageUrl]
        : [],
    ...(typeof payload.productId === "string" ? { productId: payload.productId } : {}),
    ...(typeof payload.chatId === "number" ? { chatId: payload.chatId } : {}),
    ...(typeof payload.caption === "string" ? { caption: payload.caption } : {}),
  };
}

function delegate(
  bus: AgentMessageBusStore,
  envelope: ProductLaunchEnvelope,
  receiverAgentId: string,
  stage: ProductLaunchStatus,
  task: ProductLaunchTask,
): string {
  const next = { ...envelope, stage, task };
  const message = bus.enqueue({
    senderAgentId: "product-launch",
    receiverAgentId,
    messageType: "launch_stage_work",
    payloadJson: JSON.stringify(next),
    dedupeKey: `launch-work:${next.launchId}:${stage}:${task}`,
    correlationId: next.launchId,
    sellerId: next.sellerId,
  });
  return message.messageId;
}

async function notify(
  envelope: ProductLaunchEnvelope,
  text: string,
  bus: AgentMessageBusStore,
  ceoContext: CeoHandlerContext | undefined,
): Promise<string> {
  const message = bus.enqueue({
    senderAgentId: "product-launch",
    receiverAgentId: "ceo",
    messageType: "progress",
    payloadJson: JSON.stringify({
      launchId: envelope.launchId,
      sellerId: envelope.sellerId,
      stage: envelope.stage,
      text,
      noMutationExecuted: true,
    }),
    dedupeKey: `launch-progress:${envelope.launchId}:${envelope.stage}:${envelope.task}`,
    correlationId: envelope.launchId,
    sellerId: envelope.sellerId,
  });
  if (ceoContext?.sendProactiveMessage && envelope.chatId !== undefined) {
    try {
      await ceoContext.sendProactiveMessage(envelope.chatId, text);
    } catch {
      // Telegram delivery is non-blocking; the durable bus message remains available.
    }
  }
  return message.messageId;
}

function transitionAndDelegate(
  ctx: CoordinatorContext,
  envelope: ProductLaunchEnvelope,
  nextStatus: ProductLaunchStatus,
  receiverAgentId: string,
  task: ProductLaunchTask,
): string | undefined {
  const transitioned = ctx.productCatalogStore!.transitionLaunchStatus(
    envelope.launchId,
    envelope.sellerId,
    envelope.stage,
    nextStatus,
  );
  if (
    !transitioned &&
    ctx.productCatalogStore!.getLaunchForSeller(envelope.launchId, envelope.sellerId)?.status !==
      nextStatus
  ) {
    return undefined;
  }
  return delegate(ctx.bus, envelope, receiverAgentId, nextStatus, task);
}

function delegateSubstep(
  ctx: CoordinatorContext,
  envelope: ProductLaunchEnvelope,
  receiverAgentId: string,
  task: ProductLaunchTask,
): string {
  return delegate(ctx.bus, envelope, receiverAgentId, envelope.stage, task);
}

export const productLaunchCoordinator: DaemonHandler = async (ctx) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];
  const store = ctx.productCatalogStore;
  if (!store) {
    return {
      findings: [
        alert("Product launch coordinator: catalog store is unavailable", ctx.claim.messageId),
      ],
      proposalEnqueued: false,
      messageIds,
    };
  }

  if (ctx.claim.messageType === "launch_request") {
    const envelope = parseLaunchRequest(ctx);
    if (!envelope || envelope.imageUrls.length === 0) {
      return {
        findings: [
          alert("Product launch coordinator: invalid launch request", ctx.claim.messageId),
        ],
        proposalEnqueued: false,
        messageIds,
      };
    }
    const launch = store.getLaunchForSeller(envelope.launchId, envelope.sellerId);
    if (!launch || (launch.status !== "photo_received" && launch.status !== "recognizing")) {
      return {
        findings: [
          alert(
            "Product launch coordinator: launch request is missing or out of order",
            ctx.claim.messageId,
          ),
        ],
        proposalEnqueued: false,
        messageIds,
      };
    }
    const delegated = transitionAndDelegate(
      ctx,
      envelope,
      "recognizing",
      "product-recognition",
      "vision-analyst",
    );
    if (delegated) messageIds.push(delegated);
    messageIds.push(
      await notify(
        envelope,
        "Product photo received. Starting recognition.",
        ctx.bus,
        ctx.ceoContext,
      ),
    );
    return { findings, proposalEnqueued: messageIds.length > 0, messageIds };
  }

  if (ctx.claim.messageType === "additional_photo") {
    const request = parseLaunchRequest(ctx);
    if (!request) {
      return {
        findings: [
          alert("Product launch coordinator: invalid additional photo", ctx.claim.messageId),
        ],
        proposalEnqueued: false,
        messageIds,
      };
    }
    const launch = store.getLaunchForSeller(request.launchId, request.sellerId);
    if (!launch || (launch.status !== "photo_received" && launch.status !== "recognizing")) {
      return {
        findings: [
          alert(
            "Product launch coordinator: additional photo is out of order",
            ctx.claim.messageId,
          ),
        ],
        proposalEnqueued: false,
        messageIds,
      };
    }
    const envelope = { ...request, stage: "recognizing" as const };
    if (launch.status === "photo_received") {
      store.transitionLaunchStatus(
        request.launchId,
        request.sellerId,
        "photo_received",
        "recognizing",
      );
    }
    messageIds.push(
      delegate(ctx.bus, envelope, "product-recognition", "recognizing", "vision-analyst"),
    );
    return { findings, proposalEnqueued: true, messageIds };
  }

  if (ctx.claim.messageType === "launch_approved") {
    let payload: { launchId?: string; sellerId?: string; chatId?: number };
    try {
      payload = JSON.parse(ctx.claim.payloadJson) as typeof payload;
    } catch {
      payload = {};
    }
    const sellerId = payload.sellerId ?? ctx.claim.sellerId ?? "";
    const launchId = payload.launchId ?? "";
    const launch = store.getLaunchForSeller(launchId, sellerId);
    if (!launch || launch.status !== "approved") {
      return {
        findings: [
          alert(
            "Product launch coordinator: approval is missing or out of order",
            ctx.claim.messageId,
          ),
        ],
        proposalEnqueued: false,
        messageIds,
      };
    }
    store.transitionLaunchStatus(launchId, sellerId, "approved", "ready_to_publish");
    const envelope: ProductLaunchEnvelope = {
      launchId,
      sellerId,
      stage: "ready_to_publish",
      task: "quality-inspector",
      imageUrls: [],
      ...(payload.chatId !== undefined ? { chatId: payload.chatId } : {}),
    };
    messageIds.push(
      await notify(
        envelope,
        "Listing approved and ready to publish. MercadoLibre publishing remains blocked.",
        ctx.bus,
        ctx.ceoContext,
      ),
    );
    return { findings, proposalEnqueued: true, messageIds };
  }

  if (ctx.claim.messageType !== "launch_stage_complete") {
    return {
      findings: [
        alert("Product launch coordinator: unsupported message type", ctx.claim.messageId),
      ],
      proposalEnqueued: false,
      messageIds,
    };
  }

  const envelope = parseProductLaunchEnvelope(ctx.claim);
  if (!envelope) {
    return {
      findings: [alert("Product launch coordinator: invalid stage envelope", ctx.claim.messageId)],
      proposalEnqueued: false,
      messageIds,
    };
  }
  const launch = store.getLaunchForSeller(envelope.launchId, envelope.sellerId);
  const replayStatus =
    envelope.stage === "recognizing" && envelope.task === "vision-analyst"
      ? "researching"
      : envelope.stage === "researching" && envelope.task === "catalog-specialist"
        ? "generating_creative"
        : envelope.stage === "generating_creative" && envelope.task === "studio-artist"
          ? "composing"
          : undefined;
  if (!launch || (launch.status !== envelope.stage && launch.status !== replayStatus)) {
    return {
      findings: [
        alert(
          "Product launch coordinator: duplicate or out-of-order stage result",
          ctx.claim.messageId,
        ),
      ],
      proposalEnqueued: false,
      messageIds,
    };
  }

  if (envelope.stage === "recognizing" && envelope.task === "vision-analyst") {
    const id = transitionAndDelegate(
      ctx,
      envelope,
      "researching",
      "product-research",
      "market-researcher",
    );
    if (id) messageIds.push(id);
  } else if (envelope.stage === "researching" && envelope.task === "market-researcher") {
    messageIds.push(delegateSubstep(ctx, envelope, "product-research", "catalog-specialist"));
  } else if (envelope.stage === "researching" && envelope.task === "catalog-specialist") {
    const id = transitionAndDelegate(
      ctx,
      envelope,
      "generating_creative",
      "creative-production",
      "photo-director",
    );
    if (id) messageIds.push(id);
  } else if (envelope.stage === "generating_creative" && envelope.task === "photo-director") {
    const task: ProductLaunchTask =
      envelope.qualityDecision === "DISCARD_AND_SEARCH" ? "image-scout" : "studio-artist";
    messageIds.push(delegateSubstep(ctx, envelope, "creative-production", task));
  } else if (envelope.stage === "generating_creative" && envelope.task === "image-scout") {
    messageIds.push(delegateSubstep(ctx, envelope, "creative-production", "studio-artist"));
  } else if (envelope.stage === "generating_creative" && envelope.task === "studio-artist") {
    const id = transitionAndDelegate(
      ctx,
      envelope,
      "composing",
      "listing-composition",
      "copywriter",
    );
    if (id) messageIds.push(id);
  } else if (envelope.stage === "composing" && envelope.task === "copywriter") {
    messageIds.push(delegateSubstep(ctx, envelope, "listing-composition", "spec-technician"));
  } else if (envelope.stage === "composing" && envelope.task === "spec-technician") {
    messageIds.push(delegateSubstep(ctx, envelope, "listing-composition", "quality-inspector"));
  } else if (envelope.stage === "composing" && envelope.task === "quality-inspector") {
    store.updateLaunchDetails(envelope.launchId, envelope.sellerId, {
      ...(envelope.listingTitle ? { title: envelope.listingTitle } : {}),
      ...(envelope.listingDescription ? { description: envelope.listingDescription } : {}),
      ...(envelope.suggestedPrice !== undefined ? { priceAmount: envelope.suggestedPrice } : {}),
      ...(envelope.priceCurrency ? { priceCurrency: envelope.priceCurrency } : {}),
      ...(envelope.qualityScore !== undefined
        ? { qualityScorePredicted: envelope.qualityScore }
        : {}),
    });
    const proposal = ctx.bus.enqueue({
      senderAgentId: "product-launch",
      receiverAgentId: "ceo",
      messageType: "proposal",
      payloadJson: JSON.stringify({
        type: "proposal",
        launchId: envelope.launchId,
        sellerId: envelope.sellerId,
        title: envelope.listingTitle,
        description: envelope.listingDescription,
        suggestedPrice: envelope.suggestedPrice,
        images: envelope.images ?? envelope.imageUrls,
        stage: "awaiting_approval",
        action: { kind: "approve_launch", id: envelope.launchId },
        noMutationExecuted: true,
      }),
      dedupeKey: `launch-approval:${envelope.launchId}`,
      correlationId: envelope.launchId,
      sellerId: envelope.sellerId,
    });
    const transitioned = store.transitionLaunchStatus(
      envelope.launchId,
      envelope.sellerId,
      "composing",
      "awaiting_approval",
    );
    if (transitioned) messageIds.push(proposal.messageId);
  } else {
    findings.push(
      alert("Product launch coordinator: invalid task for current stage", ctx.claim.messageId),
    );
  }

  return { findings, proposalEnqueued: messageIds.length > 0, messageIds };
};
