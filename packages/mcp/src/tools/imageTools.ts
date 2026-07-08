import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { normalizeImageOrchestration, type MlcImageOrchestrationSummary } from "@msl/mercadolibre";
import type { McpServerConfig } from "../index.js";
import type { McpToolResult } from "./utils.js";
import { jsonResult, unauthorizedResult } from "./utils.js";

export function registerImageTools(
  server: McpServer,
  deps: {
    validateApiKey: (key?: string) => boolean;
    config: McpServerConfig;
  },
): void {
  const { validateApiKey, config } = deps;
  const mlcClient = config.mlcClient;

  if (!mlcClient) return;

  // ── prepare_image_orchestration ──────────────────────────────────
  server.registerTool(
    "prepare_image_orchestration",
    {
      description:
        "Prepares a 4-step image orchestration flow (diagnose → upload → associate → check) without executing any MercadoLibre mutations.",
      inputSchema: {
        sellerId: z.string(),
        itemId: z.string(),
        pictureUrl: z.string(),
        categoryId: z.string(),
        title: z.string().optional(),
        msl_api_key: z.string().optional(),
      },
    },
    ({ sellerId, itemId, pictureUrl, categoryId, title, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      const orchestrationInput: {
        sellerId: string;
        itemId: string;
        pictureUrl: string;
        categoryId: string;
        now: Date;
        title?: string;
      } = {
        sellerId,
        itemId,
        pictureUrl,
        categoryId,
        now: new Date(),
      };
      if (title !== undefined) {
        orchestrationInput.title = title;
      }
      const summary: MlcImageOrchestrationSummary =
        normalizeImageOrchestration(orchestrationInput).data;
      return jsonResult({
        ...summary,
        metadata: {
          requiresApproval: true,
          noMutationExecuted: true,
        },
      });
    },
  );
}
