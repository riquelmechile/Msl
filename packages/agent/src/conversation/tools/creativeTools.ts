import type { ToolDefinition } from "./types.js";

// ── Tool: query_creative_task ──────────────────────────────────────────

/**
 * Query the status of a creative task by jobId or requestId.
 * Returns proposal-only state (no external systems queried).
 */
export function createQueryCreativeTaskTool(): ToolDefinition {
  return {
    name: "query_creative_task",
    description:
      "Queries the status of a creative job by jobId or requestId. Returns current state from the message bus. No external systems are accessed. Proposal-only — no mutation executed.",
    parameters: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "The creative job ID to query (cj_ prefix).",
        },
        requestId: {
          type: "string",
          description: "The request ID to query as alternative.",
        },
      },
      oneOf: [{ required: ["jobId"] }, { required: ["requestId"] }],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      return {
        jobId: args.jobId ?? null,
        requestId: args.requestId ?? null,
        status: "needs-human-review",
        message:
          "This is a stub tool. Full integration with the creative job queue will be added in a future phase.",
        noMutationExecuted: true,
      };
    },
  };
}

// ── Tool: approve_creative_asset ───────────────────────────────────────

export type ApproveCreativeAssetToolOptions = {
  /** Whether the caller is authorized to approve creative assets. */
  authorized?: boolean;
};

/**
 * Approve a creative asset for preparation toward publication.
 *
 * This is a prepare-only stub — it records the intent to approve
 * but does NOT execute any MercadoLibre upload or associate calls.
 * The actual publication is handled by the existing ML orchestration flow
 * (diagnose → upload → associate) via `msl_prepare_mercadolibre_write`.
 */
export function createApproveCreativeAssetTool(
  options: ApproveCreativeAssetToolOptions = {},
): ToolDefinition {
  const isAuthorized = options.authorized ?? false;

  return {
    name: "approve_creative_asset",
    description:
      "Approves a creative asset for preparation toward publication. Records the approval intent but does NOT execute upload, associate, or any external mutation. The actual publication flow (diagnose → upload → associate) is handled separately via prepare-only MercadoLibre write tools.",
    parameters: {
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "The creative job ID to approve (cj_ prefix).",
        },
        assetId: {
          type: "string",
          description: "The specific asset ID within the job to approve.",
        },
        notes: {
          type: "string",
          description: "Optional approval notes or instructions.",
        },
      },
      required: ["jobId", "assetId"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      if (!isAuthorized) {
        return {
          approved: false,
          jobId: args.jobId,
          assetId: args.assetId,
          message: "Not authorized to approve creative assets. Only the CEO agent can approve.",
          noMutationExecuted: true,
        };
      }

      return {
        approved: true,
        jobId: args.jobId,
        assetId: args.assetId,
        notes: args.notes ?? null,
        message:
          `Asset ${args.assetId} for job ${args.jobId} has been approved for preparation. ` + // eslint-disable-line @typescript-eslint/restrict-template-expressions
          "No external mutation executed. Use the prepare-only ML orchestration flow to upload and associate.",
        nextAction: "ml-orchestration-prepare",
        noMutationExecuted: true,
      };
    },
  };
}
