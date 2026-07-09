import type {
  CreativeProvider,
  CreativeAssetRequest,
  CreativeExecutionResult,
  CreativeJobKind,
} from "../../../contracts/creative-requests.js";
import { MinimaxClient, MinimaxRequestError } from "./minimax-client.js";

// ── Supported image kinds ────────────────────────────────────────────

const IMAGE_KINDS: CreativeJobKind[] = [
  "product-cover-i2i",
  "product-gallery-i2i",
  "storefront-hero",
  "storefront-banner",
];

// ── Model configuration ──────────────────────────────────────────────

type ImageModelConfig = {
  model: string;
  costPerCall: number;
};

const IMAGE_MODELS: Record<string, ImageModelConfig> = {
  "image-01": { model: "image-01", costPerCall: 0.015 },
};

const DEFAULT_IMAGE_MODEL = "image-01";

// ── Aspect ratio mapping ─────────────────────────────────────────────

const CHANNEL_ASPECT_RATIOS: Record<string, string> = {
  mercadolibre: "1:1",
  storefront: "16:9",
  instagram: "1:1",
  facebook: "1:1",
  tiktok: "9:16",
};

// ── Provider ─────────────────────────────────────────────────────────

export class MinimaxImageProvider implements CreativeProvider {
  private readonly client: MinimaxClient;
  private readonly modelConfig: ImageModelConfig;

  constructor(client: MinimaxClient, modelName?: string) {
    this.client = client;
    const resolved =
      IMAGE_MODELS[modelName ?? DEFAULT_IMAGE_MODEL] ?? IMAGE_MODELS[DEFAULT_IMAGE_MODEL];
    if (!resolved) throw new Error(`Unknown image model: ${modelName ?? DEFAULT_IMAGE_MODEL}`);
    this.modelConfig = resolved;
  }

  supports(kind: CreativeJobKind): boolean {
    return IMAGE_KINDS.includes(kind);
  }

  estimate(_request: CreativeAssetRequest): number {
     
    return this.modelConfig.costPerCall;
  }

  async execute(request: CreativeAssetRequest): Promise<CreativeExecutionResult> {
    // Build prompt from product context
    const prompt = this.buildPrompt(request);

    // Build subject_reference from references (first image URL)
    const subjectReference = this.buildSubjectReference(request.references);

    // Derive aspect ratio
    const aspectRatio = CHANNEL_ASPECT_RATIOS[request.channel] ?? "1:1";

    // ML format: explicitly request 1200×1200 for MercadoLibre (in addition to aspect_ratio)
    const isMl = request.channel === "mercadolibre";

    const body: Record<string, unknown> = {
      model: this.modelConfig.model,
      prompt,
      aspect_ratio: aspectRatio,
      n: 1,
      response_format: "url",
    };

    if (isMl) {
      body.width = 1200;
      body.height = 1200;
    }

    if (subjectReference) {
      body.subject_reference = subjectReference;
    }

    let imageUrl = "";
    let status: string;
    let actualCost: number | undefined;
    let policyFlags: string[] = [];

    try {
      const result = await this.client.post<{
        base_resp: { status_code: number; status_message: string };
        data: Array<{ image_url: string }>;
      }>("/v1/image_generation", body);

      const baseResp = result.base_resp;
      if (baseResp.status_code === 0) {
        status = "needs-human-review";
        imageUrl = result.data?.[0]?.image_url ?? "";
        actualCost = this.modelConfig.costPerCall;
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
    const result: CreativeExecutionResult = {
      jobId,
      requestId: request.requestId,
      status: status as CreativeExecutionResult["status"],
      provider: "minimax",
      model: this.modelConfig.model,
      estimatedCostUsd: this.modelConfig.costPerCall,
      outputs: imageUrl
        ? [
            {
              assetId: `asset_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
              kind: "image",
              storageUri: imageUrl,
              previewUrl: imageUrl,
              sha256: "",
              policyFlags,
            },
          ]
        : [],
      noMutationExecuted: true,
    };
    if (actualCost !== undefined) {
      result.actualCostUsd = actualCost;
    }
    return result;
  }

  private buildPrompt(request: CreativeAssetRequest): string {
    const title = request.productContext?.title ?? "";
    const kind = request.kind;
    const channel = request.channel;

    let prompt = `Generate a product image for ${channel}.`;
    if (title) {
      prompt += ` Product: ${title}.`;
    }
    if (kind === "storefront-hero" || kind === "storefront-banner") {
      prompt += " Professional storefront presentation, clean background.";
    } else {
      prompt += " White background, well-lit, product-centric view.";
    }

    // Truncate to 1500 chars (MiniMax limit)
    return prompt.slice(0, 1500);
  }

  private buildSubjectReference(
    references: CreativeAssetRequest["references"],
  ): Array<{ type: string; image_file: string }> | undefined {
    const imageRef = references.find(
      (r) => r.type === "product-image" || r.type === "supplier-image",
    );
    if (imageRef?.uri) {
      return [{ type: "character", image_file: imageRef.uri }];
    }
    return undefined;
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
