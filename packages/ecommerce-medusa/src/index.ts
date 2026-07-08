import type {
  ApprovalRecord,
  EcommerceAdapter,
  EcommerceAdapterPreviewResult,
  EcommerceAdapterPublishResult,
  GuardrailResult,
  OwnedEcommerceExecutionOperation,
  StorefrontProjection,
} from "@msl/domain";

export type MedusaPreviewProduct = {
  handle: string;
  title: string;
  description: string;
  categoryId?: string;
  variants: Array<{
    sku: string;
    title: string;
    price: number;
    currency: string;
    inventoryQuantity?: number;
    evidenceIds: readonly string[];
  }>;
  evidenceIds: readonly string[];
};

export type MedusaStorefrontPreview = {
  projectionId: string;
  status: "preview" | "approved" | "published";
  collectionHandle: string;
  products: readonly MedusaPreviewProduct[];
  content: StorefrontProjection["content"];
  media: StorefrontProjection["media"];
  readiness: StorefrontProjection["readiness"];
  evidenceIds: readonly string[];
  generatedAt: string;
};

export type MedusaWriteBoundaryDecision =
  | { allowed: true; publicUrl: string }
  | {
      allowed: false;
      reason:
        "approval-required" | "readiness-blocked" | "publishing-disabled" | "credentials-missing";
    };

export type MedusaWriteBoundaryRejectionReason = Extract<
  MedusaWriteBoundaryDecision,
  { allowed: false }
>["reason"];

export type MedusaWriteBoundary = {
  isConfigured(): boolean;
  publish(input: ApprovedMedusaWriteInput): Promise<MedusaWriteBoundaryDecision>;
  activateCheckout(input: ApprovedMedusaWriteInput): Promise<MedusaWriteBoundaryDecision>;
};

export type ApprovedMedusaWriteInput = {
  projection: StorefrontProjection;
  approval: ApprovalRecord;
  auditId: string;
  rollbackRef: string;
  operation: OwnedEcommerceExecutionOperation;
};

export type MedusaRuntimeConfig = {
  enabled: boolean;
  backendUrl?: string;
  adminApiToken?: string;
  liveWriter?: Pick<MedusaWriteBoundary, "publish" | "activateCheckout">;
};

export type MedusaPreviewAdapterOptions = {
  previewRefPrefix?: string;
};

export class MedusaWriteBoundaryError extends Error {
  constructor(
    public readonly code: MedusaWriteBoundaryRejectionReason,
    message: string,
  ) {
    super(message);
    this.name = "MedusaWriteBoundaryError";
  }
}

export function createFailClosedMedusaWriteBoundary(
  reason: MedusaWriteBoundaryRejectionReason = "credentials-missing",
): MedusaWriteBoundary {
  const reject = (): Promise<MedusaWriteBoundaryDecision> =>
    Promise.resolve({ allowed: false, reason });
  return {
    isConfigured: () => false,
    publish: reject,
    activateCheckout: reject,
  };
}

export function createConfiguredMedusaWriteBoundary(
  config: MedusaRuntimeConfig,
): MedusaWriteBoundary {
  if (!config.enabled || !config.backendUrl || !config.adminApiToken) {
    return createFailClosedMedusaWriteBoundary();
  }
  if (!config.liveWriter) {
    return createFailClosedMedusaWriteBoundary("publishing-disabled");
  }

  return {
    isConfigured: () => true,
    publish: (input) => config.liveWriter!.publish(input),
    activateCheckout: (input) => config.liveWriter!.activateCheckout(input),
  };
}

export function createMedusaWriteBoundaryFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MedusaWriteBoundary {
  return createConfiguredMedusaWriteBoundary({
    enabled: env.MEDUSA_RUNTIME_WRITE_ENABLED === "true",
    ...(env.MEDUSA_BACKEND_URL ? { backendUrl: env.MEDUSA_BACKEND_URL } : {}),
    ...(env.MEDUSA_ADMIN_API_TOKEN ? { adminApiToken: env.MEDUSA_ADMIN_API_TOKEN } : {}),
  });
}

export function buildMedusaStorefrontPreview(
  projection: StorefrontProjection,
): MedusaStorefrontPreview {
  return {
    projectionId: projection.id,
    status: projection.status,
    collectionHandle: projection.catalog.collectionHandle,
    products: projection.catalog.products,
    content: projection.content,
    media: projection.media,
    readiness: projection.readiness,
    evidenceIds: projection.evidenceIds,
    generatedAt: projection.generatedAt,
  };
}

export function collectMedusaPreviewBlockingChecks(
  projection: StorefrontProjection,
): GuardrailResult[] {
  return projection.readiness.checks.filter((check) => !check.passed && check.severity === "block");
}

export function createMedusaPreviewAdapter(
  options: MedusaPreviewAdapterOptions = {},
): EcommerceAdapter {
  const previewRefPrefix = options.previewRefPrefix ?? "medusa-preview";

  return {
    buildPreview(input: StorefrontProjection): Promise<EcommerceAdapterPreviewResult> {
      const blockedChecks = collectMedusaPreviewBlockingChecks(input);
      if (blockedChecks.length > 0) {
        return Promise.resolve({ previewRef: `${previewRefPrefix}:${input.id}:blocked` });
      }

      return Promise.resolve({ previewRef: `${previewRefPrefix}:${input.id}` });
    },

    publish(
      input: StorefrontProjection,
      approval: ApprovalRecord,
    ): Promise<EcommerceAdapterPublishResult> {
      if (collectMedusaPreviewBlockingChecks(input).length > 0) {
        return Promise.reject(
          new MedusaWriteBoundaryError(
            "readiness-blocked",
            "Medusa publish is blocked by projection readiness checks.",
          ),
        );
      }

      void approval;
      return Promise.reject(
        new MedusaWriteBoundaryError(
          "publishing-disabled",
          "Medusa public publishing is disabled for the preview-only adapter; use the backend runtime executor for live writes.",
        ),
      );
    },
  };
}
