import type { ToolDefinition } from "./types.js";
import { safeString } from "./types.js";
import type { EconomicOutcomeStore } from "@msl/memory";
import type { CostComponentType, EconomicDataCoverage } from "@msl/domain";
import { COVERAGE_DIMENSIONS } from "@msl/domain";

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
        typeof args.startDate === "number" && !Number.isNaN(args.startDate)
          ? args.startDate
          : undefined;
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

// ── Inspect Cost Components ─────────────────────────────────────────────

export function createInspectCostComponentsTool(store?: EconomicOutcomeStore): ToolDefinition {
  return {
    name: "inspect_cost_components",
    description:
      "Read-only inspection of economic cost components for a specific seller. Lists individual cost records (marketplace fees, shipping, advertising, etc.) with provenance information. Supports type filtering. No external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "Seller ID whose cost components to inspect.",
        },
        type: {
          type: "string",
          description:
            "Optional cost component type filter. One of: product_cost, marketplace_fee, shipping, advertising, seller_discount, refund, return, tax, financing, landed_cost, packaging, other.",
        },
        limit: {
          type: "number",
          description: "Maximum components to return. Default: 50.",
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
          status: "unavailable",
          data: {
            components: [],
            total: 0,
          },
          message:
            "Economic Outcome Store no está disponible. Configure MSL_ECONOMIC_INGESTION_ENABLED=true para activar la ingesta de costos.",
          noExternalMutationExecuted: true,
        };
      }

      const typeFilter = safeString(args.type);
      const validTypes = new Set([
        "product_cost",
        "marketplace_fee",
        "shipping",
        "advertising",
        "seller_discount",
        "refund",
        "return",
        "tax",
        "financing",
        "landed_cost",
        "packaging",
        "other",
      ]);

      if (typeFilter && !validTypes.has(typeFilter)) {
        return {
          status: "error",
          error: `Tipo inválido: "${typeFilter}". Tipos válidos: ${[...validTypes].join(", ")}`,
          noExternalMutationExecuted: true,
        };
      }

      const limit =
        typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 200) : 50;

      const components = store.listCostComponents(sellerId, {
        ...(typeFilter ? { type: typeFilter as CostComponentType } : {}),
        limit,
      });

      return {
        status: "ok",
        data: {
          components,
          total: components.length,
        },
        noExternalMutationExecuted: true,
      };
    },
  };
}

// ── Inspect Evidence References ─────────────────────────────────────────

export function createInspectEvidenceReferencesTool(_store?: EconomicOutcomeStore): ToolDefinition {
  return {
    name: "inspect_evidence_references",
    description:
      "Read-only inspection of evidence references for a specific seller's economic data. Evidence references provide provenance chains linking cost components to their source systems. Currently a stub — the evidence reference store is not yet implemented. No external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "Seller ID whose evidence references to inspect.",
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

      // Stub: evidence reference store not yet implemented.
      // Use cost components for provenance until full evidence chain is available.
      return {
        status: "ok",
        data: {
          sellerId,
          message:
            "Evidence reference store not yet available. Use inspect_cost_components for per-component provenance information (source system, source record ID, verification status).",
        },
        noExternalMutationExecuted: true,
      };
    },
  };
}

// ── Inspect Coverage ────────────────────────────────────────────────────

export function createInspectCoverageTool(store?: EconomicOutcomeStore): ToolDefinition {
  return {
    name: "inspect_coverage",
    description:
      "Read-only inspection of economic data coverage for a specific seller. Computes which cost component types have data, which are missing, and which are disputed. Returns an EconomicDataCoverage report with per-dimension status and overall confidence. No external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "Seller ID whose economic coverage to inspect.",
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
          status: "unavailable",
          data: {
            message:
              "Economic Outcome Store no está disponible. Configure MSL_ECONOMIC_INGESTION_ENABLED=true para activar la ingesta económica y evaluar cobertura.",
          },
          noExternalMutationExecuted: true,
        };
      }

      // Compute coverage by querying cost components per dimension
      const dimensions: Record<string, string> = {};
      const missingDimensions: string[] = [];
      const disputedDimensions: string[] = [];
      let totalComponents = 0;
      let disputedCount = 0;

      for (const dim of COVERAGE_DIMENSIONS) {
        // Map coverage dimensions to cost component types
        const costTypes = coverageDimensionToCostTypes(dim);
        if (!costTypes) {
          // Non-cost dimensions (currency_consistency, evidence_current, evidence_disputed, reconciliation)
          continue;
        }

        let hasData = false;
        let hasDisputed = false;

        for (const ct of costTypes) {
          const components = store.listCostComponents(sellerId, {
            type: ct,
            limit: 1,
            includeReversed: false,
          });
          totalComponents += components.length;
          if (components.length > 0) {
            hasData = true;
            for (const c of components) {
              if (c.verification === "disputed") {
                hasDisputed = true;
                disputedCount++;
              }
            }
          }
        }

        if (hasDisputed) {
          dimensions[dim] = "disputed";
          disputedDimensions.push(dim);
        } else if (hasData) {
          dimensions[dim] = "complete";
        } else {
          dimensions[dim] = "partial";
          missingDimensions.push(dim);
        }
      }

      // Evidence & meta dimensions
      dimensions["evidence_current"] = "partial";
      dimensions["evidence_disputed"] = disputedCount > 0 ? "disputed" : "complete";
      dimensions["currency_consistency"] = totalComponents > 0 ? "complete" : "partial";
      dimensions["reconciliation"] = "partial";

      // Compute overall status
      let overallStatus = "complete";
      if (disputedDimensions.length > 0) {
        overallStatus = "disputed";
      } else if (missingDimensions.length > 0) {
        overallStatus = "partial";
      }

      const coverage = {
        sellerId,
        evaluatedAt: Date.now(),
        dimensions: dimensions as Readonly<
          Record<string, string>
        > as unknown as EconomicDataCoverage["dimensions"],
        overallStatus: overallStatus as EconomicDataCoverage["overallStatus"],
        confidence:
          totalComponents > 0
            ? Math.min(0.95, (totalComponents - disputedCount) / (totalComponents || 1))
            : 0.5,
        missingDimensions:
          missingDimensions as readonly string[] as unknown as EconomicDataCoverage["missingDimensions"],
        disputedDimensions:
          disputedDimensions as readonly string[] as unknown as EconomicDataCoverage["disputedDimensions"],
      };

      return {
        status: "ok",
        data: { coverage },
        noExternalMutationExecuted: true,
      };
    },
  };
}

// Coverage dimension → cost component type mapping
function coverageDimensionToCostTypes(dim: string): CostComponentType[] | null {
  const map: Record<string, CostComponentType[]> = {
    revenue: [],
    marketplace_fee: ["marketplace_fee"],
    shipping: ["shipping"],
    seller_discount: ["seller_discount"],
    refund_return: ["refund", "return"],
    advertising: ["advertising"],
    product_cost: ["product_cost"],
    landed_cost: ["landed_cost"],
  };
  return map[dim] ?? null;
}

// ── Reconcile Seller Economics ──────────────────────────────────────────

export function createReconcileSellerEconomicsTool(store?: EconomicOutcomeStore): ToolDefinition {
  return {
    name: "reconcile_seller_economics",
    description:
      "Read-only reconciliation of a seller's economic data. Compares source totals against computed snapshots to detect inconsistencies. Returns a ReconciliationVerdict (balanced, balanced-with-tolerance, incomplete, mismatched, disputed). Can identify discrepancies but does NOT execute corrections. No external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "Seller ID whose economics to reconcile.",
        },
        tolerance: {
          type: "number",
          description:
            "Tolerance in minor currency units for considering balances 'close enough'. Default: 1 (single minor unit).",
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
          status: "unavailable",
          data: {
            verdict: "incomplete",
            sellerId,
          },
          message: "Economic Outcome Store no está disponible. No hay datos para reconciliar.",
          noExternalMutationExecuted: true,
        };
      }

      const tolerance =
        typeof args.tolerance === "number" && args.tolerance >= 0 ? args.tolerance : 1;

      // Get unit economics snapshots for the seller
      const snapshots = store.listUnitEconomicsSnapshots(sellerId, { limit: 500 });

      if (snapshots.length === 0) {
        return {
          status: "ok",
          data: {
            verdict: "incomplete",
            sellerId,
            message:
              "No hay snapshots de unit economics para este seller. Ejecutá la ingesta primero con npm run economic:ingest.",
          },
          noExternalMutationExecuted: true,
        };
      }

      // Compute total from snapshots
      let totalCosts = 0;
      let snapshotCount = 0;

      for (const snapshot of snapshots) {
        totalCosts +=
          snapshot.marketplaceFees +
          snapshot.sellerShippingCost +
          snapshot.sellerFundedDiscounts +
          snapshot.refunds +
          snapshot.advertisingCost +
          snapshot.productCost +
          snapshot.allocatedLandedCost +
          snapshot.taxes +
          snapshot.financingCost +
          snapshot.packagingCost +
          snapshot.otherCosts;
        snapshotCount++;
      }

      // Get cost components directly from store
      const costComponents = store.listCostComponents(sellerId, { limit: 1000 });
      let storeTotalCosts = 0;
      for (const c of costComponents) {
        storeTotalCosts += c.amount.amountMinor;
      }

      // Compare totals
      const diff = Math.abs(totalCosts - storeTotalCosts);

      let verdict: string;
      if (snapshotCount === 0 && costComponents.length === 0) {
        verdict = "incomplete";
      } else if (diff === 0) {
        verdict = "balanced";
      } else if (diff <= tolerance) {
        verdict = "balanced-with-tolerance";
      } else if (totalCosts === 0 && storeTotalCosts > 0) {
        verdict = "incomplete";
      } else if (totalCosts > 0 && storeTotalCosts === 0) {
        verdict = "incomplete";
      } else {
        verdict = "mismatched";
      }

      return {
        status: "ok",
        data: {
          verdict,
          sellerId,
          snapshotCostsTotal: totalCosts,
          storeCostsTotal: storeTotalCosts,
          difference: diff,
          tolerance,
          snapshotCount,
          costComponentCount: costComponents.length,
          ...(verdict === "mismatched"
            ? {
                recommendation: `Diferencia de ${diff} unidades menores excede la tolerancia de ${tolerance}. Re-ejecutá la ingesta para este seller o investigá manualmente los componentes de costo.`,
              }
            : {}),
        },
        noExternalMutationExecuted: true,
      };
    },
  };
}
