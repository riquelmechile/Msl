import type {
  SupplierItemSnapshot,
  SupplierMirrorNotificationEvent,
  SupplierPricingPolicy,
  SupplierStockObservation,
  SupplierTargetMapping,
  SupplierTargetPolicy,
} from "@msl/domain";
import type { SupplierMirrorStore } from "@msl/memory";

import type { ToolDefinition } from "./tools.js";

export type ParsedSupplierPricingPolicy =
  | { status: "parsed"; policy: SupplierPricingPolicy; normalized: string }
  | { status: "missing-policy"; missingInputs: readonly string[]; prompt: string };

export function parseSupplierPricingPolicyText(text: string): ParsedSupplierPricingPolicy {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  const multiplier = normalized.match(/(?:^|\b)(?:x|×)\s*([234])(?:\b|$)/u);
  if (multiplier) {
    return {
      status: "parsed",
      policy: { kind: "multiplier", multiplier: Number(multiplier[1]) as 2 | 3 | 4 },
      normalized: `x${multiplier[1]}`,
    };
  }

  const fixedUplift = normalized.match(
    /(?:\+|sumar|agregar|subir)\s*\$?\s*([0-9][0-9.,]*)\s*(?:clp|pesos?)?\b/u,
  );
  if (fixedUplift) {
    const amount = Number(fixedUplift[1]!.replace(/[.,]/g, ""));
    if (Number.isFinite(amount) && amount > 0) {
      return {
        status: "parsed",
        policy: { kind: "fixed-uplift-clp", amount },
        normalized: `+${amount} CLP`,
      };
    }
  }

  return {
    status: "missing-policy",
    missingInputs: ["pricing policy: x2, x3, x4, or +CLP uplift"],
    prompt:
      "Ask the CEO to choose a supplier pricing policy such as x2, x3, x4, or +50,000 CLP before preparing price proposals.",
  };
}

export function applySupplierPricingPolicy(input: {
  supplierPrice: number;
  policy: SupplierPricingPolicy;
}):
  | { status: "priced"; proposedPrice: number; rationale: string }
  | { status: "learned-policy-required"; policyId: string } {
  if (input.policy.kind === "learned") {
    return { status: "learned-policy-required", policyId: input.policy.policyId };
  }
  const proposedPrice =
    input.policy.kind === "multiplier"
      ? input.supplierPrice * input.policy.multiplier
      : input.supplierPrice + input.policy.amount;
  return {
    status: "priced",
    proposedPrice: Math.round(proposedPrice),
    rationale:
      input.policy.kind === "multiplier"
        ? `supplier price multiplied by x${input.policy.multiplier}`
        : `supplier price plus ${input.policy.amount} CLP`,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function newestObservation(
  observations: readonly SupplierStockObservation[],
): SupplierStockObservation | undefined {
  return [...observations].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
}

function summarizeMappings(mappings: readonly SupplierTargetMapping[]) {
  return mappings.map((mapping) => ({
    targetSellerId: mapping.targetSellerId,
    targetItemId: mapping.targetItemId,
    state: mapping.state,
    policyRef: mapping.policyRef,
    evidenceIds: mapping.evidenceIds,
  }));
}

function summarizePolicy(policy: SupplierTargetPolicy | null) {
  if (!policy) return null;
  return {
    scopeType: policy.scopeType,
    scopeId: policy.scopeId,
    supplierId: policy.supplierId,
    targetSellerIds: policy.targetSellerIds,
    lowStockThreshold: policy.lowStockThreshold,
    autoPauseAllowed: policy.autoPauseAllowed,
    pricingPolicy: policy.pricingPolicy ?? null,
  };
}

function summarizeSnapshot(snapshot: SupplierItemSnapshot) {
  return {
    supplierId: snapshot.supplierId,
    supplierItemId: snapshot.supplierItemId,
    title: snapshot.title,
    mlItemId: snapshot.mlItemId ?? null,
    categoryId: snapshot.categoryId ?? null,
    price: snapshot.price ?? null,
    currency: snapshot.currency ?? null,
    source: snapshot.source,
    confidence: snapshot.confidence,
    freshness: snapshot.freshness,
    evidenceId: snapshot.evidenceId,
    capturedAt: snapshot.capturedAt,
  };
}

function summarizeNotification(event: SupplierMirrorNotificationEvent) {
  return {
    id: event.id,
    type: event.type,
    status: event.status,
    supplierId: event.supplierId,
    supplierItemId: event.supplierItemId ?? null,
    targetSellerId: event.targetSellerId ?? null,
    targetItemId: event.targetItemId ?? null,
    reason: event.reason,
    evidenceIds: event.evidenceIds,
    metadata: event.metadata,
    createdAt: event.createdAt,
  };
}

export function createSupplierMirrorTools(store: SupplierMirrorStore): ToolDefinition[] {
  const reviewOpportunities: ToolDefinition = {
    name: "review_supplier_mirror_opportunities",
    description:
      "Reviews Supplier Mirror supplier items, mappings, target policies, and latest stock evidence for the CEO. Read-only and CEO-facing; it does not expose worker selection or execute mutations.",
    parameters: {
      type: "object",
      properties: {
        supplierId: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 20 },
      },
      required: [],
    },
    execute: async (args) => {
      const requestedSupplierId = readString(args.supplierId);
      const limit = Math.max(1, Math.min(readNumber(args.limit) ?? 10, 20));
      const suppliers = requestedSupplierId
        ? [await store.getSupplier(requestedSupplierId)].filter((supplier) => supplier !== null)
        : await store.listEnabledSuppliers();
      const opportunities = [];

      for (const supplier of suppliers) {
        const snapshots = (await store.listSupplierItemSnapshots(supplier.id)).slice(0, limit);
        for (const snapshot of snapshots) {
          const [mappings, observations, policy] = await Promise.all([
            store.listTargetMappings(snapshot.supplierId, snapshot.supplierItemId),
            store.listStockObservations(snapshot.supplierId, snapshot.supplierItemId),
            store.resolveTargetPolicy({
              supplierId: snapshot.supplierId,
              supplierItemId: snapshot.supplierItemId,
              ...(snapshot.categoryId ? { categoryId: snapshot.categoryId } : {}),
            }),
          ]);
          opportunities.push({
            supplier: {
              id: supplier.id,
              name: supplier.name,
              primarySource: supplier.primarySource,
            },
            item: summarizeSnapshot(snapshot),
            latestStockObservation: newestObservation(observations) ?? null,
            mappings: summarizeMappings(mappings),
            policy: summarizePolicy(policy),
            missingInputs: policy ? [] : ["target/pricing policy decision from CEO"],
          });
        }
      }

      return {
        status: "ready",
        opportunities,
        noMutationExecuted: true,
        workerSelectionExposed: false,
      };
    },
  };

  const reviewNotifications: ToolDefinition = {
    name: "review_supplier_mirror_notifications",
    description:
      "Lists recent Supplier Mirror stock alerts and notification events for CEO review. Read-only; no alert suppression or external message is executed.",
    parameters: {
      type: "object",
      properties: {
        supplierId: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 20 },
      },
      required: [],
    },
    execute: async (args) => {
      const supplierId = readString(args.supplierId);
      const limit = Math.max(1, Math.min(readNumber(args.limit) ?? 10, 20));
      const events = await store.listNotificationEvents({
        ...(supplierId ? { supplierId } : {}),
        limit,
      });
      return {
        status: "ready",
        events: events.map(summarizeNotification),
        noMutationExecuted: true,
      };
    },
  };

  const proposePricingPolicy: ToolDefinition = {
    name: "propose_supplier_mirror_pricing_policy",
    description:
      "Parses deterministic CEO pricing policies like x2, x3, x4, or +50,000 CLP and prepares a proposal-only price calculation. It never changes MercadoLibre prices.",
    parameters: {
      type: "object",
      properties: {
        policyText: { type: "string" },
        supplierPrice: { type: "number" },
        supplierId: { type: "string" },
        supplierItemId: { type: "string" },
        targetSellerId: { type: "string" },
      },
      required: ["policyText", "supplierPrice"],
    },
    execute: (args) => {
      const parsed = parseSupplierPricingPolicyText(readString(args.policyText) ?? "");
      const supplierPrice = readNumber(args.supplierPrice);
      if (supplierPrice === undefined || supplierPrice < 0) {
        return { status: "blocked", missingInputs: ["supplierPrice"], noMutationExecuted: true };
      }
      if (parsed.status === "missing-policy") {
        return { ...parsed, noMutationExecuted: true };
      }
      return {
        status: "proposal-prepared",
        supplierId: readString(args.supplierId) ?? null,
        supplierItemId: readString(args.supplierItemId) ?? null,
        targetSellerId: readString(args.targetSellerId) ?? null,
        policy: parsed.policy,
        normalizedPolicy: parsed.normalized,
        pricing: applySupplierPricingPolicy({ supplierPrice, policy: parsed.policy }),
        noMutationExecuted: true,
      };
    },
  };

  return [reviewOpportunities, reviewNotifications, proposePricingPolicy];
}
