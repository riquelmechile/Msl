import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpServerConfig } from "../index.js";

import { jsonResult, unauthorizedResult } from "./utils.js";

export function registerClaimTools(
  server: McpServer,
  deps: {
    validateApiKey: (key?: string) => boolean;
    config: McpServerConfig;
  },
): void {
  const { validateApiKey, config } = deps;
  const mlcClient = config.mlcClient;

  if (!mlcClient) return;

  // ── read_claims ──────────────────────────────────────────────────
  server.registerTool(
    "read_claims",
    {
      description: "Searches post-purchase claims for a MercadoLibre seller.",
      inputSchema: {
        sellerId: z.string(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        status: z.string().optional(),
        sort: z.string().optional(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, limit, offset, status, sort, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      const opts: { limit?: number; offset?: number; status?: string; sort?: string } = {};
      if (limit !== undefined) opts.limit = limit;
      if (offset !== undefined) opts.offset = offset;
      if (status !== undefined) opts.status = status;
      if (sort !== undefined) opts.sort = sort;
      return jsonResult(await mlcClient.searchClaims!(sellerId, opts));
    },
  );

  // ── read_claim_detail ────────────────────────────────────────────
  server.registerTool(
    "read_claim_detail",
    {
      description: "Gets detail for a specific MercadoLibre post-purchase claim.",
      inputSchema: {
        sellerId: z.string(),
        claimId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, claimId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult(await mlcClient.getClaimDetail!(sellerId, claimId));
    },
  );

  // ── read_shipment_status ─────────────────────────────────────────
  server.registerTool(
    "read_shipment_status",
    {
      description: "Gets the shipment status for a MercadoLibre order.",
      inputSchema: {
        sellerId: z.string(),
        shipmentId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, shipmentId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult(await mlcClient.getShipmentStatus!(sellerId, shipmentId));
    },
  );

  // ── read_claim_messages ──────────────────────────────────────────
  server.registerTool(
    "read_claim_messages",
    {
      description: "Reads messages for a specific MercadoLibre post-purchase claim.",
      inputSchema: {
        sellerId: z.string(),
        claimId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, claimId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult(await mlcClient.getClaimMessages!(sellerId, claimId));
    },
  );

  // ── read_claim_expected_resolutions ──────────────────────────────
  server.registerTool(
    "read_claim_expected_resolutions",
    {
      description: "Reads expected resolutions for a specific MercadoLibre post-purchase claim.",
      inputSchema: {
        sellerId: z.string(),
        claimId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, claimId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult(await mlcClient.getClaimExpectedResolutions!(sellerId, claimId));
    },
  );

  // ── read_claim_affects_reputation ────────────────────────────────
  server.registerTool(
    "read_claim_affects_reputation",
    {
      description: "Reads whether a claim affects the seller reputation.",
      inputSchema: {
        sellerId: z.string(),
        claimId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, claimId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult(await mlcClient.getClaimAffectsReputation!(sellerId, claimId));
    },
  );

  // ── read_claim_status_history ────────────────────────────────────
  server.registerTool(
    "read_claim_status_history",
    {
      description: "Reads status history for a specific MercadoLibre post-purchase claim.",
      inputSchema: {
        sellerId: z.string(),
        claimId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, claimId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult(await mlcClient.getClaimStatusHistory!(sellerId, claimId));
    },
  );

  // ── read_claim_return ──────────────────────────────────────────────
  server.registerTool(
    "read_claim_return",
    {
      description: "Reads return details for a specific MercadoLibre post-purchase claim.",
      inputSchema: {
        sellerId: z.string(),
        claimId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, claimId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult(await mlcClient.getClaimReturn!(sellerId, claimId));
    },
  );

  // ── read_return_reviews ────────────────────────────────────────────
  server.registerTool(
    "read_return_reviews",
    {
      description: "Reads reviews for a specific MercadoLibre return.",
      inputSchema: {
        sellerId: z.string(),
        returnId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, returnId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult(await mlcClient.getReturnReviews!(sellerId, returnId));
    },
  );

  // ── read_claim_return_cost ─────────────────────────────────────────
  server.registerTool(
    "read_claim_return_cost",
    {
      description: "Reads return cost charges for a specific MercadoLibre post-purchase claim.",
      inputSchema: {
        sellerId: z.string(),
        claimId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, claimId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult(await mlcClient.getClaimReturnCost!(sellerId, claimId));
    },
  );
}
