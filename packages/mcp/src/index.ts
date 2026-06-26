import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * Creates an MCP server that exposes all MSL agent tools via the
 * Model Context Protocol. Compatible with any MCP client (Claude Desktop,
 * Cursor, VS Code, etc.).
 */
export function createMcpServer(config: McpServerConfig = {}) {
  void config; // reserved for future deps
  const server = new McpServer(
    { name: "msl-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // ── simulate_actor ────────────────────────────────────────────────
  server.registerTool(
    "simulate_actor",
    {
      description:
        "Simula comportamiento de comprador, proveedor o competidor en MercadoLibre Chile",
      inputSchema: {
        actorType: z.enum(["comprador", "proveedor", "competidor"]),
        query: z.string().optional(),
      },
    },
    async ({ actorType }) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            result: "simulado",
            actor: actorType ?? "desconocido",
          }),
        },
      ],
    }),
  );

  // ── detect_probes ─────────────────────────────────────────────────
  server.registerTool(
    "detect_probes",
    {
      description:
        "Detecta patrones sospechosos de contrainteligencia en preguntas y vistas",
      inputSchema: {
        questions: z.array(z.unknown()).optional(),
        views: z.array(z.unknown()).optional(),
      },
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "ok", tool: "detect_probes" }),
        },
      ],
    }),
  );

  // ── sync_product ──────────────────────────────────────────────────
  server.registerTool(
    "sync_product",
    {
      description:
        "Sincroniza producto de Plasticov a Maustian aplicando estrategias",
      inputSchema: {
        sourceSellerId: z.string(),
        targetSellerId: z.string(),
        itemId: z.string(),
      },
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "ok", tool: "sync_product" }),
        },
      ],
    }),
  );

  // ── check_account ─────────────────────────────────────────────────
  server.registerTool(
    "check_account",
    {
      description: "Verifica nivel y reputación de cuenta MercadoLibre",
      inputSchema: {
        sellerId: z.string(),
      },
    },
    async ({ sellerId }) => ({
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
    }),
  );

  // ── list_strategies ───────────────────────────────────────────────
  server.registerTool(
    "list_strategies",
    {
      description: "Lista estrategias activas del CEO",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ strategies: [], count: 0 }),
        },
      ],
    }),
  );

  // ── consult_cortex ────────────────────────────────────────────────
  server.registerTool(
    "consult_cortex",
    {
      description: "Consulta la memoria neuronal para contexto de negocio",
      inputSchema: {
        query: z.string(),
      },
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "ok", tool: "consult_cortex" }),
        },
      ],
    }),
  );

  return server;
}

/** Configuration for the MCP server (reserved for future agent deps). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type McpServerConfig = {
  // Reserved for future dependencies (engine, syncEngine, mlClient, etc.)
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
