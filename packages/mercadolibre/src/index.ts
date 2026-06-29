import {
  evaluateFreshness,
  isMlcCategoryId,
  isMlcDomainId,
  type CacheFreshness,
  type ReadSnapshot,
} from "@msl/domain";
import type { OAuthManager } from "./oauth/oauthManager.js";
import type {
  MlCategory,
  MlCategoriesSnapshot,
  MlItem,
  MlUserInfo,
  MlUserSnapshot,
  MlWriteSnapshot,
  NewItem,
} from "./types.js";

export type OAuthAccessStatus = "connected" | "revoked" | "expired";

export type MlcReadSnapshotKind = ReadSnapshot<unknown>["kind"];

export type MlcReadSnapshotCompleteness = ReadSnapshot<unknown>["completeness"];

export type MlcReadSnapshotConfidence = ReadSnapshot<unknown>["confidence"];

export type MlcReadSnapshotFreshness = CacheFreshness & {
  source: "mercadolibre-api";
  signalKind: MlcReadSnapshotKind;
  risk: "medium" | "critical";
};

export type MlcReadSnapshot<TData> = ReadSnapshot<TData> & {
  kind: MlcReadSnapshotKind;
  source: "mercadolibre-api";
  freshness: MlcReadSnapshotFreshness;
};

export type MlcListingSummary = {
  id: string;
  title?: string;
  status?: string;
  availableQuantity?: number;
  price?: number;
  currencyId?: string;
  permalink?: string;
};

export type MlcOrderSummary = {
  id: string;
  status?: string;
  totalAmount?: number;
  currencyId?: string;
  createdAt?: string;
  buyerId?: string;
};

export type MlcMessageSummary = {
  id: string;
  subject?: string;
  status?: string;
  createdAt?: string;
  fromUserId?: string;
};

export type MlcReputationSummary = {
  level?: string;
  powerSellerStatus?: string;
  completedTransactions?: number;
  canceledTransactions?: number;
  totalTransactions?: number;
  positiveRating?: number;
  neutralRating?: number;
  negativeRating?: number;
  claimsRate?: number;
  cancellationsRate?: number;
  delayedHandlingTimeRate?: number;
  metricPeriodDays?: 60 | 365;
};

const MLC_REPUTATION_RULES = {
  establishedSellerCompletedTransactions: 40,
  establishedSellerMetricPeriodDays: 60,
  newSellerMetricPeriodDays: 365,
} as const;

const MLC_CONFIRMED_SITE_SUPPORT = "MLC-confirmed" as const;

export type MlcCategoryAttributeSummary = {
  id: string;
  name?: string;
  valueType?: string;
  required: boolean;
  catalogRequired: boolean;
  variationAttribute: boolean;
  readOnly: boolean;
  values: ReadonlyArray<{ id?: string; name?: string }>;
  units: ReadonlyArray<string>;
};

export type MlcCategoryTechnicalSpecSummary = {
  id: string;
  name?: string;
  valueType?: string;
  required: boolean;
  catalogRequired: boolean;
  group?: string;
};

export type MlcListingsSnapshot = MlcReadSnapshot<MlcListingSummary>;
export type MlcOrdersSnapshot = MlcReadSnapshot<MlcOrderSummary>;
export type MlcMessagesSnapshot = MlcReadSnapshot<MlcMessageSummary>;
export type MlcReputationSnapshot = MlcReadSnapshot<MlcReputationSummary>;
export type MlcCategoryAttributesSnapshot = MlcReadSnapshot<MlcCategoryAttributeSummary>;
export type MlcCategoryTechnicalSpecsSnapshot = MlcReadSnapshot<MlcCategoryTechnicalSpecSummary>;

export type OAuthTokenState = {
  sellerId: string;
  site: "MLC";
  accessToken: string;
  refreshToken?: string;
  scopes: ReadonlyArray<string>;
  status: OAuthAccessStatus;
  connectedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
};

export type ReconnectRequired = {
  allowed: false;
  reason: "reconnect-required";
  status: Exclude<OAuthAccessStatus, "connected">;
  message: "MercadoLibre access is not available. Ask the seller to reconnect.";
};

export type SellerAccessMismatch = {
  allowed: false;
  reason: "seller-access-mismatch";
  sellerId: string;
  connectedSellerId: string;
  message: "Requested seller does not match the connected MercadoLibre account.";
};

export type UsableAccess = {
  allowed: true;
  sellerId: string;
  site: "MLC";
  accessToken: string;
};

export type AccessEvaluation = UsableAccess | ReconnectRequired;

export type MercadoLibreApiRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  accessToken: string;
  query?: Readonly<Record<string, string>>;
  body?: unknown;
};

export type MercadoLibreApiTransport = {
  request(request: MercadoLibreApiRequest): Promise<unknown>;
};

export type OAuthSellerAuthorizationFailure = {
  allowed: false;
  reason: "seller-not-configured";
  sellerId: string;
  message: "Requested seller is not configured as an allowed MercadoLibre account role for MSL.";
};

export type MlcCategoryIdentifierFailure = {
  allowed: false;
  reason: "unsupported-category-id" | "unsupported-domain-id";
  identifier: string;
  message: string;
  siteSupport: "unknown";
};

export type MlcApiClient = {
  getListings(sellerId: string): Promise<MlcListingsSnapshot>;
  getItem(sellerId: string, itemId: string): Promise<MlItem>;
  getOrders(sellerId: string): Promise<MlcOrdersSnapshot>;
  getMessages(sellerId: string): Promise<MlcMessagesSnapshot>;
  getReputation(sellerId: string): Promise<MlcReputationSnapshot>;
  getCategoryAttributes(
    sellerId: string,
    categoryId: string,
  ): Promise<MlcCategoryAttributesSnapshot>;
  getCategoryTechnicalSpecs(
    sellerId: string,
    domainId: string,
  ): Promise<MlcCategoryTechnicalSpecsSnapshot>;
};

type MlcReadRequest = (
  sellerId: string,
  path: string,
  query?: Readonly<Record<string, string>>,
) => Promise<unknown>;

type MlcReadEndpoint<TSnapshot> = {
  path(sellerId: string): string;
  query(sellerId: string): Readonly<Record<string, string>>;
  normalize(input: { sellerId: string; payload: unknown; now: Date }): TSnapshot;
};

// --- Re-exports from types.ts ---
export type {
  MlCategory,
  MlCategoriesSnapshot,
  MlItem,
  MlOrder,
  MlQuestion,
  MlUserInfo,
  MlUserSnapshot,
  MlWriteSnapshot,
  NewItem,
  OAuthTokens,
  StoredToken,
} from "./types.js";

export type { OAuthManager, OAuthManagerConfig } from "./oauth/oauthManager.js";

export type { TokenStore } from "./oauth/tokenStore.js";

export { createOAuthManager } from "./oauth/oauthManager.js";

export { createTokenStore } from "./oauth/tokenStore.js";

export {
  assertOAuthAccountMatchesRole,
  assertPlasticovToMaustianDirection,
  getMlAccountRoleConfig,
  type MlAccountRole,
  type MlAccountRoleConfig,
} from "./accountRoles.js";

// ---------------------------------------------------------------------------
// Sync engine exports
// ---------------------------------------------------------------------------

export {
  createProductSyncEngine,
  type ProductSyncEngine,
  type SyncResult,
  type SyncReport,
  type SyncOptions,
  type ConcurrentSyncOptions,
  type SyncJob,
} from "./sync/syncEngine.js";

export {
  applyStrategies,
  previewStrategyChanges,
  type Strategy,
  type MarginStrategy,
  type CategoryFilterStrategy,
  type StockStrategy,
  type PricingRuleStrategy,
  type StrategyApplicationResult,
  type StrategyPreviewResult,
} from "./sync/strategyApplier.js";

export {
  diffListings,
  isOutOfSync as isListingOutOfSync,
  type DiffResult,
} from "./sync/diffEngine.js";

export {
  createSyncStore,
  type SyncStore,
  type SyncState,
  type SyncStatus,
  type MarkSyncedInput,
  type SyncEntry,
} from "./sync/syncStore.js";

function createFreshness(kind: MlcReadSnapshotKind, now: Date): MlcReadSnapshotFreshness {
  return evaluateFreshness({
    source: "mercadolibre-api",
    signalKind: kind,
    capturedAt: now,
    now,
  }) as MlcReadSnapshotFreshness;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Readonly<Record<string, unknown>>;
}

function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function pushOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function snapshotConfidence(
  completeness: MlcReadSnapshotCompleteness,
  count: number,
): MlcReadSnapshotConfidence {
  if (completeness === "partial") {
    return "low";
  }

  return count > 0 ? "high" : "medium";
}

function sellerScope(sellerId: string): { sellerId: string; site: "MLC" } {
  return { sellerId, site: "MLC" };
}

function assertMlcCategoryId(categoryId: string): void {
  if (!isMlcCategoryId(categoryId)) {
    const failure: MlcCategoryIdentifierFailure = {
      allowed: false,
      reason: "unsupported-category-id",
      identifier: categoryId,
      message: "Only MLC-confirmed category IDs are supported for category attribute reads.",
      siteSupport: "unknown",
    };
    throw Object.assign(new Error(failure.message), failure);
  }
}

export function normalizeMlcItemId(itemId: string): string | null {
  const trimmed = itemId.trim();
  return /^MLC\d+$/.test(trimmed) ? trimmed : null;
}

function assertMlcItemId(itemId: string): string {
  const normalized = normalizeMlcItemId(itemId);
  if (!normalized) {
    throw new Error("Only MLC item IDs are supported for item reads.");
  }

  return normalized;
}

function assertMlcDomainId(domainId: string): void {
  if (!isMlcDomainId(domainId)) {
    const failure: MlcCategoryIdentifierFailure = {
      allowed: false,
      reason: "unsupported-domain-id",
      identifier: domainId,
      message: "Only MLC-confirmed domain IDs are supported for category technical spec reads.",
      siteSupport: "unknown",
    };
    throw Object.assign(new Error(failure.message), failure);
  }
}

function normalizeListings(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcListingsSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results ?? root?.items);
  let complete = root !== undefined && Array.isArray(root.results ?? root.items);

  const data = results.flatMap((item): MlcListingSummary[] => {
    if (typeof item === "string") {
      complete = false;
      return [{ id: item }];
    }

    const record = asRecord(item);
    const id = stringValue(record?.id);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }

    const summary: MlcListingSummary = { id };
    pushOptional(summary, "title", stringValue(record.title));
    pushOptional(summary, "status", stringValue(record.status));
    pushOptional(summary, "availableQuantity", numberValue(record.available_quantity));
    pushOptional(summary, "price", numberValue(record.price));
    pushOptional(summary, "currencyId", stringValue(record.currency_id));
    pushOptional(summary, "permalink", stringValue(record.permalink));

    if (summary.title === undefined || summary.status === undefined) {
      complete = false;
    }

    return [summary];
  });

  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, data.length),
  };
}

function normalizeItem(payload: unknown): MlItem {
  const record = asRecord(payload);
  const id = stringValue(record?.id);
  const title = stringValue(record?.title);
  const price = numberValue(record?.price);
  const available_quantity = numberValue(record?.available_quantity);
  const category_id = stringValue(record?.category_id);
  const seller_id = numberValue(record?.seller_id);
  const status = stringValue(record?.status);

  if (
    !record ||
    !id ||
    !normalizeMlcItemId(id) ||
    !title ||
    price === undefined ||
    available_quantity === undefined ||
    !category_id ||
    seller_id === undefined ||
    (status !== "active" && status !== "paused" && status !== "closed")
  ) {
    throw new Error("Incomplete MercadoLibre item payload.");
  }

  return {
    id,
    title,
    price,
    available_quantity,
    category_id,
    seller_id,
    status,
    pictures: asArray(record?.pictures).flatMap((picture) => {
      const url = stringValue(asRecord(picture)?.url);
      return url === undefined ? [] : [{ url }];
    }),
    attributes: asArray(record?.attributes).flatMap((attribute) => {
      const attributeRecord = asRecord(attribute);
      const attributeId = stringValue(attributeRecord?.id);
      if (attributeId === undefined) return [];
      return [{ id: attributeId, value_name: stringValue(attributeRecord?.value_name) ?? "" }];
    }),
  };
}

function normalizeOrders(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcOrdersSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results ?? root?.orders);
  let complete = root !== undefined && Array.isArray(root.results ?? root.orders);

  const data = results.flatMap((item): MlcOrderSummary[] => {
    const record = asRecord(item);
    const id =
      stringValue(record?.id) ??
      (numberValue(record?.id) !== undefined ? String(record?.id) : undefined);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }

    const buyer = asRecord(record.buyer);
    const buyerId =
      stringValue(buyer?.id) ??
      (numberValue(buyer?.id) !== undefined ? String(buyer?.id) : undefined);
    const summary: MlcOrderSummary = { id };
    pushOptional(summary, "status", stringValue(record.status));
    pushOptional(summary, "totalAmount", numberValue(record.total_amount));
    pushOptional(summary, "currencyId", stringValue(record.currency_id));
    pushOptional(summary, "createdAt", stringValue(record.date_created));
    pushOptional(summary, "buyerId", buyerId);

    if (summary.status === undefined || summary.totalAmount === undefined) {
      complete = false;
    }

    return [summary];
  });

  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "order",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("order", input.now),
    confidence: snapshotConfidence(completeness, data.length),
  };
}

function normalizeMessages(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcMessagesSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results ?? root?.messages);
  let complete = root !== undefined && Array.isArray(root.results ?? root.messages);

  const data = results.flatMap((item): MlcMessageSummary[] => {
    const record = asRecord(item);
    const id = stringValue(record?.id);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }

    const from = asRecord(record.from);
    const fromUserId =
      stringValue(from?.user_id) ??
      stringValue(from?.id) ??
      (numberValue(from?.user_id) !== undefined ? String(from?.user_id) : undefined) ??
      (numberValue(from?.id) !== undefined ? String(from?.id) : undefined);
    const summary: MlcMessageSummary = { id };
    pushOptional(summary, "subject", stringValue(record.subject) ?? stringValue(record.text));
    pushOptional(summary, "status", stringValue(record.status));
    pushOptional(summary, "createdAt", stringValue(record.date_created));
    pushOptional(summary, "fromUserId", fromUserId);

    if (summary.subject === undefined && summary.status === undefined) {
      complete = false;
    }

    return [summary];
  });

  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "message",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("message", input.now),
    confidence: snapshotConfidence(completeness, data.length),
  };
}

function normalizeReputation(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcReputationSnapshot {
  const root = asRecord(input.payload);
  const reputation = asRecord(root?.seller_reputation);
  const transactions = asRecord(reputation?.transactions);
  const ratings = asRecord(transactions?.ratings);
  const data: MlcReputationSummary = {};

  pushOptional(data, "level", stringValue(reputation?.level_id));
  pushOptional(data, "powerSellerStatus", stringValue(reputation?.power_seller_status));
  pushOptional(data, "completedTransactions", numberValue(transactions?.completed));
  pushOptional(data, "canceledTransactions", numberValue(transactions?.canceled));
  pushOptional(data, "totalTransactions", numberValue(transactions?.total));
  pushOptional(data, "positiveRating", numberValue(ratings?.positive));
  pushOptional(data, "neutralRating", numberValue(ratings?.neutral));
  pushOptional(data, "negativeRating", numberValue(ratings?.negative));

  const metrics = asRecord(reputation?.metrics);
  const claims = asRecord(metrics?.claims);
  const cancellations = asRecord(metrics?.cancellations);
  const delayedHandlingTime = asRecord(metrics?.delayed_handling_time);
  pushOptional(data, "claimsRate", numberValue(claims?.rate));
  pushOptional(data, "cancellationsRate", numberValue(cancellations?.rate));
  pushOptional(data, "delayedHandlingTimeRate", numberValue(delayedHandlingTime?.rate));
  if (data.completedTransactions !== undefined) {
    data.metricPeriodDays =
      data.completedTransactions >= MLC_REPUTATION_RULES.establishedSellerCompletedTransactions
        ? MLC_REPUTATION_RULES.establishedSellerMetricPeriodDays
        : MLC_REPUTATION_RULES.newSellerMetricPeriodDays;
  }

  const completeness =
    root !== undefined &&
    reputation !== undefined &&
    transactions !== undefined &&
    data.level !== undefined
      ? "complete"
      : "partial";

  return {
    sellerId: input.sellerId,
    kind: "reputation",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("reputation", input.now),
    confidence: snapshotConfidence(completeness, Object.keys(data).length),
    siteSupport: MLC_CONFIRMED_SITE_SUPPORT,
    sellerScope: sellerScope(input.sellerId),
  };
}

function attributeTags(
  record: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return asRecord(record.tags) ?? {};
}

function normalizeAttribute(
  record: Readonly<Record<string, unknown>>,
): MlcCategoryAttributeSummary | undefined {
  const id = stringValue(record.id);
  if (id === undefined) return undefined;

  const tags = attributeTags(record);
  const attribute: MlcCategoryAttributeSummary = {
    id,
    required: booleanValue(tags.required) ?? false,
    catalogRequired:
      booleanValue(tags.catalog_required) ?? booleanValue(tags.catalog_listing_required) ?? false,
    variationAttribute:
      booleanValue(tags.variation_attribute) ?? booleanValue(tags.allow_variations) ?? false,
    readOnly: booleanValue(tags.read_only) ?? false,
    values: asArray(record.values).flatMap((value) => {
      const valueRecord = asRecord(value);
      if (valueRecord === undefined) return [];
      const normalizedValue: { id?: string; name?: string } = {};
      pushOptional(normalizedValue, "id", stringValue(valueRecord.id));
      pushOptional(normalizedValue, "name", stringValue(valueRecord.name));
      return [normalizedValue];
    }),
    units: asArray(record.allowed_units ?? record.default_unit).flatMap((unit) => {
      const unitRecord = asRecord(unit);
      const name = stringValue(unitRecord?.name) ?? stringValue(unit);
      return name === undefined ? [] : [name];
    }),
  };
  pushOptional(attribute, "name", stringValue(record.name));
  pushOptional(attribute, "valueType", stringValue(record.value_type));

  return attribute;
}

function normalizeCategoryAttributes(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcCategoryAttributesSnapshot {
  const data = asArray(input.payload).flatMap((item): MlcCategoryAttributeSummary[] => {
    const record = asRecord(item);
    const attribute = record === undefined ? undefined : normalizeAttribute(record);
    return attribute === undefined ? [] : [attribute];
  });
  const completeness = Array.isArray(input.payload) ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "category-attributes",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("category-attributes", input.now),
    confidence: snapshotConfidence(completeness, data.length),
    siteSupport: MLC_CONFIRMED_SITE_SUPPORT,
    sellerScope: sellerScope(input.sellerId),
  };
}

function extractTechnicalSpecAttributes(payload: unknown): {
  attributes: ReadonlyArray<unknown>;
  validShape: boolean;
} {
  const root = asRecord(payload);
  const rawGroups = root?.groups ?? asRecord(root?.input)?.groups;

  if (!Array.isArray(rawGroups)) {
    return { attributes: [], validShape: false };
  }

  const attributes = rawGroups.flatMap((group) => {
    const groupRecord = asRecord(group);
    const components = asArray(groupRecord?.components);
    return components.flatMap((component) => {
      const componentRecord = asRecord(component);
      return asArray(componentRecord?.attributes);
    });
  });

  return { attributes, validShape: true };
}

function normalizeCategoryTechnicalSpecs(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcCategoryTechnicalSpecsSnapshot {
  const extracted = extractTechnicalSpecAttributes(input.payload);
  const data = extracted.attributes.flatMap((item): MlcCategoryTechnicalSpecSummary[] => {
    const record = asRecord(item);
    if (record === undefined) return [];
    const attribute = normalizeAttribute(record);
    if (attribute === undefined) return [];
    const spec: MlcCategoryTechnicalSpecSummary = {
      id: attribute.id,
      required: attribute.required,
      catalogRequired: attribute.catalogRequired,
    };
    pushOptional(spec, "name", attribute.name);
    pushOptional(spec, "valueType", attribute.valueType);
    pushOptional(spec, "group", stringValue(record.hierarchy));
    return [spec];
  });
  const completeness = extracted.validShape ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "category-technical-specs",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("category-technical-specs", input.now),
    confidence: snapshotConfidence(completeness, data.length),
    siteSupport: MLC_CONFIRMED_SITE_SUPPORT,
    sellerScope: sellerScope(input.sellerId),
  };
}

const MLC_READ_ENDPOINTS = {
  listings: {
    path: (sellerId: string) => `/users/${sellerId}/items/search`,
    query: () => ({ site: "MLC" }),
    normalize: normalizeListings,
  },
  orders: {
    path: () => "/orders/search",
    query: (sellerId: string) => ({ seller: sellerId, site: "MLC" }),
    normalize: normalizeOrders,
  },
  messages: {
    path: () => "/messages/search",
    query: (sellerId: string) => ({ seller: sellerId, site: "MLC" }),
    normalize: normalizeMessages,
  },
  reputation: {
    path: (sellerId: string) => `/users/${sellerId}`,
    query: () => ({ site: "MLC" }),
    normalize: normalizeReputation,
  },
} satisfies Record<string, MlcReadEndpoint<unknown>>;

async function readMlcSnapshot<TSnapshot>(input: {
  sellerId: string;
  endpoint: MlcReadEndpoint<TSnapshot>;
  request: MlcReadRequest;
  now: Date;
}): Promise<TSnapshot> {
  const payload = await input.request(
    input.sellerId,
    input.endpoint.path(input.sellerId),
    input.endpoint.query(input.sellerId),
  );

  return input.endpoint.normalize({ sellerId: input.sellerId, payload, now: input.now });
}

function createMlcReadMethods(input: { request: MlcReadRequest; now(): Date }): MlcApiClient {
  return {
    getListings: (sellerId) =>
      readMlcSnapshot({
        sellerId,
        endpoint: MLC_READ_ENDPOINTS.listings,
        request: input.request,
        now: input.now(),
      }),
    getItem: async (sellerId, itemId) => {
      const safeItemId = assertMlcItemId(itemId);
      const payload = await input.request(sellerId, `/items/${safeItemId}`);
      return normalizeItem(payload);
    },
    getOrders: (sellerId) =>
      readMlcSnapshot({
        sellerId,
        endpoint: MLC_READ_ENDPOINTS.orders,
        request: input.request,
        now: input.now(),
      }),
    getMessages: (sellerId) =>
      readMlcSnapshot({
        sellerId,
        endpoint: MLC_READ_ENDPOINTS.messages,
        request: input.request,
        now: input.now(),
      }),
    getReputation: (sellerId) =>
      readMlcSnapshot({
        sellerId,
        endpoint: MLC_READ_ENDPOINTS.reputation,
        request: input.request,
        now: input.now(),
      }),
    getCategoryAttributes: async (sellerId, categoryId) => {
      assertMlcCategoryId(categoryId);
      const payload = await input.request(sellerId, `/categories/${categoryId}/attributes`);
      return normalizeCategoryAttributes({ sellerId, payload, now: input.now() });
    },
    getCategoryTechnicalSpecs: async (sellerId, domainId) => {
      assertMlcDomainId(domainId);
      const payload = await input.request(sellerId, `/domains/${domainId}/technical_specs`);
      return normalizeCategoryTechnicalSpecs({ sellerId, payload, now: input.now() });
    },
  };
}

export function evaluateOAuthAccess(state: OAuthTokenState, now: Date): AccessEvaluation {
  if (state.status === "revoked" || state.status === "expired" || state.expiresAt <= now) {
    return {
      allowed: false,
      reason: "reconnect-required",
      status: state.status === "connected" ? "expired" : state.status,
      message: "MercadoLibre access is not available. Ask the seller to reconnect.",
    };
  }

  return {
    allowed: true,
    sellerId: state.sellerId,
    site: state.site,
    accessToken: state.accessToken,
  };
}

export function createMlcApiClient(input: {
  tokenState: OAuthTokenState;
  transport: MercadoLibreApiTransport;
  now: Date;
}): MlcApiClient {
  const request = async (
    sellerId: string,
    path: string,
    query?: Readonly<Record<string, string>>,
  ) => {
    const access = evaluateOAuthAccess(input.tokenState, input.now);

    if (!access.allowed) {
      throw Object.assign(new Error(access.message), access);
    }

    if (sellerId !== access.sellerId) {
      const mismatch: SellerAccessMismatch = {
        allowed: false,
        reason: "seller-access-mismatch",
        sellerId,
        connectedSellerId: access.sellerId,
        message: "Requested seller does not match the connected MercadoLibre account.",
      };
      throw Object.assign(new Error(mismatch.message), mismatch);
    }

    const apiRequest: MercadoLibreApiRequest = {
      method: "GET",
      path,
      accessToken: access.accessToken,
    };

    if (query !== undefined) {
      apiRequest.query = query;
    }

    return input.transport.request(apiRequest);
  };

  return createMlcReadMethods({ request, now: () => input.now });
}

export function createOAuthMlcApiClient(input: {
  oauthManager: OAuthManager;
  transport: MercadoLibreApiTransport;
  now(): Date;
  allowedSellerIds: ReadonlyArray<string>;
}): MlcApiClient {
  const allowedSellerIds = new Set(
    input.allowedSellerIds.map((sellerId) => sellerId.trim()).filter(Boolean),
  );

  if (allowedSellerIds.size === 0) {
    const failure: OAuthSellerAuthorizationFailure = {
      allowed: false,
      reason: "seller-not-configured",
      sellerId: "",
      message:
        "Requested seller is not configured as an allowed MercadoLibre account role for MSL.",
    };
    throw Object.assign(new Error(failure.message), failure);
  }

  const request = async (
    sellerId: string,
    path: string,
    query?: Readonly<Record<string, string>>,
  ) => {
    if (!allowedSellerIds.has(sellerId)) {
      const failure: OAuthSellerAuthorizationFailure = {
        allowed: false,
        reason: "seller-not-configured",
        sellerId,
        message:
          "Requested seller is not configured as an allowed MercadoLibre account role for MSL.",
      };
      throw Object.assign(new Error(failure.message), failure);
    }

    const accessToken = await input.oauthManager.ensureValidToken(sellerId);
    const apiRequest: MercadoLibreApiRequest = { method: "GET", path, accessToken };

    if (query !== undefined) {
      apiRequest.query = query;
    }

    return input.transport.request(apiRequest);
  };

  return createMlcReadMethods({ request, now: () => input.now() });
}

// ---------------------------------------------------------------------------
// Real fetch-based HTTP transport with exponential backoff
// ---------------------------------------------------------------------------

const ML_API_BASE = "https://api.mercadolibre.com";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;
const MAX_DELAY_MS = 30_000;

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Fetch with exponential backoff + jitter for ML API rate limiting.
 *
 * Retries on HTTP 429 (rate-limited) and 5xx (server errors), with
 * capped exponential delay plus uniform random jitter to avoid
 * thundering-herd retry storms.  Network errors (connection refused,
 * DNS failure) are also retried.
 */
async function fetchWithBackoff(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 100, 200, 400, 800 ms capped at 30 s
      // plus uniform jitter of ±50 % to prevent synchronised retries.
      const base = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
      const jitter = base * 0.5 * Math.random(); // ±50 %
      const delay = Math.round(base + jitter);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      const response = await fetch(url, init);

      if (!shouldRetry(response.status) || attempt === MAX_RETRIES) {
        return response;
      }

      // Will retry on 429 or 5xx
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES) throw err;
    }
  }

  throw lastError;
}

export function createMercadoLibreApiFetchTransport(): MercadoLibreApiTransport {
  return {
    async request(request) {
      let url = `${ML_API_BASE}${request.path}`;
      if (request.query && Object.keys(request.query).length > 0) {
        url = `${url}?${new URLSearchParams(request.query).toString()}`;
      }

      const response = await fetchWithBackoff(url, {
        method: request.method,
        headers: { Authorization: `Bearer ${request.accessToken}` },
      });

      if (!response.ok) {
        throw new Error(
          `ML API ${request.method} ${request.path} failed: ${response.status} ${response.statusText}`,
        );
      }

      return response.json();
    },
  };
}

// ---------------------------------------------------------------------------
// New normalization functions for write operations, categories, user info
// ---------------------------------------------------------------------------

function normalizeItems(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcListingsSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results ?? root?.items);
  let complete = root !== undefined && Array.isArray(root?.results ?? root?.items);

  const data = results.flatMap((item): MlcListingSummary[] => {
    if (typeof item === "string") {
      complete = false;
      return [{ id: item }];
    }

    const record = asRecord(item);
    const id = stringValue(record?.id);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }

    const summary: MlcListingSummary = { id };
    pushOptional(summary, "title", stringValue(record.title));
    pushOptional(summary, "status", stringValue(record.status));
    pushOptional(summary, "availableQuantity", numberValue(record.available_quantity));
    pushOptional(summary, "price", numberValue(record.price));
    pushOptional(summary, "currencyId", stringValue(record.currency_id));
    pushOptional(summary, "permalink", stringValue(record.permalink));

    return [summary];
  });

  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, data.length),
  };
}

function normalizeWriteResponse(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlWriteSnapshot {
  const record = asRecord(input.payload);
  const id = stringValue(record?.id) ?? "unknown";
  const permalink = stringValue(record?.permalink) ?? "";
  const status = stringValue(record?.status) ?? "active";

  return {
    id,
    permalink,
    status,
    capturedAt: input.now.toISOString(),
  };
}

function normalizeCategories(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlCategoriesSnapshot {
  const data: MlCategory[] = [];

  if (Array.isArray(input.payload)) {
    for (const item of input.payload) {
      const record = asRecord(item);
      if (!record) continue;

      const id = stringValue(record.id);
      if (!id) continue;

      const category: MlCategory = {
        id,
        name: stringValue(record.name) ?? "",
      };

      const pathFromRoot = asArray(record.path_from_root);
      if (pathFromRoot.length > 0) {
        category.path_from_root = pathFromRoot.flatMap((p) => {
          const pr = asRecord(p);
          const pid = stringValue(pr?.id);
          if (!pr || !pid) return [];
          return [{ id: pid, name: stringValue(pr.name) ?? "" }];
        });
      }

      const children = asArray(record.children_categories);
      if (children.length > 0) {
        category.children_categories = children.flatMap((c) => {
          const cr = asRecord(c);
          const cid = stringValue(cr?.id);
          if (!cr || !cid) return [];
          return [{ id: cid, name: stringValue(cr.name) ?? "" }];
        });
      }

      data.push(category);
    }
  }

  return {
    sellerId: input.sellerId,
    data,
    capturedAt: input.now.toISOString(),
  };
}

function normalizeUser(input: { sellerId: string; payload: unknown; now: Date }): MlUserSnapshot {
  const record = asRecord(input.payload);
  const data: MlUserInfo = {
    id: numberValue(record?.id) ?? 0,
    nickname: stringValue(record?.nickname) ?? "",
    points: numberValue(record?.points) ?? 0,
    level: stringValue(record?.level_id) ?? stringValue(record?.seller_experience) ?? "",
    status: stringValue(asRecord(record?.status)?.site_status) ?? "",
  };

  return {
    sellerId: input.sellerId,
    data,
    capturedAt: input.now.toISOString(),
  };
}

function normalizeQuestions(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcMessagesSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results ?? root?.questions);
  let complete = root !== undefined && Array.isArray(root?.results ?? root?.questions);

  const data = results.flatMap((item): MlcMessageSummary[] => {
    const record = asRecord(item);
    const id = stringValue(record?.id);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }

    const from = asRecord(record.from);
    const fromUserId =
      stringValue(from?.user_id) ??
      stringValue(from?.id) ??
      (numberValue(from?.user_id) !== undefined ? String(from?.user_id) : undefined) ??
      (numberValue(from?.id) !== undefined ? String(from?.id) : undefined);
    const summary: MlcMessageSummary = { id };
    pushOptional(summary, "subject", stringValue(record.text) ?? stringValue(record.subject));
    pushOptional(summary, "status", stringValue(record.status));
    pushOptional(summary, "createdAt", stringValue(record.date_created));
    pushOptional(summary, "fromUserId", fromUserId);

    return [summary];
  });

  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "message",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("message", input.now),
    confidence: snapshotConfidence(completeness, data.length),
  };
}

// ---------------------------------------------------------------------------
// Mock data helpers for stub mode
// ---------------------------------------------------------------------------

const MOCK_LISTINGS_PAYLOAD = {
  results: [
    {
      id: "MLC1001",
      title: "Producto de prueba",
      status: "active",
      available_quantity: 10,
      price: 15000,
      currency_id: "CLP",
      permalink: "https://articulo.mercadolibre.cl/MLC1001",
    },
    {
      id: "MLC1002",
      title: "Artículo demo",
      status: "active",
      available_quantity: 5,
      price: 25000,
      currency_id: "CLP",
      permalink: "https://articulo.mercadolibre.cl/MLC1002",
    },
  ],
};

const MOCK_ORDERS_PAYLOAD = {
  results: [
    {
      id: "ORDER-1",
      status: "paid",
      total_amount: 12000,
      currency_id: "CLP",
      date_created: "2026-06-25T12:00:00Z",
      buyer: { id: 501 },
    },
  ],
};

const MOCK_QUESTIONS_PAYLOAD = {
  questions: [
    {
      id: "Q-1",
      text: "¿Tiene stock disponible?",
      status: "UNANSWERED",
      date_created: "2026-06-25T10:00:00Z",
      item_id: "MLC1001",
      from: { id: 501 },
    },
  ],
};

const MOCK_CATEGORIES_PAYLOAD = [
  { id: "MLC1000", name: "Electrónica" },
  { id: "MLC2000", name: "Ropa y Accesorios" },
];

const MOCK_USER_PAYLOAD = {
  id: 12345,
  nickname: "TESTSELLER",
  points: 100,
  seller_experience: "Novato",
  status: { site_status: "active" },
};

const MOCK_ITEM_PAYLOAD = {
  id: "MLC1001",
  title: "Producto de prueba",
  price: 15000,
  available_quantity: 10,
  category_id: "MLC1000",
  seller_id: 12345,
  status: "active",
  pictures: [{ url: "https://http2.mlstatic.com/D_IMG_1.jpg" }],
  attributes: [{ id: "BRAND", value_name: "Genérica" }],
  permalink: "https://articulo.mercadolibre.cl/MLC1001",
};

// ---------------------------------------------------------------------------
// New MlClient type with write operations
// ---------------------------------------------------------------------------

export type MlClient = {
  // Read operations
  getItems(sellerId: string): Promise<MlcListingsSnapshot>;
  getItem(sellerId: string, itemId: string): Promise<MlItem>;
  getOrders(sellerId: string): Promise<MlcOrdersSnapshot>;
  getQuestions(sellerId: string): Promise<MlcMessagesSnapshot>;
  // Write operations
  publishItem(sellerId: string, item: NewItem): Promise<MlWriteSnapshot>;
  updateItem(sellerId: string, itemId: string, updates: Partial<NewItem>): Promise<MlWriteSnapshot>;
  // Metadata operations
  getCategories(sellerId: string, categoryId?: string): Promise<MlCategoriesSnapshot>;
  getUserInfo(sellerId: string): Promise<MlUserSnapshot>;
};

// ---------------------------------------------------------------------------
// Factory: createMlClient — multi-account OAuth-aware ML API client
// ---------------------------------------------------------------------------

export function createMlClient(input: { oauthManager: OAuthManager; now: Date }): MlClient {
  const { oauthManager, now } = input;
  const stub = oauthManager.isStubMode();

  async function apiRequest(
    sellerId: string,
    method: "GET" | "POST" | "PUT",
    path: string,
    query?: Record<string, string>,
    body?: unknown,
  ): Promise<Response> {
    const accessToken = await oauthManager.ensureValidToken(sellerId);

    let url = `${ML_API_BASE}${path}`;
    if (query && Object.keys(query).length > 0) {
      const qs = new URLSearchParams(query).toString();
      url = `${url}?${qs}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined && method !== "GET") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetchWithBackoff(url, init);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `ML API ${method} ${path} failed: ${response.status} ${response.statusText}${errorText ? ` — ${errorText}` : ""}`,
      );
    }

    return response;
  }

  async function apiRequestJson(
    sellerId: string,
    method: "GET" | "POST" | "PUT",
    path: string,
    query?: Record<string, string>,
    body?: unknown,
  ): Promise<unknown> {
    // Validate token exists even in stub mode
    const stored = oauthManager.getStoredToken(sellerId);
    if (!stored) {
      throw new Error(`No stored token for seller ${sellerId}`);
    }

    if (stub) {
      return mockResponse(path, method, body);
    }

    const response = await apiRequest(sellerId, method, path, query, body);
    return response.json();
  }

  function mockResponse(path: string, _method: "GET" | "POST" | "PUT", body?: unknown): unknown {
    // POST /items
    if (_method === "POST" && path === "/items") {
      const newItem = body as NewItem | undefined;
      return {
        id: "MLC-MOCK-9999",
        permalink: "https://articulo.mercadolibre.cl/MLC-MOCK-9999",
        status: "active",
        ...(newItem ? { title: newItem.title } : {}),
      };
    }

    // PUT /items/{id} or GET /items/{id}
    if (path.startsWith("/items/") && !path.includes("/search")) {
      if (_method === "PUT") {
        return {
          id: path.split("/").pop() ?? "MLC-MOCK-9999",
          permalink: `https://articulo.mercadolibre.cl/${path.split("/").pop() ?? "MLC-MOCK-9999"}`,
          status: "active",
        };
      }
      return MOCK_ITEM_PAYLOAD;
    }

    if (path.includes("/items/search")) return MOCK_LISTINGS_PAYLOAD;
    if (path.includes("/orders/search")) return MOCK_ORDERS_PAYLOAD;
    if (path.includes("/questions/search")) return MOCK_QUESTIONS_PAYLOAD;
    if (path.includes("/categories")) return MOCK_CATEGORIES_PAYLOAD;
    if (path.includes("/users/me")) return MOCK_USER_PAYLOAD;

    return {};
  }

  return {
    getItems: async (sellerId) => {
      const payload = await apiRequestJson(sellerId, "GET", `/users/${sellerId}/items/search`, {
        site: "MLC",
      });
      return normalizeItems({ sellerId, payload, now });
    },

    getItem: async (sellerId, itemId) => {
      const payload = await apiRequestJson(sellerId, "GET", `/items/${itemId}`);
      return (payload ?? {}) as MlItem;
    },

    getOrders: async (sellerId) => {
      const payload = await apiRequestJson(sellerId, "GET", "/orders/search", {
        seller: sellerId,
        site: "MLC",
      });
      return normalizeOrders({ sellerId, payload, now });
    },

    getQuestions: async (sellerId) => {
      const payload = await apiRequestJson(sellerId, "GET", "/questions/search", {
        seller: sellerId,
        site: "MLC",
      });
      return normalizeQuestions({ sellerId, payload, now });
    },

    publishItem: async (sellerId, item) => {
      const payload = await apiRequestJson(sellerId, "POST", "/items", undefined, item);
      return normalizeWriteResponse({ sellerId, payload, now });
    },

    updateItem: async (sellerId, itemId, updates) => {
      const payload = await apiRequestJson(sellerId, "PUT", `/items/${itemId}`, undefined, updates);
      return normalizeWriteResponse({ sellerId, payload, now });
    },

    getCategories: async (sellerId, categoryId) => {
      const path = categoryId ? `/categories/${categoryId}` : "/categories";
      const payload = await apiRequestJson(sellerId, "GET", path, { site: "MLC" });
      return normalizeCategories({ sellerId, payload, now });
    },

    getUserInfo: async (sellerId) => {
      const payload = await apiRequestJson(sellerId, "GET", "/users/me");
      return normalizeUser({ sellerId, payload, now });
    },
  };
}
