import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import { MlDiagnosticAdapter, type MlDiagnosticAdapterConfig } from "@msl/creative-studio";
import type { ImageQualityDecision } from "@msl/domain";

// ── Environment helpers ─────────────────────────────────────────────

function env(name: string, fallback = ""): string {
  return (globalThis as Record<string, unknown>).process
    ? ((globalThis as typeof globalThis & { process: { env: Record<string, string | undefined> } })
        .process.env[name] ?? fallback)
    : fallback;
}

// ── Input / Output types ─────────────────────────────────────────────

export type PhotoDirectorInput = {
  /** Public URL of the product image to evaluate. */
  imageUrl: string;
  /** Optional product context for ML diagnostic enrichment. */
  productContext?: {
    title?: string;
  };
};

export type PhotoDirectorOutput = {
  /** Overall quality score from 0 to 100. */
  qualityScore: number;
  /** Routing decision based on quality thresholds. */
  decision: ImageQualityDecision;
  /** Human-readable reasons for the decision. */
  reasons: string[];
  /** Per-dimension scores (only populated in real ML mode). */
  dimensions?: {
    resolution: number;
    background: number;
    lighting: number;
    focus: number;
  };
};

// ── Quality thresholds ────────────────────────────────────────────────

const USE_AS_REFERENCE_THRESHOLD = 80;
const DISCARD_AND_SEARCH_THRESHOLD = 40;

function decisionFromScore(score: number): ImageQualityDecision {
  if (score >= USE_AS_REFERENCE_THRESHOLD) return "USE_AS_REFERENCE";
  if (score >= DISCARD_AND_SEARCH_THRESHOLD) return "REGENERATE";
  return "DISCARD_AND_SEARCH";
}

// ── Stub mode (no ML_API_TOKEN) ────────────────────────────────────────

function stubAnalyze(input: PhotoDirectorInput): PhotoDirectorOutput {
  console.warn("[photo-director] ML_API_TOKEN not set — using heuristic URL analysis");

  const imageUrl = input.imageUrl.toLowerCase();

  // Heuristic scoring based on URL patterns
  let score: number;
  const reasons: string[] = [];

  if (imageUrl.includes("mlstatic.com")) {
    // MercadoLibre static images are typically high-quality product photos
    score = 78;
    reasons.push("URL is mlstatic.com — likely ML-standard product photo");
  } else if (imageUrl.includes("amazon") || imageUrl.includes("cdn")) {
    score = 65;
    reasons.push("URL from known CDN — moderate quality assumed");
  } else if (imageUrl.includes(".jpg") || imageUrl.includes(".png") || imageUrl.includes(".jpeg")) {
    score = 55;
    reasons.push("URL is a direct image file — moderate quality assumed");
  } else {
    score = 45;
    reasons.push("URL not a recognized image source — low confidence");
  }

  reasons.push("[stub] Real ML analysis skipped — set ML_API_TOKEN for actual diagnostics");

  return {
    qualityScore: score,
    decision: decisionFromScore(score),
    reasons,
  };
}

// ── Real mode (ML diagnostic) ─────────────────────────────────────────

async function mlAnalyze(input: PhotoDirectorInput, mlApiToken: string): Promise<PhotoDirectorOutput> {
  const mlApiBaseUrl = env("ML_API_BASE_URL", "https://api.mercadolibre.com");

  const config: MlDiagnosticAdapterConfig = {
    mlApiBaseUrl,
    authToken: mlApiToken,
  };

  const adapter = new MlDiagnosticAdapter(config);

  // Build diagnostic context — use defaults for missing fields
  const title = input.productContext?.title ?? "";
  const categoryId = "";
  const pictureType = "thumbnail";

  const diagResult = await adapter.diagnoseImage(input.imageUrl, {
    categoryId,
    title,
    pictureType,
  });

  // Map ML diagnostic result to quality score and decision
  const reasons: string[] = [];

  // Start with a base score, deduct for each detection
  let score = 100;
  const dimensionScores = {
    resolution: 25,
    background: 25,
    lighting: 25,
    focus: 25,
  };

  for (const detection of diagResult.detections) {
    const wordingValues = detection.wordings.map((w) => w.value).join(", ");
    switch (detection.name) {
      case "white_background":
        dimensionScores.background -= 15;
        reasons.push(`Background issue: ${wordingValues}`);
        break;
      case "minimum_size":
        dimensionScores.resolution -= 15;
        reasons.push(`Resolution issue: ${wordingValues}`);
        break;
      case "text_logo":
        dimensionScores.lighting -= 10;
        reasons.push(`Text/logo detected: ${wordingValues}`);
        break;
      case "watermark":
        dimensionScores.lighting -= 10;
        reasons.push(`Watermark detected: ${wordingValues}`);
        break;
    }
  }

  // Clamp dimension scores
  for (const key of ["resolution", "background", "lighting", "focus"] as const) {
    dimensionScores[key] = Math.max(0, Math.min(25, dimensionScores[key]));
  }

  // Compute overall score from dimensions
  score =
    dimensionScores.resolution +
    dimensionScores.background +
    dimensionScores.lighting +
    dimensionScores.focus;

  if (diagResult.passed) {
    reasons.push("ML diagnostic passed — image meets ML quality standards");
  }

  if (reasons.length === 0) {
    reasons.push("No quality issues detected");
  }

  return {
    qualityScore: score,
    decision: decisionFromScore(score),
    reasons,
    dimensions: dimensionScores,
  };
}

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Photo Director daemon handler.
 *
 * Processes creative-production messages from the agent bus.
 * Claims messages with `receiverAgentId: "creative-production"`.
 *
 * 1. Parse the claimed message payload as PhotoDirectorInput
 * 2. Analyze image quality (ML diagnostic or heuristic stub)
 * 3. Produce a routing decision: USE_AS_REFERENCE, REGENERATE, or DISCARD_AND_SEARCH
 * 4. Enqueue result to creative-production lane for downstream routing
 */
export const photoDirector: DaemonHandler = async ({
  claim,
  bus,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  // ── 1. Parse input ────────────────────────────────────────────
  let input: PhotoDirectorInput;
  try {
    input = JSON.parse(claim.payloadJson) as PhotoDirectorInput;
  } catch {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Photo Director: invalid payload — could not parse PhotoDirectorInput",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  if (!input.imageUrl) {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Photo Director: missing imageUrl in payload",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 2. Analyze image quality ──────────────────────────────────
  let output: PhotoDirectorOutput;
  const mlApiToken = env("ML_API_TOKEN");

  if (!mlApiToken) {
    // Stub mode — heuristic URL analysis
    output = stubAnalyze(input);
  } else {
    // Real mode — ML diagnostic
    try {
      output = await mlAnalyze(input, mlApiToken);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`[photo-director] ML diagnostic failed: ${errorMessage} — falling back to stub`);
      output = stubAnalyze(input);
      output.reasons.push(`ML diagnostic fallback: ${errorMessage}`);
    }
  }

  // ── 3. Enqueue result ─────────────────────────────────────────
  const resultPayload: Record<string, unknown> = {
    type: "finding",
    summary: `Photo Director: quality score ${output.qualityScore}/100 → ${output.decision}`,
    photoDirectorResult: output,
    imageUrl: input.imageUrl,
    nextActionDetails: {
      USE_AS_REFERENCE: "Image is good enough — skip MiniMax regeneration",
      REGENERATE: "Use image as MiniMax subject_reference for regeneration",
      DISCARD_AND_SEARCH: "Image unusable — use ImageScout for alternative sources",
    },
    noMutationExecuted: true,
    capturedAt: new Date().toISOString(),
  };

  const message = bus.enqueue({
    senderAgentId: "creative-production",
    receiverAgentId: "creative-production",
    messageType: "finding",
    payloadJson: JSON.stringify(resultPayload),
    dedupeKey: `photo-director-${claim.messageId}`,
  });
  messageIds.push(message.messageId);

  findings.push({
    kind: "opportunity",
    severity: "info",
    summary: `Photo Director: score ${output.qualityScore}/100 — ${output.decision} (${output.reasons.join("; ")})`,
    evidenceIds: [claim.messageId, message.messageId],
  });

  return { findings, proposalEnqueued: true, messageIds };
};
