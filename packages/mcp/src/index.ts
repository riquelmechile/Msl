import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createMlcReadTools,
  createPreparedActionTool,
  type ApprovalQueueRepository,
  type Clock,
  type MlcReadTools,
  type PrepareWriteInput,
  type PreparedWriteKind,
} from "@msl/tools";
import type { ExactChange, PreparedAction, SellerId } from "@msl/domain";
import type { MlcApiClient } from "@msl/mercadolibre";
import { z } from "zod";

type McpToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function jsonResult(value: unknown, isError = false): McpToolResult {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function unauthorizedResult(): McpToolResult {
  return jsonResult({ error: "Unauthorized — invalid MSL_MCP_API_KEY" }, true);
}

/**
 * Validates the MCP API key against the {@link MSL_MCP_API_KEY}
 * environment variable. Fails closed unless explicit local/demo mode is enabled.
 */
function validateApiKey(apiKey: string | undefined): boolean {
  const expected = process.env.MSL_MCP_API_KEY;
  if (!expected) {
    if (process.env.MSL_ALLOW_UNAUTHENTICATED_LOCAL === "true" || process.env.NODE_ENV === "test") {
      return true;
    }
    return false;
  }
  return apiKey === expected;
}

/**
 * Creates an MCP server that exposes all MSL agent tools via the
 * Model Context Protocol. Compatible with any MCP client (Claude Desktop,
 * Cursor, VS Code, etc.).
 */
export function createMcpServer(config: McpServerConfig = {}) {
  const server = new McpServer(
    { name: "msl-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const readTools = config.mlcClient ? createMlcReadTools({ client: config.mlcClient }) : undefined;

  // ── simulate_actor ────────────────────────────────────────────────
  server.registerTool(
    "simulate_actor",
    {
      description:
        "Simula comportamiento de comprador, proveedor o competidor en MercadoLibre Chile",
      inputSchema: {
        actorType: z.enum(["comprador", "proveedor", "competidor"]),
        query: z.string().optional(),
        msl_api_key: z.string().optional(),
      },
    },
    ({ actorType, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult({
        result: "simulado",
        actor: actorType ?? "desconocido",
      });
    },
  );

  // ── detect_probes ─────────────────────────────────────────────────
  server.registerTool(
    "detect_probes",
    {
      description: "Detecta patrones sospechosos de contrainteligencia en preguntas y vistas",
      inputSchema: {
        questions: z.array(z.unknown()).optional(),
        views: z.array(z.unknown()).optional(),
        msl_api_key: z.string().optional(),
      },
    },
    ({ msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult({ status: "ok", tool: "detect_probes" });
    },
  );

  // ── sync_product ──────────────────────────────────────────────────
  server.registerTool(
    "sync_product",
    {
      description: "Sincroniza producto de Plasticov a Maustian aplicando estrategias",
      inputSchema: {
        sourceSellerId: z.string(),
        targetSellerId: z.string(),
        itemId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    ({ msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult({ status: "ok", tool: "sync_product" });
    },
  );

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
        return jsonResult(await readTools.reputation.execute({ sellerId: sellerId as SellerId }));
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

  // ── list_strategies ───────────────────────────────────────────────
  server.registerTool(
    "list_strategies",
    {
      description: "Lista estrategias activas del CEO",
      inputSchema: {
        msl_api_key: z.string().optional(),
      },
    },
    ({ msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult({ strategies: [], count: 0 });
    },
  );

  // ── consult_cortex ────────────────────────────────────────────────
  server.registerTool(
    "consult_cortex",
    {
      description: "Consulta la memoria neuronal para contexto de negocio",
      inputSchema: {
        query: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    ({ msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult({ status: "ok", tool: "consult_cortex" });
    },
  );

  if (readTools) {
    registerMlcReadTool(server, "read_mercadolibre_listings", readTools.listings);
    registerMlcReadTool(server, "read_mercadolibre_orders", readTools.orders);
    registerMlcReadTool(server, "read_mercadolibre_messages", readTools.messages);
    registerMlcReadTool(server, "read_mercadolibre_reputation", readTools.reputation);
  }

  if (config.prepareWrite) {
    const prepareTool = createPreparedActionTool(config.prepareWrite);
    server.registerTool(
      "prepare_mercadolibre_write",
      {
        description:
          "Prepares a MercadoLibre write for seller approval. This tool does not execute mutations.",
        inputSchema: {
          id: z.string(),
          sellerId: z.string(),
          kind: z.enum([
            "price-change",
            "stock-change",
            "customer-message",
            "cancellation",
            "refund",
            "listing-edit",
            "creative-publication",
          ]),
          target: z.union([
            z.object({ type: z.literal("listing"), listingId: z.string() }),
            z.object({ type: z.literal("order"), orderId: z.string() }),
            z.object({ type: z.literal("message"), threadId: z.string() }),
            z.object({ type: z.literal("creative-asset"), assetId: z.string() }),
          ]),
          exactChange: z.array(
            z.object({
              field: z.string(),
              from: z.union([z.string(), z.number(), z.boolean(), z.null()]),
              to: z.union([z.string(), z.number(), z.boolean(), z.null()]),
            }),
          ),
          rationale: z.string(),
          expiresAt: z.string(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ msl_api_key, id, sellerId, kind, target, exactChange, rationale, expiresAt }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }

        const parsedExpiresAt = parseStrictIsoTimestamp(expiresAt);
        if (!parsedExpiresAt) {
          return jsonResult(
            { error: "Invalid expiresAt — expected a valid ISO 8601 timestamp" },
            true,
          );
        }

        const request: PrepareWriteInput = {
          id,
          sellerId: sellerId as SellerId,
          kind: kind as PreparedWriteKind,
          target: target as PreparedAction["target"],
          exactChange: exactChange as ExactChange[],
          rationale,
          expiresAt: parsedExpiresAt,
        };

        return jsonResult(await prepareTool.execute(request));
      },
    );
  }

  return server;
}

function parseStrictIsoTimestamp(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  return parsed.toISOString() === normalized ? parsed : null;
}

function registerMlcReadTool(
  server: McpServer,
  name: string,
  tool: MlcReadTools[keyof MlcReadTools],
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
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }

      return jsonResult(await tool.execute({ sellerId: sellerId as SellerId }));
    },
  );
}

/** Configuration for MCP server dependencies. Dependencies are injected by callers. */
export type McpServerConfig = {
  mlcClient?: MlcApiClient;
  prepareWrite?: {
    repository: ApprovalQueueRepository;
    clock: Clock;
  };
};

/**
 * Starts the MCP server on the stdio transport for CLI usage.
 *
 * Usage:
 * ```json
 * // mcp.json (Claude Desktop, Cursor, etc.)
 * {
 *   "msl": {
 *     "command": "node",
 *     "args": ["packages/mcp/dist/src/index.js"]
 *   }
 * }
 * ```
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
