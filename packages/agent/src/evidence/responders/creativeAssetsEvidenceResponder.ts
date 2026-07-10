import type {
  EvidenceRequestPayload,
  EvidenceResponsePayload,
  EvidenceTargetAgentId,
} from "@msl/domain";
import type { EvidenceResponder } from "../evidenceResponseRouter.js";

// ── Fake transport contract ───────────────────────────────────────────

/** Minimal fake transport slice used by the creative-assets responder. */
export type CreativeAssetsTransport = {
  /** Check if product images are ready for the given candidate/product. */
  areImagesReady(candidateId: string): boolean;
  /** Number of images available for the candidate. */
  getImageCount(candidateId: string): number;
  /** List of required image types that are missing. */
  getMissingImages(candidateId: string): string[];
  /** Optional creative request ID if a job is in progress. */
  getCreativeRequestId(candidateId: string): string | null;
  /** Optional constraints (size, format, moderation). */
  getConstraints(candidateId: string): string | null;
};

// ── Responder ─────────────────────────────────────────────────────────

/**
 * Answers evidence requests of kind `creative-assets` by querying a fake
 * asset store transport. Returns image readiness, counts, and gaps.
 */
export class CreativeAssetsEvidenceResponder implements EvidenceResponder {
  readonly agentId: EvidenceTargetAgentId = "creative-assets";

  private readonly transport: CreativeAssetsTransport;

  constructor(transport: CreativeAssetsTransport) {
    this.transport = transport;
  }

  canHandle(request: EvidenceRequestPayload): boolean {
    return request.kind === "creative-assets";
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async answer(request: EvidenceRequestPayload): Promise<EvidenceResponsePayload> {
    const candidateId = request.candidateId;

    if (!candidateId) {
      return {
        type: "evidence-response",
        responseId: `er-creative-no-candidate-${Date.now()}`,
        requestId: request.requestId,
        correlationId: request.correlationId,
        sourceAgentId: this.agentId,
        targetAgentId: request.sourceAgentId,
        ...(request.sellerId !== undefined ? { sellerId: request.sellerId } : {}),
        status: "answered",
        answer: "No candidate reference — cannot check creative assets.",
        structuredEvidence: { imageReady: false },
        evidenceIds: [],
        confidence: "low",
        blockers: ["No candidate ID provided for creative asset check."],
        warnings: [],
        createdAt: new Date().toISOString(),
        noMutationExecuted: true,
      };
    }

    const imageReady = this.transport.areImagesReady(candidateId);
    const imageCount = this.transport.getImageCount(candidateId);
    const missingImages = this.transport.getMissingImages(candidateId);
    const creativeRequestId = this.transport.getCreativeRequestId(candidateId);
    const constraints = this.transport.getConstraints(candidateId);

    const structuredEvidence: Readonly<Record<string, unknown>> = {
      imageReady,
      imageCount,
      missingImages,
      ...(creativeRequestId !== null ? { creativeRequestId } : {}),
      ...(constraints !== null ? { constraints } : {}),
    };

    const confidence = imageReady ? "high" : missingImages.length === 0 ? "medium" : "low";

    return {
      type: "evidence-response",
      responseId: `er-${request.requestId}-${Date.now()}`,
      requestId: request.requestId,
      correlationId: request.correlationId,
      sourceAgentId: this.agentId,
      targetAgentId: request.sourceAgentId,
      ...(request.sellerId !== undefined ? { sellerId: request.sellerId } : {}),
      ...(request.candidateId !== undefined ? { candidateId: request.candidateId } : {}),
      status: "answered",
      answer: imageReady
        ? `Creative assets ready — ${imageCount} image(s) available.`
        : missingImages.length > 0
          ? `Creative assets incomplete — missing: ${missingImages.join(", ")}.`
          : "Creative assets status unclear — insufficient data.",
      structuredEvidence,
      evidenceIds: [`ev-creative-${request.requestId}`],
      confidence,
      blockers:
        missingImages.length > 0
          ? [`Missing required images: ${missingImages.join(", ")}.`]
          : imageReady
            ? []
            : ["Creative asset readiness unknown."],
      warnings: constraints !== null ? [`Creative constraints apply: ${constraints}.`] : [],
      createdAt: new Date().toISOString(),
      noMutationExecuted: true,
    };
  }
}
