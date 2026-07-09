import type { GraphEngine } from "@msl/memory";
import type {
  MlAccountRoleConfig,
  MlcListingSummary,
  MlcPricingAutomationHistorySnapshot,
  MlcPricingAutomationRulesSnapshot,
  MlWriteSnapshot,
  NewItem,
  SyncResult,
} from "@msl/mercadolibre";
import { assertPlasticovToMaustianDirection } from "@msl/mercadolibre";
import type { Strategy as SyncStrategy } from "@msl/mercadolibre";



// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type SyncToolOptions = {
  approvedExecution?: boolean;
  accountConfig?: MlAccountRoleConfig;
};

export const DEFAULT_SALE_PRICE_CONTEXT = "channel_marketplace,buyer_loyalty_3";

type OptionalToolRead<T> = { data?: T; error?: { endpoint: string; message: string } };
type PriceIntelligenceEndpointKey =
  "salePrice" | "prices" | "priceToWin" | "automation" | "itemRules" | "productRules" | "history";

type PriceIntelligenceEndpointResult = {
  salePrice: OptionalToolRead<unknown>;
  prices: OptionalToolRead<unknown>;
  priceToWin: OptionalToolRead<unknown>;
  automation: OptionalToolRead<unknown>;
  itemRules: OptionalToolRead<MlcPricingAutomationRulesSnapshot>;
  productRules: OptionalToolRead<MlcPricingAutomationRulesSnapshot>;
  history: OptionalToolRead<MlcPricingAutomationHistorySnapshot>;
};

type PriceIntelligenceEndpointSpec<K extends PriceIntelligenceEndpointKey> = {  // eslint-disable-line @typescript-eslint/no-unused-vars
  key: K;
  read: () => Promise<PriceIntelligenceEndpointResult[K]>;
};

// ---------------------------------------------------------------------------
// Approval gating
// ---------------------------------------------------------------------------

export function approvalRequired(
  tool: "sync_product" | "sync_all" | "create_listing",
): Record<string, unknown> {
  return {
    status: "approval_required",
    tool,
    error:
      "Direct LLM sync execution is blocked. Prepare an approval-required proposal and execute only through the explicit approved sync path.",
  };
}

// ---------------------------------------------------------------------------
// Direction validation
// ---------------------------------------------------------------------------

export function validateSyncDirection(
  sourceSellerId: string,
  targetSellerId: string,
  options?: SyncToolOptions,
): Record<string, unknown> | undefined {
  try {
    if (options?.accountConfig) {
      assertPlasticovToMaustianDirection(sourceSellerId, targetSellerId, {
        MERCADOLIBRE_SOURCE_SELLER_ID: options.accountConfig.sourceSellerId,
        MERCADOLIBRE_TARGET_SELLER_ID: options.accountConfig.targetSellerId,
      });
    } else {
      assertPlasticovToMaustianDirection(sourceSellerId, targetSellerId);
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

export function coerceStrategies(raw: unknown): SyncStrategy[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is SyncStrategy =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as Record<string, unknown>).type === "string",
  );
}

export function coerceSellerId(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export function coerceItemId(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export function coercePromotionId(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export function coercePromotionType(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export function metadataString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function isMlcListingSummary(value: unknown): value is MlcListingSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

// ---------------------------------------------------------------------------
// Cortex integration helpers
// ---------------------------------------------------------------------------

export function storeSyncOutcome(
  cortex: GraphEngine,
  result: SyncResult,
  sourceSellerId: string,
  targetSellerId: string,
): void {
  const sourceNode = ensureSellerNode(cortex, sourceSellerId);
  const targetNode = ensureSellerNode(cortex, targetSellerId);

  const outcomeNode = cortex.createNode(
    `sync_${result.itemId}_${new Date().toISOString().slice(0, 10)}`,
    {
      type: "sync_outcome",
      itemId: result.itemId,
      status: result.status,
      sourcePrice: result.sourcePrice,
      targetPrice: result.targetPrice,
      margin: result.margin,
      error: result.error ?? null,
      sourceSeller: sourceSellerId,
      targetSeller: targetSellerId,
    },
  );

  ensureEdge(cortex, outcomeNode.id, targetNode.id);
  ensureEdge(cortex, outcomeNode.id, sourceNode.id);

  if (result.status === "published") {
    try {
      cortex.reinforceEdge(outcomeNode.id, targetNode.id);
      cortex.reinforceEdge(outcomeNode.id, sourceNode.id);
    } catch {
      // Edge might not exist yet — it is created above so this is defensive.
    }
  } else if (result.status === "failed") {
    try {
      cortex.penalizeEdge(outcomeNode.id, targetNode.id);
    } catch {
      // Defensive — edge creation above should prevent this.
    }
  }
}

export function ensureSellerNode(
  cortex: GraphEngine,
  sellerId: string,
): { id: number; label: string } {
  const existing = cortex.db
    .prepare("SELECT id, label FROM nodes WHERE metadata LIKE ?")
    .get(`%"sellerId":"${sellerId}"%`) as { id: number; label: string } | undefined;

  if (existing) return existing;

  const node = cortex.createNode(`seller_${sellerId}`, {
    type: "seller_account",
    sellerId,
  });
  return { id: node.id, label: node.label };
}

export function ensureEdge(cortex: GraphEngine, source: number, target: number): void {
  try {
    cortex.createEdge(source, target);
  } catch {
    // Edge already exists — idempotent, nothing to do.
  }
}

export function storeCreateOutcome(
  cortex: GraphEngine,
  result: MlWriteSnapshot,
  sellerId: string,
  item: NewItem,
): void {
  const sellerNode = cortex.db
    .prepare("SELECT id, label FROM nodes WHERE metadata LIKE ?")
    .get(`%"sellerId":"${sellerId}"%`) as { id: number; label: string } | undefined;

  const sourceId =
    sellerNode?.id ??
    cortex.createNode(`seller_${sellerId}`, {
      type: "seller_account",
      sellerId,
    }).id;

  const outcomeNode = cortex.createNode(
    `create_${result.id}_${new Date().toISOString().slice(0, 10)}`,
    {
      type: "listing_created",
      itemId: result.id,
      permalink: result.permalink,
      title: item.title,
      price: item.price,
      variationCount: item.variations?.length ?? 0,
      sellerId,
    },
  );

  try {
    cortex.createEdge(outcomeNode.id, sourceId);
    cortex.reinforceEdge(outcomeNode.id, sourceId);
  } catch {
    // Edge may already exist — idempotent
  }
}
