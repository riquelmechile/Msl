import type {
  ApprovalRecord,
  EcommerceAdapter,
  EcommerceAdapterPreviewResult,
  EcommerceAdapterPublishResult,
  GuardrailResult,
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
  | { allowed: false; reason: "approval-required" | "readiness-blocked" | "publishing-disabled" };

export type MedusaWriteBoundaryRejectionReason = Extract<
  MedusaWriteBoundaryDecision,
  { allowed: false }
>["reason"];

export type MedusaWriteBoundary = {
  publish(input: {
    projection: StorefrontProjection;
    approval: ApprovalRecord;
  }): Promise<MedusaWriteBoundaryDecision>;
};

export type MedusaPreviewAdapterOptions = {
  previewRefPrefix?: string;
  writeBoundary?: MedusaWriteBoundary;
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

    async publish(
      input: StorefrontProjection,
      approval: ApprovalRecord,
    ): Promise<EcommerceAdapterPublishResult> {
      if (collectMedusaPreviewBlockingChecks(input).length > 0) {
        throw new MedusaWriteBoundaryError(
          "readiness-blocked",
          "Medusa publish is blocked by projection readiness checks.",
        );
      }

      if (!options.writeBoundary) {
        throw new MedusaWriteBoundaryError(
          "publishing-disabled",
          "Medusa public publishing is disabled for the preview-only adapter.",
        );
      }

      const decision = await options.writeBoundary.publish({ projection: input, approval });
      if (!decision.allowed) {
        throw new MedusaWriteBoundaryError(
          decision.reason,
          `Medusa write boundary rejected publish: ${decision.reason}.`,
        );
      }

      return { publicUrl: decision.publicUrl };
    },
  };
}
