import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpServerConfig } from "../index.js";
import { jsonResult, unauthorizedResult } from "./utils.js";

export function registerCortexTools(
  server: McpServer,
  deps: {
    validateApiKey: (key?: string) => boolean;
    config: McpServerConfig;
  },
): void {
  const { validateApiKey, config } = deps;

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
      if (config.strategyStore) {
        const strategies = config.strategyStore.listActive();
        return jsonResult({ strategies, count: strategies.length });
      }
      return jsonResult({
        strategies: [],
        count: 0,
        nota: "Strategy store not configured in this MCP runtime.",
      });
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
    ({ query, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult({
        status: "ok",
        tool: "consult_cortex",
        query: query ?? "(sin consulta)",
        nota: "Consulta a Cortex registrada. La memoria neuronal se procesa en el agent loop.",
      });
    },
  );
}
