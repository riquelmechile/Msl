import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpServerConfig } from "../index.js";

import { jsonResult, unauthorizedResult } from "./utils.js";

export function registerModerationTools(
  server: McpServer,
  deps: {
    validateApiKey: (key?: string) => boolean;
    config: McpServerConfig;
  },
): void {
  const { validateApiKey, config } = deps;
  const mlcClient = config.mlcClient;

  if (!mlcClient) return;

  // ── read_moderation_status ───────────────────────────────────────
  server.registerTool(
    "read_moderation_status",
    {
      description: "Checks moderation status for a specific MercadoLibre item.",
      inputSchema: {
        sellerId: z.string(),
        itemId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, itemId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult(await mlcClient.getModerationStatus!(sellerId, itemId));
    },
  );

  // ── read_notices ─────────────────────────────────────────────────
  server.registerTool(
    "read_notices",
    {
      description: "Reads seller communications and notices from MercadoLibre.",
      inputSchema: {
        sellerId: z.string(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, limit, offset, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      const opts: { limit?: number; offset?: number } = {};
      if (limit !== undefined) opts.limit = limit;
      if (offset !== undefined) opts.offset = offset;
      return jsonResult(await mlcClient.getNotices!(sellerId, opts));
    },
  );

  // ── prepare_answer ───────────────────────────────────────────────
  server.registerTool(
    "prepare_answer",
    {
      description:
        "Prepares an answer to a MercadoLibre question for seller approval without executing the post.",
      inputSchema: {
        sellerId: z.string(),
        questionId: z.string(),
        text: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, questionId, text, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult(await mlcClient.prepareAnswer!(sellerId, { questionId, text }));
    },
  );
}
