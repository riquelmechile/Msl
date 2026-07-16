import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import type { CeoHandlerContext } from "./daemonTypes.js";
import {
  LaunchCostTracker,
  LAUNCH_COST_ESTIMATES,
} from "../economics/launchCostTracker.js";

// ── Pipeline Stage Definitions ────────────────────────────────────────

type PipelineStage =
  | "photo_received"
  | "recognizing"
  | "researching"
  | "generating_creative"
  | "composing"
  | "awaiting_approval"
  | "approved"
  | "ready_to_publish"
  | "rejected";

const _STAGE_LABELS: Record<PipelineStage, string> = {
  photo_received: "📸 Foto recibida",
  recognizing: "🔍 Identificando producto…",
  researching: "📊 Investigando specs y precios…",
  generating_creative: "🎨 Generando imágenes profesionales…",
  composing: "📦 Componiendo publicación…",
  awaiting_approval: "✅ Esperando aprobación",
  approved: "👍 Aprobada — preparando publicación",
  ready_to_publish: "🚀 Lista para publicar",
  rejected: "❌ Rechazada",
};

const STAGE_EMOJI: Record<PipelineStage, string> = {
  photo_received: "📸",
  recognizing: "🔍",
  researching: "📊",
  generating_creative: "🎨",
  composing: "📝",
  awaiting_approval: "👀",
  approved: "✅",
  ready_to_publish: "🚀",
  rejected: "❌",
};

// ── Coordinator State ─────────────────────────────────────────────────

type CoordinatorPayload = {
  launchId: string;
  productId?: string;
  sellerId?: string;
  imageUrls?: string[];
  caption?: string;
  chatId?: number;
  // Pipeline context accumulator
  brand?: string;
  model?: string;
  color?: string;
  category?: string;
  searchTerms?: string[];
  specs?: string;
  suggestedPrice?: number;
  priceCurrency?: string;
  listingTitle?: string;
  listingDescription?: string;
  qualityScore?: number;
  images?: string[];
  costTotalUsd?: number;
};

// ── In-memory cost tracker (per-process, survives across daemon ticks) ─

const costTracker = new LaunchCostTracker();

// ── Daemon Handler ───────────────────────────────────────────────────

/**
 * Product Launch Coordinator daemon handler.
 *
 * Claims messages with `receiverAgentId: "product-launch"` and orchestrates
 * the full product launch pipeline via Agent Message Bus delegation.
 *
 * State machine:
 *   photo_received → recognizing → researching → generating_creative
 *   → composing → awaiting_approval → approved → ready_to_publish
 *                                               ↘ rejected
 *
 * Each stage delegates to specialist workers. The coordinator polls for the
 * next stage message via the daemon scheduler's claim cycle.
 *
 * Stub mode: when no specialist workers are available, simulates pipeline
 * progression with delayed state transitions (suitable for testing).
 */
export const productLaunchCoordinator: DaemonHandler = async ({ claim, bus, ceoContext }) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  // ── 1. Parse payload ──────────────────────────────────────────
  let payload: CoordinatorPayload;
  try {
    payload = JSON.parse(claim.payloadJson) as CoordinatorPayload;
  } catch {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "ProductLaunchCoordinator: invalid payload — could not parse CoordinatorPayload",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  if (!payload.launchId) {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "ProductLaunchCoordinator: missing launchId in payload",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  const launchId = payload.launchId;
  const _chatId = payload.chatId;
  const _sellerId = payload.sellerId ?? "unknown";

  // ── 2. Determine current stage from payload or message type ──
  const messageType = claim.messageType;

  // Resolve the current pipeline stage
  let currentStage: PipelineStage;
  if (messageType === "launch_request") {
    currentStage = "photo_received";
  } else if (messageType === "launch_approved") {
    currentStage = "approved";
  } else if (messageType === "stage_complete" || messageType === "finding") {
    // Child worker completed — extract stage from payload
    currentStage = (payload as Record<string, unknown>).completedStage as PipelineStage;
    if (!currentStage) {
      // Fall back to determining from payload context
      if (payload.brand && payload.model && payload.searchTerms) {
        currentStage = "recognizing";
      } else if (payload.specs && payload.suggestedPrice) {
        currentStage = "researching";
      } else if (payload.qualityScore !== undefined) {
        currentStage = "generating_creative";
      } else if (payload.listingTitle && payload.listingDescription) {
        currentStage = "composing";
      } else {
        currentStage = "photo_received";
      }
    }
  } else {
    // Unknown message type — assume it's a continuation
    currentStage =
      ((payload as Record<string, unknown>).stage as PipelineStage) ?? "photo_received";
  }

  // ── 3. Route to next stage ────────────────────────────────────
  const nextStage = getNextStage(currentStage);

  if (!nextStage) {
    // Terminal state — nothing more to do
    findings.push({
      kind: "info",
      severity: "info",
      summary: `ProductLaunchCoordinator: launch "${launchId}" reached terminal stage "${currentStage}"`,
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 4. Execute pipeline stage ──────────────────────────────────

  switch (currentStage) {
    case "photo_received":
      await handlePhotoReceived(payload, bus, findings, messageIds, ceoContext);
      break;
    case "recognizing":
      await handleRecognizing(payload, bus, findings, messageIds, ceoContext);
      break;
    case "researching":
      await handleResearching(payload, bus, findings, messageIds, ceoContext);
      break;
    case "generating_creative":
      await handleGeneratingCreative(payload, bus, findings, messageIds, ceoContext);
      break;
    case "composing":
      await handleComposing(payload, bus, findings, messageIds, ceoContext);
      break;
    case "awaiting_approval":
      await handleAwaitingApproval(payload, bus, findings, messageIds, ceoContext);
      break;
    case "approved":
      await handleApproved(payload, bus, findings, messageIds, ceoContext);
      break;
    default:
      // Unknown stage — send to CEO
      await sendProgress(
        payload,
        currentStage,
        "⚠️ Estado desconocido",
        ceoContext,
        messageIds,
        bus,
      );
  }

  // ── 5. Track costs ────────────────────────────────────────────
  const totalCost = costTracker.getTotalCost(launchId);
  if (totalCost > 0) {
    findings.push({
      kind: "info",
      severity: "info",
      summary: `ProductLaunchCoordinator: accumulated cost $${totalCost.toFixed(4)} for launch "${launchId}"`,
      evidenceIds: [claim.messageId],
    });
  }

  return {
    findings,
    proposalEnqueued: messageIds.length > 0,
    messageIds,
  };
};

// ── Stage Handlers ────────────────────────────────────────────────────

async function handlePhotoReceived(
  payload: CoordinatorPayload,
  bus: Parameters<DaemonHandler>[0]["bus"],
  findings: DaemonFinding[],
  messageIds: string[],
  ceoContext?: CeoHandlerContext,
): Promise<void> {
  const launchId = payload.launchId;

  // Track cost: will incur a Google Lens call
  costTracker.record({
    launchId,
    source: "google_lens",
    estimatedCostUsd: LAUNCH_COST_ESTIMATES.googleLensCall,
    operation: "vision-recognition",
  });

  // Delegate to VisionAnalyst (product-recognition lane)
  delegateStage({
    bus,
    launchId,
    receiverAgentId: "product-recognition",
    payload: {
      launchId,
      imageUrl: payload.imageUrls?.[0] ?? "",
      caption: payload.caption,
      stage: "recognizing",
    },
    dedupePrefix: "coord-recognize",
    findings,
    messageIds,
  });

  await sendProgress(
    payload,
    "photo_received",
    "📸 Foto recibida. Iniciando identificación…",
    ceoContext,
    messageIds,
    bus,
  );
}

async function handleRecognizing(
  payload: CoordinatorPayload,
  bus: Parameters<DaemonHandler>[0]["bus"],
  findings: DaemonFinding[],
  messageIds: string[],
  ceoContext?: CeoHandlerContext,
): Promise<void> {
  const launchId = payload.launchId;

  // The payload coming back should have recognition results
  const brand = payload.brand ?? "Desconocido";
  const model = payload.model ?? "Desconocido";

  // Track cost: will incur 2 DeepSeek calls (research + competition)
  costTracker.record({
    launchId,
    source: "deepseek",
    estimatedCostUsd: LAUNCH_COST_ESTIMATES.deepseekCall * 2,
    operation: "product-research",
  });
  // Also a potential Google Lens call for catalog lookup
  costTracker.record({
    launchId,
    source: "google_lens",
    estimatedCostUsd: LAUNCH_COST_ESTIMATES.googleLensCall,
    operation: "catalog-lookup",
  });

  // Delegate to MarketResearcher AND CatalogSpecialist in parallel (product-research lane)
  delegateStage({
    bus,
    launchId,
    receiverAgentId: "product-research",
    payload: {
      launchId,
      brand,
      model,
      title: `${brand} ${model}`,
      searchTerms: payload.searchTerms ?? [brand, model],
      stage: "researching",
    },
    dedupePrefix: "coord-research",
    findings,
    messageIds,
  });

  await sendProgress(
    payload,
    "recognizing",
    `🔍 Producto identificado: ${brand} ${model}. Buscando specs e imágenes…`,
    ceoContext,
    messageIds,
    bus,
  );
}

async function handleResearching(
  payload: CoordinatorPayload,
  bus: Parameters<DaemonHandler>[0]["bus"],
  findings: DaemonFinding[],
  messageIds: string[],
  ceoContext?: CeoHandlerContext,
): Promise<void> {
  const launchId = payload.launchId;

  // Track cost: MiniMax image generation
  costTracker.record({
    launchId,
    source: "minimax",
    estimatedCostUsd: LAUNCH_COST_ESTIMATES.minimaxImage * 2,
    operation: "creative-generation",
  });

  // Delegate to PhotoDirector (creative-production lane)
  delegateStage({
    bus,
    launchId,
    receiverAgentId: "creative-production",
    payload: {
      launchId,
      imageUrl: payload.imageUrls?.[0] ?? "",
      productContext: {
        brand: payload.brand,
        model: payload.model,
        color: payload.color,
        category: payload.category,
      },
      stage: "generating_creative",
    },
    dedupePrefix: "coord-creative",
    findings,
    messageIds,
  });

  await sendProgress(
    payload,
    "researching",
    `📊 Investigación completada: ${payload.brand ?? ""} ${payload.model ?? ""}. Generando imágenes…`,
    ceoContext,
    messageIds,
    bus,
  );
}

async function handleGeneratingCreative(
  payload: CoordinatorPayload,
  bus: Parameters<DaemonHandler>[0]["bus"],
  findings: DaemonFinding[],
  messageIds: string[],
  ceoContext?: CeoHandlerContext,
): Promise<void> {
  const launchId = payload.launchId;

  // Track cost: one more DeepSeek call for composition
  costTracker.record({
    launchId,
    source: "deepseek",
    estimatedCostUsd: LAUNCH_COST_ESTIMATES.deepseekCall,
    operation: "listing-composition",
  });

  // Delegate to Copywriter + SpecTechnician + QualityInspector (listing-composition lane)
  delegateStage({
    bus,
    launchId,
    receiverAgentId: "listing-composition",
    payload: {
      launchId,
      brand: payload.brand,
      model: payload.model,
      specs: payload.specs,
      category: payload.category,
      suggestedPrice: payload.suggestedPrice,
      sellerId: payload.sellerId,
      stage: "composing",
    },
    dedupePrefix: "coord-compose",
    findings,
    messageIds,
  });

  await sendProgress(
    payload,
    "generating_creative",
    "🎨 Imágenes generadas. Componiendo publicación…",
    ceoContext,
    messageIds,
    bus,
  );
}

async function handleComposing(
  payload: CoordinatorPayload,
  bus: Parameters<DaemonHandler>[0]["bus"],
  findings: DaemonFinding[],
  messageIds: string[],
  ceoContext?: CeoHandlerContext,
): Promise<void> {
  const launchId = payload.launchId;
  const title = payload.listingTitle ?? "Título pendiente";
  const price = payload.suggestedPrice ? `$${payload.suggestedPrice}` : "pendiente";

  // Enqueue CEO proposal for approval
  const proposalPayload = {
    type: "proposal",
    summary: `ProductLaunch "${launchId}" ready for review`,
    launchId,
    title,
    description: payload.listingDescription ?? "",
    suggestedPrice: payload.suggestedPrice,
    priceCurrency: payload.priceCurrency ?? "CLP",
    qualityScore: payload.qualityScore,
    costTotalUsd: costTracker.getTotalCost(launchId),
    images: payload.images ?? payload.imageUrls ?? [],
    stage: "awaiting_approval",
    action: {
      kind: "approve_launch",
      id: launchId,
      label: `Aprobar publicación: ${title}`,
    },
    noMutationExecuted: true,
    capturedAt: new Date().toISOString(),
  };

  const enqueueOpts: Parameters<typeof bus.enqueue>[0] = {
    senderAgentId: "product-launch",
    receiverAgentId: "ceo",
    messageType: "proposal",
    payloadJson: JSON.stringify(proposalPayload),
    dedupeKey: `coord-approval-${launchId}`,
  };
  if (payload.sellerId) enqueueOpts.sellerId = payload.sellerId;
  const message = bus.enqueue(enqueueOpts);
  messageIds.push(message.messageId);

  findings.push({
    kind: "opportunity",
    severity: "info",
    summary: `ProductLaunchCoordinator: launch "${launchId}" ready for CEO approval — "${title}" (${price})`,
    evidenceIds: [message.messageId],
  });

  await sendProgress(
    payload,
    "composing",
    `📦 Publicación lista para revisar:\n📝 Título: ${title}\n💰 Precio: ${price}\n🔗 Usa \`approve_launch("${launchId}")\` para aprobar`,
    ceoContext,
    messageIds,
    bus,
  );
}

async function handleAwaitingApproval(
  payload: CoordinatorPayload,
  _bus: Parameters<DaemonHandler>[0]["bus"],
  findings: DaemonFinding[],
  _messageIds: string[],
  ceoContext?: CeoHandlerContext,
): Promise<void> {
  // Just wait — CEO must approve via the approve_launch tool
  // The approval will be detected on the next daemon cycle when
  // the store shows approved status
  findings.push({
    kind: "info",
    severity: "info",
    summary: `ProductLaunchCoordinator: launch "${payload.launchId}" awaiting CEO approval`,
    evidenceIds: [],
  });

  // Send reminder via Telegram
  if (ceoContext?.sendProactiveMessage && payload.chatId) {
    try {
      await ceoContext.sendProactiveMessage(
        payload.chatId,
        `👀 Tu publicación "${payload.listingTitle ?? "Producto"}" está lista para revisar.\nUsa \`approve_launch("${payload.launchId}")\` para aprobarla.`,
      );
    } catch {
      // Non-blocking — Telegram delivery failure is not a pipeline error
    }
  }
}

async function handleApproved(
  payload: CoordinatorPayload,
  _bus: Parameters<DaemonHandler>[0]["bus"],
  findings: DaemonFinding[],
  messageIds: string[],
  ceoContext?: CeoHandlerContext,
): Promise<void> {
  // Move to ready_to_publish (write gate remains blocked)
  findings.push({
    kind: "opportunity",
    severity: "info",
    summary: `ProductLaunchCoordinator: launch "${payload.launchId}" approved → ready_to_publish (write gate blocked)`,
    evidenceIds: [],
  });

  await sendProgress(
    payload,
    "approved",
    "🚀 Publicación aprobada y lista para publicar. La publicación real está bloqueada (write gate).",
    ceoContext,
    messageIds,
    _bus,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Get the next stage based on the current one.
 * Returns undefined for terminal states.
 */
function getNextStage(current: PipelineStage): PipelineStage | undefined {
  const order: PipelineStage[] = [
    "photo_received",
    "recognizing",
    "researching",
    "generating_creative",
    "composing",
    "awaiting_approval",
    "approved",
    "ready_to_publish",
  ];
  const idx = order.indexOf(current);
  if (idx < 0 || idx >= order.length - 1) return undefined;
  return order[idx + 1];
}

/**
 * Delegate a pipeline stage to a specialist worker via the Agent Message Bus.
 */
function delegateStage(params: {
  bus: Parameters<DaemonHandler>[0]["bus"];
  launchId: string;
  receiverAgentId: string;
  payload: Record<string, unknown>;
  dedupePrefix: string;
  findings: DaemonFinding[];
  messageIds: string[];
}): void {
  const { bus, launchId, receiverAgentId, payload, dedupePrefix, findings, messageIds } = params;

  try {
    const message = bus.enqueue({
      senderAgentId: "product-launch",
      receiverAgentId,
      messageType: "delegate",
      payloadJson: JSON.stringify(payload),
      dedupeKey: `${dedupePrefix}-${launchId}`,
      correlationId: launchId,
    });
    messageIds.push(message.messageId);

    findings.push({
      kind: "info",
      severity: "info",
      summary: `ProductLaunchCoordinator: delegated to "${receiverAgentId}" for launch "${launchId}" (${(payload.stage as string) ?? "unknown"})`,
      evidenceIds: [message.messageId],
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: `ProductLaunchCoordinator: failed to delegate to "${receiverAgentId}" — ${errorMessage}`,
      evidenceIds: [launchId],
    });
  }
}

/**
 * Send a progress update to the CEO via Telegram.
 * Uses the ceoContext's sendProactiveMessage callback when available.
 * Also enqueues a CEO bus message as a fallback.
 */
async function sendProgress(
  payload: CoordinatorPayload,
  stage: PipelineStage,
  text: string,
  ceoContext: CeoHandlerContext | undefined,
  messageIds: string[],
  bus: Parameters<DaemonHandler>[0]["bus"],
): Promise<void> {
  const emoji = STAGE_EMOJI[stage];
  const message = `${emoji} ${text}`;

  // Try to send via Telegram
  if (ceoContext?.sendProactiveMessage && payload.chatId) {
    try {
      await ceoContext.sendProactiveMessage(payload.chatId, message);
    } catch {
      // Telegram failure is non-blocking — fall through to bus
    }
  }

  // Enqueue to CEO bus lane as fallback
  const busEnqueueOpts: Parameters<typeof bus.enqueue>[0] = {
    senderAgentId: "product-launch",
    receiverAgentId: "ceo",
    messageType: "progress",
    payloadJson: JSON.stringify({
      type: "progress",
      launchId: payload.launchId,
      stage,
      text: message,
      noMutationExecuted: true,
      capturedAt: new Date().toISOString(),
    }),
    dedupeKey: `progress-${payload.launchId}-${stage}`,
  };
  if (payload.sellerId) busEnqueueOpts.sellerId = payload.sellerId;
  const busMsg = bus.enqueue(busEnqueueOpts);
  messageIds.push(busMsg.messageId);
}
