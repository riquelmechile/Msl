export type OAuthAccessStatus = "connected" | "revoked" | "expired";

export type MlcReadSnapshotKind = "listing" | "order" | "message" | "reputation";

export type MlcReadSnapshotCompleteness = "complete" | "partial";

export type MlcReadSnapshotConfidence = "low" | "medium" | "high";

export type MlcReadSnapshotFreshness = { source: "mercadolibre-api"; signalKind: MlcReadSnapshotKind; risk: "medium" | "critical"; capturedAt: Date; maxAgeMs: number; status: "fresh" | "stale" };

export type MlcReadSnapshot<TData> = {
  sellerId: string;
  kind: MlcReadSnapshotKind;
  source: "mercadolibre-api";
  data: ReadonlyArray<TData> | TData;
  completeness: MlcReadSnapshotCompleteness;
  freshness: MlcReadSnapshotFreshness;
  confidence: MlcReadSnapshotConfidence;
};

export type MlcListingSummary = { id: string; title?: string; status?: string; availableQuantity?: number; price?: number; currencyId?: string; permalink?: string };

export type MlcOrderSummary = { id: string; status?: string; totalAmount?: number; currencyId?: string; createdAt?: string; buyerId?: string };

export type MlcMessageSummary = { id: string; subject?: string; status?: string; createdAt?: string; fromUserId?: string };

export type MlcReputationSummary = { level?: string; powerSellerStatus?: string; completedTransactions?: number; canceledTransactions?: number; totalTransactions?: number; positiveRating?: number; neutralRating?: number; negativeRating?: number };

export type MlcListingsSnapshot = MlcReadSnapshot<MlcListingSummary>;
export type MlcOrdersSnapshot = MlcReadSnapshot<MlcOrderSummary>;
export type MlcMessagesSnapshot = MlcReadSnapshot<MlcMessageSummary>;
export type MlcReputationSnapshot = MlcReadSnapshot<MlcReputationSummary>;

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

export type MlcApiClient = {
  getListings(sellerId: string): Promise<MlcListingsSnapshot>;
  getOrders(sellerId: string): Promise<MlcOrdersSnapshot>;
  getMessages(sellerId: string): Promise<MlcMessagesSnapshot>;
  getReputation(sellerId: string): Promise<MlcReputationSnapshot>;
};

const mediumMaxAgeMs = 60 * 60 * 1000;
const criticalMaxAgeMs = 5 * 60 * 1000;

function createFreshness(kind: MlcReadSnapshotKind, now: Date): MlcReadSnapshotFreshness {
  const risk = kind === "listing" ? "medium" : "critical";

  return {
    source: "mercadolibre-api",
    signalKind: kind,
    risk,
    capturedAt: now,
    maxAgeMs: risk === "critical" ? criticalMaxAgeMs : mediumMaxAgeMs,
    status: "fresh",
  };
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

function pushOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function snapshotConfidence(completeness: MlcReadSnapshotCompleteness, count: number): MlcReadSnapshotConfidence {
  if (completeness === "partial") {
    return "low";
  }

  return count > 0 ? "high" : "medium";
}

function normalizeListings(input: { sellerId: string; payload: unknown; now: Date }): MlcListingsSnapshot {
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

function normalizeOrders(input: { sellerId: string; payload: unknown; now: Date }): MlcOrdersSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results ?? root?.orders);
  let complete = root !== undefined && Array.isArray(root.results ?? root.orders);

  const data = results.flatMap((item): MlcOrderSummary[] => {
    const record = asRecord(item);
    const id = stringValue(record?.id) ?? (numberValue(record?.id) !== undefined ? String(record?.id) : undefined);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }

    const buyer = asRecord(record.buyer);
    const buyerId = stringValue(buyer?.id) ?? (numberValue(buyer?.id) !== undefined ? String(buyer?.id) : undefined);
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

function normalizeMessages(input: { sellerId: string; payload: unknown; now: Date }): MlcMessagesSnapshot {
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

function normalizeReputation(input: { sellerId: string; payload: unknown; now: Date }): MlcReputationSnapshot {
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

  const completeness =
    root !== undefined && reputation !== undefined && transactions !== undefined && data.level !== undefined
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

  return {
    getListings: (sellerId) =>
      request(sellerId, `/users/${sellerId}/items/search`, { site: "MLC" }).then((payload) =>
        normalizeListings({ sellerId, payload, now: input.now }),
      ),
    getOrders: (sellerId) =>
      request(sellerId, `/orders/search`, { seller: sellerId, site: "MLC" }).then((payload) =>
        normalizeOrders({ sellerId, payload, now: input.now }),
      ),
    getMessages: (sellerId) =>
      request(sellerId, `/messages/search`, { seller: sellerId, site: "MLC" }).then((payload) =>
        normalizeMessages({ sellerId, payload, now: input.now }),
      ),
    getReputation: (sellerId) =>
      request(sellerId, `/users/${sellerId}`, { site: "MLC" }).then((payload) =>
        normalizeReputation({ sellerId, payload, now: input.now }),
      ),
  };
}
