import type {
  CreativeProvider,
  CreativeAssetRequest,
  CreativeExecutionResult,
  CreativeJobKind,
} from "../../../contracts/creative-requests.js";
import { MinimaxClient, MinimaxRequestError } from "./minimax-client.js";

// ── Supported video kinds ────────────────────────────────────────────

const VIDEO_KINDS: CreativeJobKind[] = [
  "product-clip-6s",
  "product-clip-10s",
  "ml-clip-vertical-30s",
];

// ── Duration mapping ─────────────────────────────────────────────────

const KIND_DURATION: Record<string, number> = {
  "product-clip-6s": 6,
  "product-clip-10s": 10,
  "ml-clip-vertical-30s": 30,
};

// ── ML Clips max duration ────────────────────────────────────────────

const ML_CLIPS_MAX_DURATION_SECONDS = 60;

// ── Polling defaults ─────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_MAX_POLL_ATTEMPTS = 60;

// ── Model selection ──────────────────────────────────────────────────

type VideoModelConfig = {
  model: string;
  costPerSecond: number;
  resolution: string;
}

const VIDEO_MODELS: Record<string, VideoModelConfig> = {
  "MiniMax-Hailuo-2.3-Fast": {
    model: "MiniMax-Hailuo-2.3-Fast",
    costPerSecond: 0.017,
    resolution: "768P",
  },
  "MiniMax-Hailuo-2.3": { model: "MiniMax-Hailuo-2.3", costPerSecond: 0.033, resolution: "1080P" },
};

const FAST_MODEL = "MiniMax-Hailuo-2.3-Fast";
const QUALITY_MODEL = "MiniMax-Hailuo-2.3";

// ── Provider ─────────────────────────────────────────────────────────

export class MinimaxVideoProvider implements CreativeProvider {
  private readonly client: MinimaxClient;
  private readonly defaultModel: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(
    client: MinimaxClient,
    defaultModel?: string,
    pollIntervalMs?: number,
    maxPollAttempts?: number,
  ) {
    this.client = client;
    this.defaultModel = defaultModel ?? FAST_MODEL;
    this.pollIntervalMs = pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPollAttempts = maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  }

  supports(kind: CreativeJobKind): boolean {
    return VIDEO_KINDS.includes(kind);
  }

  estimate(request: CreativeAssetRequest): number {
    const duration = KIND_DURATION[request.kind] ?? 6;
    const modelConfig = this.resolveModel(request.kind);
    return modelConfig.costPerSecond * duration;
  }

  async execute(request: CreativeAssetRequest): Promise<CreativeExecutionResult> {
    const duration = KIND_DURATION[request.kind] ?? 6;
    const modelConfig = this.resolveModel(request.kind);

    // Duration validation: ml-clip-vertical-* max 60s (ML Clips limit)
    const isMlClip = request.kind === "ml-clip-vertical-30s";
    if (isMlClip && duration > ML_CLIPS_MAX_DURATION_SECONDS) {
      return {
        jobId: `cj_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
        requestId: request.requestId,
        status: "rejected",
        provider: "minimax",
        model: modelConfig.model,
        estimatedCostUsd: 0,
        outputs: [],
        noMutationExecuted: true,
      };
    }

    // Build prompt
    const prompt = this.buildPrompt(request);

    // First frame from references
    const firstFrameImage = this.getFirstFrame(request.references);

    const body: Record<string, unknown> = {
      model: modelConfig.model,
      prompt,
      duration,
      resolution: modelConfig.resolution,
    };

    if (firstFrameImage) {
      body.first_frame_image = firstFrameImage;
    }

    let taskId = "";
    let status: string;
    let actualCost: number | undefined;
    let policyFlags: string[] = [];
    // storageUri will hold the final downloaded URL (or task reference)
    let storageUri = "";
    let previewUrl: string | undefined;

    try {
      const result = await this.client.post<{
        base_resp: { status_code: number; status_message: string };
        task_id: string;
      }>("/v1/video_generation", body);

      const baseResp = result.base_resp;
      if (baseResp.status_code === 0 && result.task_id) {
        taskId = result.task_id;
        policyFlags.push(`task_id:${taskId}`);

        // Poll for completion
        const pollResult = await this.pollVideoTask(taskId);
        status = pollResult.status;
        storageUri = pollResult.downloadUrl;
        previewUrl = pollResult.downloadUrl;

        if (pollResult.downloadUrl) {
          actualCost = modelConfig.costPerSecond * duration;
        } else {
          // Failed or timed out — mark as failed, no outputs
          status = "failed";
        }
      } else {
        status = "failed";
        policyFlags = [`minimax_error:${baseResp.status_code}`];
      }
    } catch (err) {
      if (err instanceof MinimaxRequestError) {
        status = this.mapStatus(err.category);
        policyFlags = [`minimax_error:${err.category}`];
      } else {
        status = "failed";
        policyFlags = ["provider_error"];
      }
    }

    const jobId = `cj_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const videoOutput: {
      assetId: string;
      kind: "video";
      storageUri: string;
      sha256: string;
      policyFlags: string[];
      previewUrl?: string;
    } = {
      assetId: `asset_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
      kind: "video",
      storageUri,
      sha256: "",
      policyFlags,
    };
    if (previewUrl) {
      videoOutput.previewUrl = previewUrl;
    }
    const result: CreativeExecutionResult = {
      jobId,
      requestId: request.requestId,
      status: status as CreativeExecutionResult["status"],
      provider: "minimax",
      model: modelConfig.model,
      estimatedCostUsd: modelConfig.costPerSecond * duration,
      outputs: storageUri ? [videoOutput] : [],
      noMutationExecuted: true,
    };
    if (actualCost !== undefined) {
      result.actualCostUsd = actualCost;
    }
    return result;
  }

  /**
   * Poll MiniMax for video task completion.
   * Tries up to MAX_POLL_ATTEMPTS at POLL_INTERVAL_MS intervals.
   * Once successful, downloads the file and returns the file URL.
   */
  private async pollVideoTask(taskId: string): Promise<{ status: string; downloadUrl: string }> {
    for (let attempt = 1; attempt <= this.maxPollAttempts; attempt++) {
      await this.sleep(this.pollIntervalMs);

      try {
        const queryResult = await this.client.post<{
          base_resp: { status_code: number; status_message: string };
          status: string;
          file_id?: string;
        }>("/v1/query/video_generation", { task_id: taskId });

        const baseResp = queryResult.base_resp;
        if (baseResp.status_code !== 0) {
          return { status: "failed", downloadUrl: "" };
        }

        if (queryResult.status === "success" && queryResult.file_id) {
          // Download the completed video
          const downloadUrl = await this.downloadFile(queryResult.file_id);
          return { status: "needs-human-review", downloadUrl };
        }

        if (queryResult.status === "failed") {
          return { status: "failed", downloadUrl: "" };
        }

        // Still processing — continue polling
      } catch (err) {
        console.error(
          `[MinimaxVideoProvider] Poll attempt ${attempt}/${this.maxPollAttempts} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Continue polling on transient errors
      }
    }

    // Polling exhausted
    console.warn(
      `[MinimaxVideoProvider] Polling exhausted for task ${taskId} after ${this.maxPollAttempts} attempts`,
    );
    return { status: "failed", downloadUrl: "" };
  }

  /**
   * Download a completed video file from MiniMax by file_id.
   * Returns the file URL.
   */
  private async downloadFile(fileId: string): Promise<string> {
    // MiniMax file retrieval endpoint returns the file content directly or a download URL
    const result = await this.client.post<{
      base_resp: { status_code: number; status_message: string };
      file?: { download_url: string };
    }>("/v1/files/retrieve", { file_id: fileId });

    if (result.base_resp.status_code === 0 && result.file?.download_url) {
      return result.file.download_url;
    }

    // Fallback: construct URL from file_id
    return `minimax://files/${fileId}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private resolveModel(kind: CreativeJobKind): VideoModelConfig {
    const qualityModel = VIDEO_MODELS[QUALITY_MODEL];
    const fastModel = VIDEO_MODELS[FAST_MODEL];
    if (!fastModel) {
      throw new Error(`Video model ${FAST_MODEL} not found in config`);
    }

    if (kind === "ml-clip-vertical-30s") {
      return qualityModel ?? fastModel;
    }
    // Fast clips (6s) use fast model, 10s clips use quality
    if (kind === "product-clip-10s") {
      return qualityModel ?? fastModel;
    }
    return VIDEO_MODELS[this.defaultModel] ?? fastModel;
  }

  private buildPrompt(request: CreativeAssetRequest): string {
    const title = request.productContext?.title ?? "";
    let prompt = `Product video for ${request.channel}.`;
    if (title) {
      prompt += ` Product: ${title}.`;
    }

    if (request.kind === "ml-clip-vertical-30s") {
      prompt += " Vertical 9:16 format, product showcase, engaging motion.";
    } else {
      prompt += " Short product clip, smooth motion.";
    }

    return prompt.slice(0, 2000);
  }

  private getFirstFrame(references: CreativeAssetRequest["references"]): string | undefined {
    const imageRef = references.find(
      (r) => r.type === "product-image" || r.type === "supplier-image",
    );
    return imageRef?.uri;
  }

  private mapStatus(category: string): string {
    switch (category) {
      case "auth_error":
        return "failed";
      case "rate_limited":
        return "failed";
      case "insufficient_balance":
        return "failed";
      case "content_blocked":
        return "rejected";
      default:
        return "failed";
    }
  }
}
