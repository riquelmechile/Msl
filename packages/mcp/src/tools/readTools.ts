import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createMlcReadTools,
  type MlcReadTools,
  type MlcCategoryReadTools,
} from "@msl/tools";
import { MLC_PRODUCT_ADS_MAX_LIMIT } from "@msl/mercadolibre";
import type { MlcApiClient } from "@msl/mercadolibre";
import type { McpServerConfig } from "../index.js";
import type { McpToolResult } from "./utils.js";
import { jsonResult, unauthorizedResult } from "./utils.js";

// ── Read Product Ads insights input schema (shared with productAdsTools) ──

const mcpReadProductAdsInsightsInputSchema = {
  sellerId: z.string(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().int().positive().max(MLC_PRODUCT_ADS_MAX_LIMIT).optional(),
  offset: z.number().int().nonnegative().optional(),
  itemId: z.string().optional(),
  campaignId: z.string().optional(),
  status: z
    .enum(["active", "paused", "hold", "idle", "delegated", "revoked", "recommended"])
    .optional(),
  msl_api_key: z.string().optional(),
};

// ── MLC read tool helper functions ───────────────────────────────────

function registerMlcReadTool(
  server: McpServer,
  name: string,
  tool: MlcReadTools["listings" | "orders" | "messages" | "reputation"],
  deps: {
    validateApiKey: (key?: string) => boolean;
    unauthorizedResult: () => McpToolResult;
  },
): void {
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: {
        sellerId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, msl_api_key }) => {
      if (!deps.validateApiKey(msl_api_key)) {
        return deps.unauthorizedResult();
      }

      return jsonResult(await tool.execute({ sellerId }));
    },
  );
}

function registerMlcProductAdsInsightsReadTool(
  server: McpServer,
  name: string,
  tool: MlcReadTools["productAdsInsights"],
  deps: {
    validateApiKey: (key?: string) => boolean;
    unauthorizedResult: () => McpToolResult;
  },
): void {
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: mcpReadProductAdsInsightsInputSchema,
    },
    async ({ msl_api_key, ...request }) => {
      if (!deps.validateApiKey(msl_api_key)) {
        return deps.unauthorizedResult();
      }

      return jsonResult(await tool.execute(request as Parameters<typeof tool.execute>[0]));
    },
  );
}

function registerMlcCategoryAttributesReadTool(
  server: McpServer,
  name: string,
  tool: MlcCategoryReadTools["categoryAttributes"],
  deps: {
    validateApiKey: (key?: string) => boolean;
    unauthorizedResult: () => McpToolResult;
  },
): void {
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: {
        sellerId: z.string(),
        categoryId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, categoryId, msl_api_key }) => {
      if (!deps.validateApiKey(msl_api_key)) {
        return deps.unauthorizedResult();
      }

      return jsonResult(await tool.execute({ sellerId, categoryId }));
    },
  );
}

function registerMlcCategoryTechnicalSpecsReadTool(
  server: McpServer,
  name: string,
  tool: MlcCategoryReadTools["categoryTechnicalSpecs"],
  deps: {
    validateApiKey: (key?: string) => boolean;
    unauthorizedResult: () => McpToolResult;
  },
): void {
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: {
        sellerId: z.string(),
        domainId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, domainId, msl_api_key }) => {
      if (!deps.validateApiKey(msl_api_key)) {
        return deps.unauthorizedResult();
      }

      return jsonResult(await tool.execute({ sellerId, domainId }));
    },
  );
}

function registerMlcListingPricesReadTool(
  server: McpServer,
  name: string,
  tool: MlcReadTools["listingPrices"],
  deps: {
    validateApiKey: (key?: string) => boolean;
    unauthorizedResult: () => McpToolResult;
  },
): void {
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: {
        sellerId: z.string(),
        siteId: z.string(),
        price: z.number(),
        categoryId: z.string(),
        currencyId: z.string().optional(),
        listingTypeId: z.string().optional(),
        logisticType: z.string().optional(),
        shippingMode: z.string().optional(),
        billableWeight: z.number().optional(),
        quantity: z.number().optional(),
        tags: z.union([z.string(), z.array(z.string())]).optional(),
        logisticsAware: z.boolean().optional(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ msl_api_key, ...request }) => {
      if (!deps.validateApiKey(msl_api_key)) {
        return deps.unauthorizedResult();
      }

      return jsonResult(await tool.execute(request as Parameters<typeof tool.execute>[0]));
    },
  );
}

// ── Main registration function ───────────────────────────────────────

export function registerReadTools(
  server: McpServer,
  deps: {
    validateApiKey: (key?: string) => boolean;
    config: McpServerConfig;
  },
): void {
  const { validateApiKey, config } = deps;

  const readTools = config.mlcClient
    ? createMlcReadTools({ client: config.mlcClient })
    : undefined;

  // ── check_account ─────────────────────────────────────────────────
  server.registerTool(
    "check_account",
    {
      description: "Verifica nivel y reputación de cuenta MercadoLibre",
      inputSchema: {
        sellerId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      if (readTools) {
        return jsonResult(await readTools.reputation.execute({ sellerId }));
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              sellerId,
              level: "platinum",
              status: "active",
            }),
          },
        ],
      };
    },
  );

  // ── MLC read tools (conditional on readTools) ─────────────────────
  const authDep = { validateApiKey, unauthorizedResult };

  if (readTools) {
    registerMlcReadTool(server, "read_mercadolibre_listings", readTools.listings, authDep);
    registerMlcReadTool(server, "read_mercadolibre_orders", readTools.orders, authDep);
    registerMlcReadTool(server, "read_mercadolibre_messages", readTools.messages, authDep);
    registerMlcReadTool(server, "read_mercadolibre_reputation", readTools.reputation, authDep);
    registerMlcProductAdsInsightsReadTool(
      server,
      "read_product_ads_insights",
      readTools.productAdsInsights,
      authDep,
    );
    registerMlcCategoryAttributesReadTool(
      server,
      "read_mercadolibre_category_attributes",
      readTools.categoryAttributes,
      authDep,
    );
    registerMlcCategoryTechnicalSpecsReadTool(
      server,
      "read_mercadolibre_category_technical_specs",
      readTools.categoryTechnicalSpecs,
      authDep,
    );
    registerMlcListingPricesReadTool(
      server,
      "read_mercadolibre_listing_prices",
      readTools.listingPrices,
      authDep,
    );
  }
}
