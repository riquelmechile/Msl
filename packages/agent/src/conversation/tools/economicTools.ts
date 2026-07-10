import type { ToolDefinition } from "./types.js";
import { safeString } from "./types.js";
import type { EconomicOutcomeStore } from "@msl/memory";

// ── Inspect Unit Economics ──────────────────────────────────────────────────

export function createInspectUnitEconomicsTool(store?: EconomicOutcomeStore): ToolDefinition {
  return {
    name: "inspect_unit_economics",
    description:
      "Read-only inspection of unit economics snapshots for a specific seller. Queries the unit_economics_snapshots table to review financial performance at the order/item level. Supports filtering by snapshotId, orderId, itemId, and SKU. No external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "Seller ID whose unit economics snapshots to inspect.",
        },
        snapshotId: {
          type: "string",
          description: "Optional specific snapshot ID to retrieve.",
        },
        orderId: {
          type: "string",
          description: "Optional order ID filter.",
        },
        itemId: {
          type: "string",
          description: "Optional item ID filter.",
        },
        sku: {
          type: "string",
          description: "Optional SKU filter.",
        },
      },
      required: ["sellerId"],
    },
    execute(args: Record<string, unknown>): Record<string, unknown> {
      const sellerId = safeString(args.sellerId);
      if (!sellerId) {
        return {
          status: "error",
          error: "sellerId es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      if (!store) {
        return {
          status: "error",
          error: "Tienda no disponible",
          noExternalMutationExecuted: true,
        };
      }

      const snapshotId = safeString(args.snapshotId);
      const orderId = safeString(args.orderId);
      const itemId = safeString(args.itemId);
      const sku = safeString(args.sku);

      const opts: {
        snapshotId?: string;
        orderId?: string;
        itemId?: string;
        sku?: string;
        limit: number;
      } = { limit: 50 };
      if (snapshotId) opts.snapshotId = snapshotId;
      if (orderId) opts.orderId = orderId;
      if (itemId) opts.itemId = itemId;
      if (sku) opts.sku = sku;

      const snapshots = store.listUnitEconomicsSnapshots(sellerId, opts);

      return {
        status: "ok",
        data: {
          snapshots,
          total: snapshots.length,
        },
        noExternalMutationExecuted: true,
      };
    },
  };
}

// ── Inspect Economic Outcome ────────────────────────────────────────────────

export function createInspectEconomicOutcomeTool(store?: EconomicOutcomeStore): ToolDefinition {
  return {
    name: "inspect_economic_outcome",
    description:
      "Read-only inspection of economic outcome records for a specific seller. Filter by outcome ID, status, or order. No external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "Seller ID whose economic outcomes to inspect.",
        },
        outcomeId: {
          type: "string",
          description:
            "Optional specific outcome ID. If not provided, lists all outcomes for the seller.",
        },
        status: {
          type: "string",
          description:
            "Optional filter by outcome status (pending, observing, observed, verified, disputed, invalidated).",
        },
        orderId: {
          type: "string",
          description: "Optional filter by order ID.",
        },
        limit: {
          type: "number",
          description: "Maximum outcomes to return. Default: 20.",
        },
      },
      required: ["sellerId"],
    },
    execute(args: Record<string, unknown>): Record<string, unknown> {
      const sellerId = safeString(args.sellerId);
      if (!sellerId) {
        return {
          status: "error",
          error: "sellerId es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      if (!store) {
        return {
          status: "error",
          error: "Tienda no disponible",
          noExternalMutationExecuted: true,
        };
      }

      const outcomeId = safeString(args.outcomeId);
      const orderId = safeString(args.orderId);
      const statusFilter = safeString(args.status);
      const limit =
        typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 100) : 20;

      // Validate status if provided
      if (statusFilter) {
        const validStatuses = new Set([
          "pending",
          "observing",
          "observed",
          "verified",
          "disputed",
          "invalidated",
        ]);
        if (!validStatuses.has(statusFilter)) {
          return {
            status: "error",
            error: `Estado inválido: "${statusFilter}". Estados válidos: ${[...validStatuses].join(", ")}`,
            noExternalMutationExecuted: true,
          };
        }
      }

      // Single outcome lookup
      if (outcomeId) {
        const outcome = store.getOutcome(outcomeId, sellerId);
        if (!outcome) {
          return {
            status: "ok",
            data: null,
            message: `Outcome ${outcomeId} no encontrado para seller ${sellerId}`,
            noExternalMutationExecuted: true,
          };
        }

        // Check status filter if provided
        if (statusFilter && outcome.status !== statusFilter) {
          return {
            status: "ok",
            data: null,
            message: `Outcome ${outcomeId} tiene status "${outcome.status}", no "${statusFilter}"`,
            noExternalMutationExecuted: true,
          };
        }

        return {
          status: "ok",
          data: outcome,
          noExternalMutationExecuted: true,
        };
      }

      // List outcomes with filters
      let outcomes;
      if (orderId) {
        outcomes = store.listOutcomesByOrder(orderId, sellerId);
      } else {
        outcomes = store.listOutcomesBySeller(sellerId, { limit });
      }

      // Apply status filter
      if (statusFilter) {
        outcomes = outcomes.filter((o) => o.status === statusFilter);
      }

      // Enforce limit after filtering
      outcomes = outcomes.slice(0, limit);

      return {
        status: "ok",
        data: {
          outcomes,
          total: outcomes.length,
          filters: {
            sellerId,
            ...(statusFilter ? { status: statusFilter } : {}),
            ...(orderId ? { orderId } : {}),
            ...(outcomeId ? { outcomeId } : {}),
          },
        },
        noExternalMutationExecuted: true,
      };
    },
  };
}

// ── List Missing Economic Inputs ────────────────────────────────────────────

export function createListMissingEconomicInputsTool(store?: EconomicOutcomeStore): ToolDefinition {
  return {
    name: "list_missing_economic_inputs",
    description:
      "Read-only listing of missing economic cost inputs for a specific seller. Returns deduplicated cost component types that need to be provided for complete unit economics calculations. No external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "Seller ID to check for missing economic inputs.",
        },
      },
      required: ["sellerId"],
    },
    execute(args: Record<string, unknown>): Record<string, unknown> {
      const sellerId = safeString(args.sellerId);
      if (!sellerId) {
        return {
          status: "error",
          error: "sellerId es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      if (!store) {
        return {
          status: "error",
          error: "Tienda no disponible",
          noExternalMutationExecuted: true,
        };
      }

      const missingInputs = store.listMissingInputs(sellerId);

      // Deduplicate across all results into a single list
      const allMissingTypes = new Set<string>();
      for (const entry of missingInputs) {
        for (const type of entry.missingTypes) {
          allMissingTypes.add(type);
        }
      }

      return {
        status: "ok",
        data: {
          sellerId,
          missingInputs: [...allMissingTypes].sort(),
          affectedSnapshots: missingInputs.length,
          details: missingInputs,
        },
        noExternalMutationExecuted: true,
      };
    },
  };
}

// ── Summarize Profit ────────────────────────────────────────────────────────

export function createSummarizeProfitTool(store?: EconomicOutcomeStore): ToolDefinition {
  return {
    name: "summarize_profit",
    description:
      "Read-only profit summary for a specific seller and currency. Aggregates gross revenue and net profit across all unit economics snapshots. Supports date range filtering. No external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "Seller ID whose profit to summarize.",
        },
        currency: {
          type: "string",
          description: "Currency to filter by (e.g., CLP, USD).",
        },
        startDate: {
          type: "number",
          description: "Optional start date filter (epoch ms). Snapshots before this are excluded.",
        },
        endDate: {
          type: "number",
          description: "Optional end date filter (epoch ms). Snapshots after this are excluded.",
        },
      },
      required: ["sellerId", "currency"],
    },
    execute(args: Record<string, unknown>): Record<string, unknown> {
      const sellerId = safeString(args.sellerId);
      if (!sellerId) {
        return {
          status: "error",
          error: "sellerId es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      const currency = safeString(args.currency);
      if (!currency) {
        return {
          status: "error",
          error: "currency es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      if (!store) {
        return {
          status: "error",
          error: "Tienda no disponible",
          noExternalMutationExecuted: true,
        };
      }

      const validCurrencies = new Set(["CLP", "USD"]);
      if (!validCurrencies.has(currency)) {
        return {
          status: "error",
          error: `Moneda inválida: "${currency}". Monedas válidas: ${[...validCurrencies].join(", ")}`,
          noExternalMutationExecuted: true,
        };
      }

      const startDate =
        typeof args.startDate === "number" && !Number.isNaN(args.startDate) ? args.startDate : undefined;
      const endDate =
        typeof args.endDate === "number" && !Number.isNaN(args.endDate) ? args.endDate : undefined;

      const opts: { startDate?: number; endDate?: number } = {};
      if (startDate !== undefined) opts.startDate = startDate;
      if (endDate !== undefined) opts.endDate = endDate;

      const summary = store.summarizeProfit(sellerId, currency as "CLP" | "USD", opts);

      return {
        status: "ok",
        data: summary,
        noExternalMutationExecuted: true,
      };
    },
  };
}
