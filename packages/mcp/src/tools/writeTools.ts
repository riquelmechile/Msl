import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createPreparedActionTool, PREPARED_WRITE_KINDS, type PrepareWriteInput } from "@msl/tools";
import { ACTION_TARGET_FIELD_BY_TYPE } from "@msl/domain";
import type { McpServerConfig } from "../index.js";
import type { McpToolResult } from "./utils.js";
import {
  jsonResult,
  unauthorizedResult,
  blockedResult,
  parseStrictIsoTimestamp,
  containsCredentialLikeContent,
} from "./utils.js";

// ── Input schema ─────────────────────────────────────────────────────

const mcpPrepareWriteTargetSchema = z.union(
  Object.entries(ACTION_TARGET_FIELD_BY_TYPE).map(([type, idField]) =>
    z.object({ type: z.literal(type), [idField]: z.string() }),
  ) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
);

const mcpExactChangeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const mcpPrepareWriteInputSchema = {
  id: z.string(),
  sellerId: z.string(),
  kind: z.enum(PREPARED_WRITE_KINDS),
  target: mcpPrepareWriteTargetSchema,
  exactChange: z.array(
    z.object({
      field: z.string(),
      from: mcpExactChangeValueSchema,
      to: mcpExactChangeValueSchema,
    }),
  ),
  rationale: z.string(),
  expiresAt: z.string(),
  msl_api_key: z.string().optional(),
};

const SYNC_PRODUCT_ACTION_ID_PREFIX = "sync-product:";

// ── Credential detection helpers ─────────────────────────────────────

function hasUnsafePrepareWritePayload(
  input: Pick<PrepareWriteInput, "target" | "exactChange" | "rationale">,
): boolean {
  return (
    containsCredentialLikeContent(input.target) ||
    containsCredentialLikeContent(input.exactChange) ||
    containsCredentialLikeContent(input.rationale)
  );
}

function isProductAdsPrepareWriteTarget(target: PrepareWriteInput["target"]): boolean {
  return target.type === "product-ads-campaign" || target.type === "product-ads-ad";
}

// ── Main registration function ───────────────────────────────────────

export function registerWriteTools(
  server: McpServer,
  deps: {
    validateApiKey: (key?: string) => boolean;
    config: McpServerConfig;
  },
): void {
  const { validateApiKey, config } = deps;

  if (!config.prepareWrite) return;

  const prepareTool = createPreparedActionTool(config.prepareWrite);

  // ── prepare_mercadolibre_write ────────────────────────────────────
  server.registerTool(
    "prepare_mercadolibre_write",
    {
      description:
        "Prepares a MercadoLibre write for seller approval. This tool does not execute mutations.",
      inputSchema: mcpPrepareWriteInputSchema,
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

      if (id.startsWith(SYNC_PRODUCT_ACTION_ID_PREFIX)) {
        return blockedResult(
          "reserved-action-id",
          "Prepared write action IDs with the sync_product namespace are reserved for the sync_product tool.",
        );
      }

      const request: PrepareWriteInput = {
        id,
        sellerId,
        kind,
        target: target as PrepareWriteInput["target"],
        exactChange,
        rationale,
        expiresAt: parsedExpiresAt,
      };

      if (isProductAdsPrepareWriteTarget(request.target)) {
        return blockedResult(
          "unsupported-target",
          "Product Ads proposals must use prepare_product_ads_action so evidence validation can be enforced.",
        );
      }

      if (hasUnsafePrepareWritePayload(request)) {
        return blockedResult(
          "credential-like-payload",
          "Prepared write proposals must not include credentials, tokens, secrets, raw credential material, or database paths.",
        );
      }

      try {
        return jsonResult(await prepareTool.execute(request));
      } catch {
        return blockedResult(
          "prepare-write-failed",
          "Prepared write proposal could not be saved because approval storage is unavailable.",
        );
      }
    },
  );
}
