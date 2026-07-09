export type CreativeChannel = "mercadolibre" | "storefront" | "instagram" | "facebook" | "tiktok";

export type CreativeJobKind =
  | "product-cover-i2i"
  | "product-gallery-i2i"
  | "product-clip-6s"
  | "product-clip-10s"
  | "ml-clip-vertical-30s"
  | "social-pack"
  | "storefront-hero"
  | "storefront-banner"
  | "voiceover"
  | "music-bed";

export type CreativeJobStatus =
  | "queued"
  | "policy-review"
  | "provider-routing"
  | "running"
  | "needs-human-review"
  | "approved"
  | "rejected"
  | "prepared-for-publish"
  | "published"
  | "failed";

export interface CreativeAssetRequest {
  requestId: string;
  requestedByAgent: string;
  sellerId: string;
  channel: CreativeChannel;
  kind: CreativeJobKind;
  objective: "ctr" | "conversion" | "awareness" | "moderation-fix" | "engagement";
  budgetTier: "low" | "standard" | "premium";
  references: Array<{
    type: "product-image" | "supplier-image" | "brand-guide" | "existing-asset";
    uri: string;
    sha256?: string;
  }>;
  productContext?: {
    itemId?: string;
    sku?: string;
    title?: string;
    categoryId?: string;
  };
  constraints: {
    preserveProductTruth: boolean;
    noBrandInfringement: boolean;
    requiresHumanApproval: boolean;
    channelFormat?: {
      ml?: {
        pictureType: "thumbnail" | "variation_thumbnail" | "other";
        expectedCategoryId: string;
      };
      mlClips?: {
        orientation: "vertical";
        maxDurationSeconds: 60;
        recommendedDurationSeconds: 30;
      };
      social?: {
        platform: "instagram" | "facebook" | "tiktok";
        aspectRatio: "1:1" | "4:5" | "9:16" | "16:9";
        maxDurationSeconds?: number;
      };
    };
  };
}

export interface MlDiagnosticResult {
  passed: boolean;
  picture_type: string;
  detections: Array<{
    name: "white_background" | "minimum_size" | "text_logo" | "watermark";
    wordings: Array<{ kind: string; value: string }>;
  }>;
}

export interface CreativeExecutionResult {
  jobId: string;
  requestId: string;
  status: CreativeJobStatus;
  provider: "minimax" | "flux" | "local";
  model: string;
  estimatedCostUsd: number;
  actualCostUsd?: number;
  outputs: Array<{
    assetId: string;
    kind: "image" | "video" | "audio" | "music";
    storageUri: string;
    previewUrl?: string;
    sha256: string;
    mlDiagnostic?: MlDiagnosticResult;
    policyFlags: string[];
  }>;
  noMutationExecuted: true;
}

export interface CreativeProvider {
  supports(kind: CreativeJobKind): boolean;
  estimate(request: CreativeAssetRequest): number;
  execute(request: CreativeAssetRequest): Promise<CreativeExecutionResult>;
}

export interface CreativeBudgetPolicy {
  maxDailyUsd: number;
  maxJobUsd: number;
  maxVariantsPerRequest: number;
  requireApprovalAboveUsd: number;
  allowedProviders: Array<"minimax" | "flux" | "local">;
  dailySpentUsd: number;
  resetAt: string;
}
