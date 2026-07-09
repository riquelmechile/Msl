import type {
  SupplierItemSnapshot,
  SupplierLearnedFallbackPolicy,
  SupplierMirrorLedgerRecord,
  SupplierMirrorNotificationEvent,
  SupplierPricingPolicy,
  SupplierRegistryEntry,
  SupplierStockObservation,
  SupplierTargetMapping,
  SupplierTargetPolicy,
} from "@msl/domain";
import type { SupplierMirrorStore } from "@msl/memory";
import type { GraphEngine } from "@msl/memory";
import { ingestFallbackLessonToCortex } from "@msl/memory";

import type { SupplierMirrorDeepSeekAdvisor } from "./supplierMirrorDeepSeekAdvisor.js";
import type { ToolDefinition } from "./tools.js";
import {
  buildSupplierMirrorDeepSeekPromptPlan,
  estimateSupplierMirrorDeepSeekCostMicros,
  selectSupplierMirrorDeepSeekModel,
  SUPPLIER_MIRROR_DEEPSEEK_PRICING,
} from "./supplierMirrorDeepSeekPolicy.js";

export type ParsedSupplierPricingPolicy =
  | { status: "parsed"; policy: SupplierPricingPolicy; normalized: string }
  | { status: "missing-policy"; missingInputs: readonly string[]; prompt: string };

export function parseSupplierPricingPolicyText(text: string): ParsedSupplierPricingPolicy {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  const multiplier = normalized.match(/(?:^|\s)(?:x|×)\s*([0-9]+(?:[.,][0-9]+)?)(?:\b|$)/u);
  if (multiplier) {
    const multiplierValue = Number(multiplier[1]!.replace(",", "."));
    if (!Number.isFinite(multiplierValue) || multiplierValue <= 0) {
      return {
        status: "missing-policy",
        missingInputs: ["positive pricing multiplier such as x2, x2.5, x3, or +CLP uplift"],
        prompt:
          "Ask the CEO to choose a positive supplier pricing multiplier such as x2, x2.5, x3, or +50,000 CLP before preparing price proposals.",
      };
    }
    return {
      status: "parsed",
      policy: { kind: "multiplier", multiplier: multiplierValue },
      normalized: `x${multiplierValue}`,
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
    missingInputs: ["pricing policy: x2, x2.5, x3, x4, or +CLP uplift"],
    prompt:
      "Ask the CEO to choose a supplier pricing policy such as x2, x2.5, x3, x4, or +50,000 CLP before preparing price proposals.",
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

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
    : [];
}

function slugSegment(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

function normalizeFallbackPolicyType(value: unknown): SupplierLearnedFallbackPolicy["policyType"] {
  const normalized = readString(value)?.toLowerCase();
  switch (normalized) {
    case "pricing":
    case "targeting":
    case "stock":
    case "notification":
    case "error-outcome":
      return normalized;
    default:
      return "notification";
  }
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

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function readUnknownArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function summarizeReadinessSupplier(supplier: SupplierRegistryEntry) {
  return {
    id: supplier.id,
    name: supplier.name,
    enabled: supplier.enabled,
    primarySource: supplier.primarySource,
    runtimeEnabled: supplier.metadata.runtimeEnabled === true,
    workerEnabled: supplier.metadata.workerEnabled === true,
    requiresCeoConfirmation: supplier.metadata.requiresCeoConfirmation === true,
  };
}

function summarizeLedger(record: SupplierMirrorLedgerRecord) {
  return {
    id: record.id,
    actionType: record.actionType,
    idempotencyKey: record.idempotencyKey,
    status: record.status,
    reason: record.reason,
    evidenceIds: record.evidenceIds,
    createdAt: record.createdAt,
  };
}

function buildJinpengReadinessLedgerKeys(): readonly string[] {
  return [
    "supplier-mirror:jinpeng-bootstrap:target-proposal:maustian",
    "supplier-mirror:jinpeng-bootstrap:target-proposal:plasticov",
    "supplier-mirror:jinpeng-bootstrap:validation-skip:credentials",
    "supplier-mirror:jinpeng-bootstrap:validation-skip:source-info",
    "supplier-mirror:jinpeng-bootstrap:enablement-block",
  ];
}

export function createSupplierMirrorTools(
  store: SupplierMirrorStore,
  advisor?: SupplierMirrorDeepSeekAdvisor,
  engine?: GraphEngine,
): ToolDefinition[] {
  const reviewReadiness: ToolDefinition = {
    name: "review_supplier_mirror_readiness",
    description:
      "Reviews Jinpeng Supplier Mirror readiness for the CEO using local bootstrap evidence. Read-only; it does not expose worker selection, enable workers, or execute external mutations.",
    parameters: {
      type: "object",
      properties: {
        supplierId: { type: "string" },
      },
      required: [],
    },
    execute: async (args) => {
      const supplierId = readString(args.supplierId) ?? "jinpeng";
      const supplier = await store.getSupplier(supplierId);
      if (supplier === null) {
        return {
          status: "blocked",
          supplierId,
          missingDecisions: ["Run the Jinpeng bootstrap before reviewing readiness."],
          failures: ["supplier bootstrap report is missing"],
          noMutationExecuted: true,
          workerSelectionExposed: false,
        };
      }

      const metadata = supplier.metadata;
      const identity = readRecord(metadata.mlIdentity);
      const sources = readRecord(metadata.sources);
      const missingCredentials = readStringArray(metadata.missingCredentials);
      const missingSourceInfo = readStringArray(metadata.missingSourceInfo);
      const targetProposals = readUnknownArray(metadata.targetProposals);
      const policy = await store.resolveTargetPolicy({
        supplierId,
        supplierItemId: "__readiness__",
      });
      const ledgerRecords = (
        await Promise.all(
          buildJinpengReadinessLedgerKeys().map((key) => store.getLedgerByIdempotencyKey(key)),
        )
      ).filter((record): record is SupplierMirrorLedgerRecord => record !== null);
      const failures = [
        ...missingCredentials.map((name) => `Missing credential: ${name}`),
        ...missingSourceInfo.map((name) => `Missing source information: ${name}`),
        ...(identity.verified === true ? [] : ["Supplier identity is not verified"]),
        ...(policy === null ? ["Target policy proposal is missing"] : []),
      ];
      const missingDecisions = [
        ...(identity.sellerId === undefined && identity.nickname === undefined
          ? ["Confirm Jinpeng MercadoLibre seller id or nickname."]
          : []),
        ...(missingCredentials.length > 0 ? ["Provide MercadoLibre runtime credentials."] : []),
        ...(metadata.defaultLowStockThreshold === undefined
          ? ["Confirm low-stock threshold for Jinpeng."]
          : []),
        ...(supplier.enabled &&
        metadata.runtimeEnabled === true &&
        metadata.requiresCeoConfirmation !== true
          ? []
          : ["Approve runtime enablement after readiness is validated."]),
      ];

      return {
        status: failures.length > 0 ? "blocked" : "ready-for-ceo-decision",
        supplier: summarizeReadinessSupplier(supplier),
        identity: {
          sellerId: identity.sellerId ?? null,
          nickname: identity.nickname ?? null,
          profileUrl: identity.profileUrl ?? null,
          verified: identity.verified === true,
        },
        authority: {
          mlStockAuthority: sources.mlStockAuthority ?? "missing",
          xkpEnrichment: sources.xkpEnrichment ?? "missing",
        },
        policy: policy === null ? null : summarizePolicy(policy),
        targetProposals,
        failures,
        missingDecisions,
        ledgerEvidence: ledgerRecords.map(summarizeLedger),
        noMutationExecuted: true,
        workerSelectionExposed: false,
      };
    },
  };

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
      "Parses deterministic CEO pricing policies like x2, x2.5, x3, x4, or +50,000 CLP and prepares a proposal-only price calculation. It never changes MercadoLibre prices.",
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

  const recordFallbackLesson: ToolDefinition = {
    name: "record_supplier_mirror_fallback_lesson",
    description:
      "Records a CEO-approved Supplier Mirror fallback lesson or notification suppression. Local persistence only; no external messages, listing changes, or price mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        lessonType: {
          type: "string",
          enum: ["pricing", "targeting", "stock", "notification", "error-outcome"],
        },
        supplierId: { type: "string" },
        supplierItemId: { type: "string" },
        categoryId: { type: "string" },
        alertType: { type: "string" },
        decisionText: { type: "string" },
        suppressNotifications: { type: "boolean" },
        evidenceIds: { type: "array", items: { type: "string" } },
      },
      required: ["lessonType", "supplierId", "decisionText"],
    },
    execute: async (args) => {
      const supplierId = readString(args.supplierId);
      const decisionText = readString(args.decisionText);
      const lessonType = normalizeFallbackPolicyType(args.lessonType);
      const supplierItemId = readString(args.supplierItemId);
      const categoryId = readString(args.categoryId);
      const alertType = readString(args.alertType) ?? lessonType;
      const evidenceIds = readStringArray(args.evidenceIds);
      const missingInputs: string[] = [];
      if (!supplierId) missingInputs.push("supplierId");
      if (!decisionText) missingInputs.push("decisionText");
      if (missingInputs.length > 0) {
        return { status: "blocked", missingInputs, noMutationExecuted: true };
      }

      const scopeType = supplierItemId ? "item" : categoryId ? "category" : "supplier";
      const scopeId = supplierItemId ?? categoryId ?? supplierId!;
      const policyId = [
        "supplier-mirror",
        lessonType,
        slugSegment(supplierId!, "supplier"),
        slugSegment(scopeType, "scope"),
        slugSegment(scopeId, "scope-id"),
        slugSegment(alertType, "alert"),
      ].join(":");
      const suppressNotifications = readBoolean(args.suppressNotifications);

      await store.upsertLearnedFallbackPolicy({
        id: policyId,
        policyType: lessonType,
        scope: {
          supplierId,
          scopeType,
          scopeId,
          ...(supplierItemId ? { supplierItemId } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(alertType ? { alertType } : {}),
        },
        decision: {
          decisionText,
          suppressNotifications,
          recordedFrom: "ceo-workflow",
        },
        confidence: "medium",
        evidenceIds,
        status: suppressNotifications || lessonType !== "notification" ? "active" : "proposed",
      });

      // Ingest fallback lesson into Cortex for pattern discovery
      if (engine) {
        try {
          const lessonRecord: SupplierLearnedFallbackPolicy = {
            id: policyId,
            policyType: lessonType,
            scope: {
              supplierId,
              scopeType,
              scopeId,
              ...(supplierItemId ? { supplierItemId } : {}),
              ...(categoryId ? { categoryId } : {}),
              ...(alertType ? { alertType } : {}),
            },
            decision: {
              decisionText,
              suppressNotifications,
              recordedFrom: "ceo-workflow",
            },
            confidence: "medium",
            evidenceIds,
            status: suppressNotifications || lessonType !== "notification" ? "active" : "proposed",
          };
          await ingestFallbackLessonToCortex(engine, lessonRecord);
        } catch (err) {
          console.error("Failed to ingest fallback lesson to Cortex:", err);
          // Non-blocking — lesson is already in SM store
        }
      }

      if (suppressNotifications) {
        await store.saveNotificationPreference({
          scopeType,
          scopeId,
          preference: {
            suppress: true,
            alertType,
            supplierId,
            learnedFallbackPolicyId: policyId,
            reason: decisionText,
          },
        });
      }

      return {
        status: "recorded",
        learnedFallbackPolicyId: policyId,
        notificationPreferenceSaved: suppressNotifications,
        scope: { scopeType, scopeId, supplierId },
        noMutationExecuted: true,
      };
    },
  };

  const planDeepSeekUsage: ToolDefinition = {
    name: "plan_supplier_mirror_deepseek_usage",
    description:
      "Builds Supplier Mirror DeepSeek V4 Flash/Pro routing and cache/cost metadata for CEO evidence planning. It does not call DeepSeek or store prompts.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["supplier-extraction", "supplier-classification", "policy-conflict"],
        },
        hardPolicyConflict: { type: "boolean" },
        supplierId: { type: "string" },
        supplierName: { type: "string" },
        targetSellerIds: { type: "array", items: { type: "string" } },
        policySummary: { type: "string" },
        evidenceIds: { type: "array", items: { type: "string" } },
        promptCacheHitTokens: { type: "number", minimum: 0 },
        promptCacheMissTokens: { type: "number", minimum: 0 },
        outputTokens: { type: "number", minimum: 0 },
      },
      required: ["operation", "supplierId", "supplierName"],
    },
    execute: (args) => {
      const supplierId = readString(args.supplierId);
      const supplierName = readString(args.supplierName);
      if (!supplierId || !supplierName) {
        return {
          status: "blocked",
          missingInputs: [!supplierId ? "supplierId" : "supplierName"],
          noMutationExecuted: true,
        };
      }
      const model = selectSupplierMirrorDeepSeekModel({
        operation:
          args.operation === "policy-conflict"
            ? "policy-conflict"
            : args.operation === "supplier-classification"
              ? "supplier-classification"
              : "supplier-extraction",
        hardPolicyConflict: readBoolean(args.hardPolicyConflict),
      });
      const promptPlan = buildSupplierMirrorDeepSeekPromptPlan({
        supplierId,
        supplierName,
        targetSellerIds: readStringArray(args.targetSellerIds),
        evidenceIds: readStringArray(args.evidenceIds),
        ...(readString(args.policySummary) === undefined
          ? {}
          : { policySummary: readString(args.policySummary) }),
      });
      const estimatedCostMicros = estimateSupplierMirrorDeepSeekCostMicros({
        model,
        ...(readNumber(args.promptCacheHitTokens) === undefined
          ? {}
          : { promptCacheHitTokens: readNumber(args.promptCacheHitTokens) }),
        ...(readNumber(args.promptCacheMissTokens) === undefined
          ? {}
          : { promptCacheMissTokens: readNumber(args.promptCacheMissTokens) }),
        ...(readNumber(args.outputTokens) === undefined
          ? {}
          : { outputTokens: readNumber(args.outputTokens) }),
      });
      return {
        status: "planned",
        provider: "deepseek",
        model,
        pricing: SUPPLIER_MIRROR_DEEPSEEK_PRICING[model],
        estimatedCostMicros,
        currency: "USD",
        promptPlan,
        noMutationExecuted: true,
      };
    },
  };

  const analyzeEvidence: ToolDefinition | null = advisor
    ? {
        name: "analyze_supplier_mirror_evidence",
        description:
          "Analyzes supplier evidence with DeepSeek AI. Returns stock alerts, price opportunities, mapping suggestions, and policy recommendations. The CEO can ask specific questions like '¿hay stock bajo?' or '¿qué productos conviene mapear primero?'.",
        parameters: {
          type: "object",
          properties: {
            supplierId: { type: "string", description: "ID del proveedor (ej: 'jinpeng')" },
            supplierName: { type: "string", description: "Nombre del proveedor" },
            question: { type: "string", description: "Pregunta específica opcional del CEO" },
          },
          required: ["supplierId", "supplierName"],
        },
        execute: async (args) => {
          const supplierId = readString(args.supplierId);
          const supplierName = readString(args.supplierName);
          if (!supplierId || !supplierName) {
            return {
              status: "blocked",
              reason: "supplierId and supplierName are required",
              noMutationExecuted: true,
            };
          }
          try {
            const question = readString(args.question);
            const result = await advisor.analyze({
              supplierId,
              supplierName,
              ...(question !== undefined ? { question } : {}),
            });
            return {
              status: "analyzed",
              ...result,
              noMutationExecuted: true,
              workerSelectionExposed: false,
            };
          } catch (err) {
            return {
              status: "error",
              error: err instanceof Error ? err.message : String(err),
              noMutationExecuted: true,
            };
          }
        },
      }
    : null;

  const queryCortexPatterns: ToolDefinition = {
    name: "query_supplier_cortex_patterns",
    description:
      "Queries Cortex neural graph for supplier items, mappings, and niche patterns via spreading activation. Read-only; no mutations. Requires Cortex to be wired.",
    parameters: {
      type: "object",
      properties: {
        supplierId: { type: "string", description: "Supplier ID to query in Cortex" },
        queryType: {
          type: "string",
          enum: ["items", "mappings", "patterns", "all"],
          description: "Type of query: items, mappings, patterns (spread activation), or all",
        },
        depth: {
          type: "number",
          minimum: 1,
          maximum: 5,
          description: "Max depth for spreading activation (default: 2)",
        },
      },
      required: ["supplierId"],
    },
    execute: (args) => {
      const supplierId = readString(args.supplierId);
      const queryType = readString(args.queryType) ?? "all";
      const depth = readNumber(args.depth) ?? 2;

      if (!supplierId) {
        return Promise.resolve({
          status: "blocked",
          missingInputs: ["supplierId"],
          noMutationExecuted: true,
        });
      }

      if (!engine) {
        return Promise.resolve({
          status: "blocked",
          reason: "Cortex graph engine is not wired. Cannot query supplier patterns.",
          noMutationExecuted: true,
        });
      }

      const results: Record<string, unknown> = {
        supplierId,
        queryType,
        noMutationExecuted: true,
        workerSelectionExposed: false,
      };

      // Query supplier profile node
      if (queryType === "all" || queryType === "items" || queryType === "patterns") {
        const profileNodes = engine.queryByMetadata({
          type: "supplier_profile",
          labelPrefix: `supplier_${supplierId}`,
        });
        results.profileNodes = profileNodes;
      }

      // Query supplier items
      if (queryType === "all" || queryType === "items" || queryType === "patterns") {
        const itemNodes = engine.queryByMetadata({
          type: "supplier_item",
          labelPrefix: `supplier_item_${supplierId}`,
          limit: 20,
        });
        results.itemNodes = itemNodes;
      }

      // Query supplier mappings
      if (queryType === "all" || queryType === "mappings" || queryType === "patterns") {
        const mappingNodes = engine.queryByMetadata({
          type: "supplier_mapping",
          labelPrefix: `supplier_mapping_${supplierId}`,
          limit: 20,
        });
        results.mappingNodes = mappingNodes;
      }

      // Spreading activation to discover niche patterns
      if (queryType === "all" || queryType === "patterns") {
        const supplierNode = engine.db
          .prepare("SELECT id FROM nodes WHERE label = ?")
          .get(`supplier_${supplierId}`) as { id: number } | undefined;

        if (supplierNode) {
          const spreadResult = engine.spreadActivation([supplierNode.id], {
            maxDepth: depth,
            activationThreshold: 0.01,
            decayFactor: 0.5,
          });
          results.spreadActivation = spreadResult;
        }
      }

      return Promise.resolve(results);
    },
  };

  const tools: ToolDefinition[] = [
    reviewReadiness,
    reviewOpportunities,
    reviewNotifications,
    proposePricingPolicy,
    recordFallbackLesson,
    planDeepSeekUsage,
    queryCortexPatterns,
  ];
  if (analyzeEvidence) tools.push(analyzeEvidence);
  return tools;
}
