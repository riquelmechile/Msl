import type { ToolDefinition } from "./types.js";
import type { CreativeJobQueueStore } from "../creativeJobQueueStore.js";

// ── Tool: query_creative_task ──────────────────────────────────────────

/**
 * Options for creating the query_creative_task tool.
 * When `jobQueueStore` is provided, the tool reads from the persistent
 * CreativeJobQueueStore. Otherwise, falls back to stub behavior.
 */
export type QueryCreativeTaskToolOptions = {
  /** Optional CreativeJobQueueStore for persistent job lookups. */
  jobQueueStore?: CreativeJobQueueStore;
};

/**
 * Query the status of a creative task by jobId or requestId.
 * Returns proposal-only state (no external systems queried).
 *
 * When a `jobQueueStore` is provided, reads from the persistent queue.
 * Otherwise falls back to stub behavior with a warning.
 */
export function createQueryCreativeTaskTool(
  options: QueryCreativeTaskToolOptions = {},
): ToolDefinition {
  const store = options.jobQueueStore;

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
      const jobId = typeof args.jobId === "string" ? args.jobId : undefined;
      const requestId = typeof args.requestId === "string" ? args.requestId : undefined;

      if (store) {
        if (jobId) {
          const job = store.getJob(jobId);
          if (job) {
            return {
              jobId: job.job_id,
              requestId: job.request_id,
              status: job.status,
              kind: job.kind,
              channel: job.channel,
              provider: job.provider,
              estimatedCostUsd: job.estimated_cost_usd,
              actualCostUsd: job.actual_cost_usd,
              createdAt: job.created_at,
              updatedAt: job.updated_at,
              noMutationExecuted: true,
            };
          }
        }
        // If requestId provided, fall through to stub since queue store
        // doesn't support direct requestId lookup (caller should use jobId)
        console.warn(
          `[creativeTools] query_creative_task: no job found for ${jobId ? `jobId=${jobId}` : `requestId=${requestId}`}`,
        );
      } else {
        console.warn(
          "[creativeTools] CreativeJobQueueStore not provided — using stub for query_creative_task",
        );
      }

      return {
        jobId: jobId ?? null,
        requestId: requestId ?? null,
        status: "needs-human-review",
        message: store
          ? "Job not found in queue."
          : "This is a stub tool. Full integration with the creative job queue will be added in a future phase.",
        noMutationExecuted: true,
      };
    },
  };
}

// ── Tool: approve_creative_asset ───────────────────────────────────────

export type ApproveCreativeAssetToolOptions = {
  /** Whether the caller is authorized to approve creative assets. */
  authorized?: boolean;
  /** Optional CreativeJobQueueStore for persistent job status updates. */
  jobQueueStore?: CreativeJobQueueStore;
};

/**
 * Approve a creative asset for preparation toward publication.
 *
 * This is a prepare-only tool — it records the intent to approve
 * but does NOT execute any MercadoLibre upload or associate calls.
 * The actual publication is handled by the existing ML orchestration flow
 * (diagnose → upload → associate) via `msl_prepare_mercadolibre_write`.
 *
 * When a `jobQueueStore` is provided, updates the job status to "approved"
 * and creates a prepared action entry. Otherwise falls back to stub behavior.
 */
export function createApproveCreativeAssetTool(
  options: ApproveCreativeAssetToolOptions = {},
): ToolDefinition {
  const isAuthorized = options.authorized ?? false;
  const store = options.jobQueueStore;

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

      const jobId = typeof args.jobId === "string" ? args.jobId : undefined;
      const assetId = typeof args.assetId === "string" ? args.assetId : undefined;
      const notes = typeof args.notes === "string" ? args.notes : undefined;

      if (store && jobId) {
        try {
          const job = store.getJob(jobId);
          if (!job) {
            return {
              approved: false,
              jobId,
              assetId,
              message: `Job "${jobId}" not found in creative job queue.`,
              noMutationExecuted: true,
            };
          }

          // Transition to "approved" status
          store.updateStatus(jobId, "approved");

          return {
            approved: true,
            jobId,
            assetId,
            notes: notes ?? null,
            message:
              `Asset ${assetId} for job ${jobId} has been approved and job status updated to "approved". ` +
              "No external mutation executed. Use the prepare-only ML orchestration flow to upload and associate.",
            nextAction: "ml-orchestration-prepare",
            noMutationExecuted: true,
          };
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          return {
            approved: false,
            jobId,
            assetId,
            message: `Failed to approve job "${jobId}": ${errorMessage}`,
            noMutationExecuted: true,
          };
        }
      }

      if (!store) {
        console.warn(
          "[creativeTools] CreativeJobQueueStore not provided — using stub for approve_creative_asset",
        );
      }

      return {
        approved: true,
        jobId: args.jobId,
        assetId: args.assetId,
        notes: notes ?? null,
        message:
          `Asset ${args.assetId} for job ${args.jobId} has been approved for preparation. ` + // eslint-disable-line @typescript-eslint/restrict-template-expressions
          "No external mutation executed. Use the prepare-only ML orchestration flow to upload and associate.",
        nextAction: "ml-orchestration-prepare",
        noMutationExecuted: true,
      };
    },
  };
}
