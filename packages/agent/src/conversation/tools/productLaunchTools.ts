import type { ToolDefinition } from "./types.js";
import type { ProductCatalogStore, ProductLaunchStoreInput } from "@msl/domain";
import type { AgentMessageBusStore } from "../agentMessageBusStore.js";

// ── Options ───────────────────────────────────────────────────────────

export type ProductLaunchToolsOptions = {
  /** ProductCatalogStore for reading/writing launches. When absent, tools run in stub mode. */
  catalogStore?: ProductCatalogStore;
  /** AgentMessageBusStore for enqueuing launch coordinator messages. */
  bus?: AgentMessageBusStore;
  /** Seller scope enforced by the hosting agent runtime. */
  authorizedSellerId?: string;
};

// ── Tool: launch_product ──────────────────────────────────────────────

/**
 * CEO tool: launch a new product from a photo.
 *
 * Accepts an image URL or triggers a photo upload, creates a ProductLaunch
 * in `photo_received` status, and enqueues it to the product-launch lane.
 *
 * PROPOSAL-ONLY — no external mutation executed.
 */
export function createLaunchProductTool(options: ProductLaunchToolsOptions = {}): ToolDefinition {
  const store = options.catalogStore;
  const bus = options.bus;

  return {
    name: "launch_product",
    description:
      "Launch a new product from a photo. " +
      "Creates a ProductLaunch entry and enqueues it to the product-launch coordinator for automatic pipeline processing (recognition → research → creative → listing → approval). " +
      "Returns the launch ID for tracking. Proposal-only — no external mutation executed.",
    parameters: {
      type: "object",
      properties: {
        imageUrl: {
          type: "string",
          description: "URL of the product photo to launch.",
        },
        caption: {
          type: "string",
          description: "Optional caption or product name hint from the seller.",
        },
        sellerId: {
          type: "string",
          description: "The seller ID running this launch.",
        },
        chatId: {
          type: "number",
          description: "Telegram chat ID for progress updates.",
        },
      },
      required: ["imageUrl", "sellerId"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const sellerId = typeof args.sellerId === "string" ? args.sellerId : "";
      const imageUrl = typeof args.imageUrl === "string" ? args.imageUrl : undefined;
      const caption = typeof args.caption === "string" ? args.caption : undefined;
      const chatId = typeof args.chatId === "number" ? args.chatId : undefined;
      if (options.authorizedSellerId && sellerId !== options.authorizedSellerId) {
        return {
          status: "forbidden",
          error: "Product launch seller authorization failed.",
          noMutationExecuted: true,
        };
      }

      // ── Stub mode ──
      if (!store) {
        console.warn(
          "[productLaunchTools] ProductCatalogStore not provided — using stub for launch_product",
        );
        return {
          launchId: `stub-launch-${Date.now()}`,
          status: "photo_received",
          sellerId: sellerId || "unknown",
          message:
            "This is a stub launch. ProductCatalogStore is not available. " +
            "Launch will be processed when the store is wired.",
          noMutationExecuted: true,
        };
      }

      try {
        const productId = `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const launchId = `launch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Create the product entry
        store.upsertProduct({
          productId,
          firstSeenAt: new Date().toISOString(),
        });

        // Create the launch entry
        const launchInput: ProductLaunchStoreInput = {
          launchId,
          productId,
          sellerId,
          status: "photo_received",
          createdAt: new Date().toISOString(),
        };
        if (chatId != null) launchInput.chatId = String(chatId);
        const launch = store.createLaunch(launchInput);

        // Enqueue to the product-launch coordinator lane
        if (bus) {
          const payload: Record<string, unknown> = {
            launchId: launch.launchId,
            productId,
            sellerId,
            imageUrls: imageUrl ? [imageUrl] : [],
            caption: caption ?? null,
            chatId: chatId ?? null,
          };
          bus.enqueue({
            senderAgentId: "ceo",
            receiverAgentId: "product-launch",
            messageType: "launch_request",
            payloadJson: JSON.stringify(payload),
            dedupeKey: `launch-product-${launchId}`,
            sellerId,
          });
        }

        return {
          launchId: launch.launchId,
          productId,
          sellerId,
          status: launch.status,
          imageUrl: imageUrl ?? null,
          caption: caption ?? null,
          message: `Product launch "${launch.launchId}" created in photo_received status. Pipeline will begin processing automatically.`,
          nextStage: "recognizing",
          noMutationExecuted: true,
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          launchId: null,
          status: "failed",
          error: `Failed to create product launch: ${errorMessage}`,
          noMutationExecuted: true,
        };
      }
    },
  };
}

// ── Tool: query_launch_status ─────────────────────────────────────────

/**
 * CEO tool: check the status and progress of a product launch.
 *
 * Reads from the ProductCatalogStore and returns the current state,
 * accumulated context, and pipeline progress.
 *
 * PROPOSAL-ONLY — no external mutation executed.
 */
export function createQueryLaunchStatusTool(
  options: ProductLaunchToolsOptions = {},
): ToolDefinition {
  const store = options.catalogStore;

  return {
    name: "query_launch_status",
    description:
      "Query the current status and progress of a product launch by launch ID. " +
      "Returns the pipeline stage, accumulated product context, images, and costs. " +
      "Proposal-only — no external mutation executed.",
    parameters: {
      type: "object",
      properties: {
        launchId: {
          type: "string",
          description: "The launch ID to query (returned by launch_product).",
        },
      },
      required: ["launchId"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const launchId = typeof args.launchId === "string" ? args.launchId : "";

      if (!store) {
        console.warn(
          "[productLaunchTools] ProductCatalogStore not provided — using stub for query_launch_status",
        );
        return {
          launchId: launchId || "unknown",
          status: "photo_received",
          pipeline: {
            recognition: "pending",
            research: "pending",
            creative: "pending",
            composition: "pending",
            approval: "pending",
          },
          message: "This is a stub status. ProductCatalogStore is not available.",
          noMutationExecuted: true,
        };
      }

      try {
        const launch = store.getLaunch(launchId);
        if (!launch) {
          return {
            launchId,
            status: "not_found",
            message: `Launch "${launchId}" not found in product catalog.`,
            noMutationExecuted: true,
          };
        }
        if (options.authorizedSellerId && launch.sellerId !== options.authorizedSellerId) {
          return {
            launchId,
            status: "forbidden",
            message: "Launch does not belong to the authorized seller.",
            noMutationExecuted: true,
          };
        }

        // Build pipeline progress based on status
        const pipelineStages = [
          "photo_received",
          "recognizing",
          "researching",
          "generating_creative",
          "composing",
          "awaiting_approval",
          "approved",
          "ready_to_publish",
          "rejected",
        ] as const;

        const statusIndex = pipelineStages.indexOf(launch.status);
        const pipeline: Record<string, string> = {};
        for (let i = 0; i < pipelineStages.length; i++) {
          const stage = pipelineStages[i]!;
          if (i < statusIndex) {
            pipeline[stage] = "completed";
          } else if (i === statusIndex) {
            pipeline[stage] = "in_progress";
          } else {
            pipeline[stage] = "pending";
          }
        }

        return {
          launchId: launch.launchId,
          productId: launch.productId,
          sellerId: launch.sellerId,
          status: launch.status,
          pipeline,
          title: launch.title ?? null,
          description: launch.description ?? null,
          priceAmount: launch.priceAmount ?? null,
          priceCurrency: launch.priceCurrency ?? null,
          qualityScorePredicted: launch.qualityScorePredicted ?? null,
          costTotalUsd: launch.costTotalUsd ?? null,
          createdAt: launch.createdAt,
          completedAt: launch.completedAt ?? null,
          noMutationExecuted: true,
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          launchId,
          status: "error",
          error: `Failed to query launch status: ${errorMessage}`,
          noMutationExecuted: true,
        };
      }
    },
  };
}

// ── Tool: approve_launch ──────────────────────────────────────────────

/**
 * CEO tool: approve a listing that is awaiting approval.
 *
 * Transitions the launch from `awaiting_approval` to `approved`.
 * The coordinator will then move it to `ready_to_publish`.
 *
 * PROPOSAL-ONLY — no external mutation executed. Write gate remains blocked.
 */
export function createApproveLaunchTool(options: ProductLaunchToolsOptions = {}): ToolDefinition {
  const store = options.catalogStore;
  const bus = options.bus;

  return {
    name: "approve_launch",
    description:
      "Approve a product listing that is awaiting CEO review. " +
      "Transitions the launch from awaiting_approval to approved. " +
      "The coordinator will process the approval and prepare the listing. " +
      "Proposal-only — no external mutation executed. Write gate remains blocked.",
    parameters: {
      type: "object",
      properties: {
        launchId: {
          type: "string",
          description: "The launch ID to approve.",
        },
        notes: {
          type: "string",
          description: "Optional approval notes or instructions for the listing.",
        },
      },
      required: ["launchId"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const launchId = typeof args.launchId === "string" ? args.launchId : "";
      const notes = typeof args.notes === "string" ? args.notes : undefined;

      if (!store) {
        console.warn(
          "[productLaunchTools] ProductCatalogStore not provided — using stub for approve_launch",
        );
        return {
          launchId: launchId || "unknown",
          approved: false,
          message:
            "This is a stub approval. ProductCatalogStore is not available. " +
            "Approval will be processed when the store is wired.",
          noMutationExecuted: true,
        };
      }

      try {
        const launch = store.getLaunch(launchId);
        if (!launch) {
          return {
            launchId,
            approved: false,
            message: `Launch "${launchId}" not found.`,
            noMutationExecuted: true,
          };
        }
        if (options.authorizedSellerId && launch.sellerId !== options.authorizedSellerId) {
          return {
            launchId,
            approved: false,
            message: "Launch does not belong to the authorized seller.",
            noMutationExecuted: true,
          };
        }

        if (launch.status !== "awaiting_approval") {
          return {
            launchId,
            approved: false,
            currentStatus: launch.status,
            message: `Launch "${launchId}" is in "${launch.status}" status, not "awaiting_approval". Only launches awaiting approval can be approved.`,
            noMutationExecuted: true,
          };
        }

        const approvedLaunch = store.transitionLaunchStatus(
          launchId,
          launch.sellerId,
          "awaiting_approval",
          "approved",
        );
        if (!approvedLaunch) {
          return {
            launchId,
            approved: false,
            message: `Launch "${launchId}" changed before approval could be recorded.`,
            noMutationExecuted: true,
          };
        }

        // Enqueue to coordinator so it continues to ready_to_publish
        if (bus) {
          bus.enqueue({
            senderAgentId: "ceo",
            receiverAgentId: "product-launch",
            messageType: "launch_approved",
            payloadJson: JSON.stringify({
              launchId,
              sellerId: launch.sellerId,
              chatId: launch.chatId,
              notes: notes ?? null,
              approvedAt: new Date().toISOString(),
            }),
            dedupeKey: `approve-launch-${launchId}`,
            sellerId: launch.sellerId,
          });
        }

        return {
          launchId,
          approved: true,
          previousStatus: "awaiting_approval",
          newStatus: "approved",
          notes: notes ?? null,
          message:
            `Launch "${launchId}" has been approved. ` +
            "The coordinator will process it to ready_to_publish. " +
            "No external mutation executed — write gate remains blocked.",
          nextStage: "ready_to_publish",
          noMutationExecuted: true,
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          launchId,
          approved: false,
          error: `Failed to approve launch: ${errorMessage}`,
          noMutationExecuted: true,
        };
      }
    },
  };
}

// ── Factory ───────────────────────────────────────────────────────────

/**
 * Create all product launch CEO tools at once.
 * Returns an array of ToolDefinition compatible with the CEO tool registry.
 */
export function createProductLaunchTools(
  options: ProductLaunchToolsOptions = {},
): ToolDefinition[] {
  return [
    createLaunchProductTool(options),
    createQueryLaunchStatusTool(options),
    createApproveLaunchTool(options),
  ];
}
