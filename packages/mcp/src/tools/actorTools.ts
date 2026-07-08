import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, unauthorizedResult } from "./utils.js";

export function registerActorTools(
  server: McpServer,
  deps: {
    validateApiKey: (key?: string) => boolean;
  },
): void {
  const { validateApiKey } = deps;

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
    ({ actorType, query, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult({
        result: "simulado",
        actor: actorType ?? "desconocido",
        query: query ?? "(sin consulta)",
        nota: "Simulación de actor preparada. En el agent loop, esto se procesaría con DeepSeek.",
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
    ({ questions, views, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      const questionCount = Array.isArray(questions) ? questions.length : 0;
      const viewCount = Array.isArray(views) ? views.length : 0;
      return jsonResult({
        status: "ok",
        tool: "detect_probes",
        questionsReceived: questionCount,
        viewsReceived: viewCount,
        nota:
          questionCount === 0 && viewCount === 0
            ? "Sin datos para analizar. Proporcioná preguntas o vistas."
            : "Análisis de patrones preparado.",
      });
    },
  );
}
