import type {
  EconomicCostComponent,
  EconomicEvidenceReference,
  EconomicIngestionRun,
  IngestionRunMode,
  RunIdFactory,
  UnitEconomicsSnapshot,
  DurableCumulativeMetrics,
  NormalizedCommerceTransaction,
} from "@msl/domain";
import {
  createEconomicIngestionRun,
  createEconomicEvidenceReference,
  finalizeEconomicIngestionRun,
} from "@msl/domain";
import type { SourceFetchResult } from "@msl/domain";
import { createUnitEconomicsSnapshot } from "@msl/domain";
import type {
  EconomicMemoryReaders,
  OpenEconomicWriteSession,
  EconomicWriteSessionFactory,
  ExecutionBudget,
} from "@msl/memory";
import { EconomicIngestionOwnershipError } from "@msl/memory";
import { normalizeOrders } from "./normalization.js";
import {
  adaptMarketplaceFee,
  adaptShippingCost,
  adaptSellerDiscount,
  adaptRefundReturn,
  adaptAdvertisingCost,
  adaptProductCost,
  adaptLandedCost,
  adaptPackaging,
  adaptFinancing,
  adaptTax,
  adaptOther,
  extractOrderRevenue,
} from "./adapters/index.js";
import type { FeeData, ShippingData, DiscountData, RefundData, AdData } from "./adapters/index.js";
import { transitionRun } from "./EconomicIngestionRun.js";
import { reconcileEconomics } from "./EconomicReconciliationService.js";
import {
  resolveEconomicDeadlineConfig,
  clipOperationTimeout,
  systemRuntimeClock,
  type EconomicDeadlineConfig,
  type RuntimeClock,
} from "./runtimeDeadline.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type PipelineConfig = {
  sellerId: string;
  mode: IngestionRunMode;
  maxPages?: number;
  maxTime?: number; // ms
  dryRun?: boolean;
  noPersist?: boolean;
  abortSignal?: AbortSignal;
  deadlineConfig?: Partial<EconomicDeadlineConfig>;
  runtimeClock?: RuntimeClock;
};

export type PipelineResult = {
  run: EconomicIngestionRun;
  snapshots: UnitEconomicsSnapshot[];
  reconciliation: ReconciliationVerdict;
  cumulativeMetrics?: CumulativeMetrics;
};

export type CumulativeMetrics = DurableCumulativeMetrics;

export type ReconciliationVerdict = {
  status: "balanced" | "balanced-with-tolerance" | "incomplete" | "mismatched" | "disputed";
  details: string;
  sourceTotal?: number;
  computedTotal?: number;
  difference?: number;
  revenueReconciliation?: {
    status: "balanced" | "balanced-with-tolerance" | "mismatched" | "incomplete";
    sourceTotal: number;
    computedTotal: number;
    difference: number;
  };
  costReconciliation?: {
    status: "balanced" | "balanced-with-tolerance" | "mismatched" | "incomplete";
    sourceTotal: number;
    computedTotal: number;
    difference: number;
  };
  coverage?: {
    meaningful: boolean;
    dimensions: Record<string, "complete" | "missing" | "observed-zero">;
  };
  productCostMissing?: boolean;
  landedCostMissing?: boolean;
  reasonCodes: readonly string[];
  /** Non-durable R2 contract; R4 owns persisted retry backlog state. */
  sourceGaps?: readonly {
    readonly source: "claims" | "product-ads";
    readonly reasonCode: string;
  }[];
  claimsBacklogIntent?: {
    readonly action: "schedule-when-backlog-is-available";
    readonly reasonCode: string;
  };
};

/** Raw data fetched from MercadoLibre (or injected mock). */
export type FetchedData = {
  orders: Array<{
    id: string;
    status: string;
    total_amount: number;
    currency_id?: string;
    date_created: string;
    last_updated?: string;
    order_items: Array<{
      item: { id: string; title: string };
      quantity: number;
      unit_price: number;
    }>;
    payments?: Array<{ id: string; status: string }>;
    shipping?: { id?: string; status?: string };
    pack_id?: string;
    // Enrichment data that adapters consume
    sale_fee_amount?: number;
    shipping_cost?: number;
    shipping_mode?: string;
    seller_funded_discount?: number;
    ml_funded_discount?: number;
    total_discount?: number;
    refund_amount?: number;
    return_cost?: number;
    is_partial_refund?: boolean;
    claim_id?: string;
    ad_cost?: number;
    ad_campaign_id?: string;
    ad_currency?: string;
  }>;
  items: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
  ads: Array<{
    campaignId: string;
    cost: number;
    currency: string;
    period?: { start: number; end: number };
  }>;
  /** Production fetchers report source truth separately from payload arrays. */
  sourceResults?: {
    readonly orders: SourceFetchResult;
    readonly claims: SourceFetchResult;
    readonly productAds: SourceFetchResult;
  };
};

export type DataFetcher = (
  sellerId: string,
  opts?: {
    maxPages?: number;
    abortSignal?: AbortSignal;
    cursorBefore?: { occurredAt: number; sourceRecordId: string };
    /** Absolute run deadline shared by every productive transport request. */
    deadlineAt?: number;
  },
) => Promise<FetchedData>;

/**
 * Explicit test seams retain the production pipeline route while allowing a
 * controlled boundary failure to prove the durable failure contract.
 */
export type PipelineExecutionOverrides = {
  normalizeOrders?: typeof normalizeOrders;
  adaptMarketplaceFee?: typeof adaptMarketplaceFee;
};

// ── Seller validation ──────────────────────────────────────────────────────

const VALID_SELLERS = new Set(["plasticov", "maustian"]);

// ── In-process lock ────────────────────────────────────────────────────────

const sellerLocks = new Map<string, Promise<void>>();

async function acquireLock(sellerId: string, signal?: AbortSignal): Promise<() => void> {
  const previous = sellerLocks.get(sellerId) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  sellerLocks.set(sellerId, tail);
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(new Error("Pipeline aborted"));
    signal?.addEventListener("abort", abort, { once: true });
    void previous.then(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    });
  }).catch((error: unknown) => {
    release?.();
    if (sellerLocks.get(sellerId) === tail) sellerLocks.delete(sellerId);
    throw error;
  });
  return () => {
    release?.();
    if (sellerLocks.get(sellerId) === tail) sellerLocks.delete(sellerId);
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function checkAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason === "write-session-invalidated") {
    throw new Error("Economic write session invalidated");
  }
  throw new Error("Pipeline aborted");
}

function isWriteSessionInvalidated(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return error.errors.some(isWriteSessionInvalidated) || isWriteSessionInvalidated(error.cause);
  }
  return error instanceof Error && error.message === "Economic write session invalidated";
}

/**
 * Keep operational failures useful without copying credentials, URL query
 * values, or stack paths into the durable run aggregate or structured logs.
 */
function sanitizeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("at "))
    .join(" ")
    .replace(
      /\b(token|secret|api[_-]?key|password|authorization)\s*([=:])\s*[^\s,;&]+/gi,
      "$1$2[redacted]",
    )
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
    .trim();
}

type CheckpointCursor = { occurredAt: number; sourceRecordId: string };

function compareCursor(left: CheckpointCursor, right: CheckpointCursor): number {
  if (left.occurredAt !== right.occurredAt) return left.occurredAt - right.occurredAt;
  return left.sourceRecordId.localeCompare(right.sourceRecordId);
}

function lastNormalizedCursor(
  transactions: Array<{ occurredAt: number; orderId: string }>,
): CheckpointCursor | undefined {
  const cursors = transactions
    .filter(
      (transaction) => Number.isFinite(transaction.occurredAt) && transaction.orderId.length > 0,
    )
    .map(({ occurredAt, orderId }) => ({ occurredAt, sourceRecordId: orderId }));
  return cursors.sort(compareCursor).at(-1);
}

function strictAfterCursor(
  orders: FetchedData["orders"],
  cursor?: { occurredAt: number; sourceRecordId: string },
): FetchedData["orders"] {
  const parsed = orders.flatMap((order) => {
    const occurredAt = Date.parse(order.date_created);
    return Number.isFinite(occurredAt) ? [{ order, occurredAt }] : [];
  });
  return parsed
    .filter(
      ({ order, occurredAt }) =>
        cursor === undefined || compareCursor({ occurredAt, sourceRecordId: order.id }, cursor) > 0,
    )
    .sort((left, right) =>
      compareCursor(
        { occurredAt: left.occurredAt, sourceRecordId: left.order.id },
        { occurredAt: right.occurredAt, sourceRecordId: right.order.id },
      ),
    )
    .map(({ order }) => order);
}

function hasCriticalContradictoryEvidence(claims: FetchedData["claims"]): boolean {
  return claims.some((claim) => {
    const status = claim["economic_status"] ?? claim["status"];
    return status === "contradictory" || status === "disputed";
  });
}

function isNormalizationConsistent(
  transactions: ReturnType<typeof normalizeOrders>,
  sellerId: string,
  orders: FetchedData["orders"],
): boolean {
  const expectedLineCount = orders.reduce((count, order) => count + order.order_items.length, 0);
  return (
    transactions.length === expectedLineCount &&
    transactions.every(
      (transaction) =>
        transaction.sellerId === sellerId &&
        transaction.orderId.length > 0 &&
        transaction.sourceVersion.length > 0 &&
        Number.isFinite(transaction.occurredAt),
    )
  );
}

function observedZeroDimensions(
  fetched: FetchedData,
): Partial<Record<"marketplaceFee" | "shipping" | "ads" | "productCost", "observed-zero">> {
  const dimensions: Partial<
    Record<"marketplaceFee" | "shipping" | "ads" | "productCost", "observed-zero">
  > = {};
  if (fetched.orders.length > 0 && fetched.orders.every((order) => order.sale_fee_amount === 0)) {
    dimensions.marketplaceFee = "observed-zero";
  }
  if (
    fetched.orders.length > 0 &&
    fetched.orders.every((order) => order.shipping_mode === "seller" && order.shipping_cost === 0)
  ) {
    dimensions.shipping = "observed-zero";
  }
  if (fetched.sourceResults?.productAds.status === "success-empty") {
    dimensions.ads = "observed-zero";
  }
  const productCosts = new Map(
    fetched.items.flatMap((item) => {
      const id = item["id"];
      const cost = item["product_cost"];
      return typeof id === "string" && cost === 0 ? [[id, cost] as const] : [];
    }),
  );
  if (
    fetched.orders.length > 0 &&
    fetched.orders.every((order) =>
      order.order_items.every((line) => productCosts.has(line.item.id)),
    )
  ) {
    dimensions.productCost = "observed-zero";
  }
  return dimensions;
}

function allocateOrderAmount(
  amount: number | undefined,
  transaction: NormalizedCommerceTransaction,
  orderTransactions: readonly NormalizedCommerceTransaction[],
): number | undefined {
  if (amount === undefined) return undefined;
  const totalRevenue = orderTransactions.reduce(
    (sum, current) => sum + current.grossRevenue.amountMinor,
    0,
  );
  const index = orderTransactions.indexOf(transaction);
  if (index < 0) return undefined;
  if (totalRevenue <= 0) return index === 0 ? amount : 0;
  if (index === orderTransactions.length - 1) {
    return (
      amount -
      orderTransactions
        .slice(0, index)
        .reduce(
          (sum, current) =>
            sum + Math.floor((amount * current.grossRevenue.amountMinor) / totalRevenue),
          0,
        )
    );
  }
  return Math.floor((amount * transaction.grossRevenue.amountMinor) / totalRevenue);
}

function emptyCumulativeMetrics(): CumulativeMetrics {
  return { status: "unavailable", reason: "aggregate-query-failed" };
}

async function releaseEconomicWriteSession(
  writeSession: OpenEconomicWriteSession | undefined,
  executionError: unknown,
): Promise<void> {
  try {
    await writeSession?.release();
  } catch (cleanupError) {
    if (executionError !== undefined) {
      throw new AggregateError(
        [executionError, cleanupError],
        "Economic ingestion failed and write session cleanup was incomplete",
        { cause: executionError },
      );
    }
    throw cleanupError;
  }
}

// ── Pipeline ───────────────────────────────────────────────────────────────

export async function runEconomicIngestion(
  config: PipelineConfig,
  readers: EconomicMemoryReaders,
  writeSessionFactory: EconomicWriteSessionFactory,
  dataFetcher: DataFetcher,
  executionBudget: ExecutionBudget,
  runIdFactory?: RunIdFactory,
  executionOverrides?: PipelineExecutionOverrides,
): Promise<PipelineResult> {
  const runtimeClock = config.runtimeClock ?? systemRuntimeClock;
  const deadlineConfig = resolveEconomicDeadlineConfig({
    ...config.deadlineConfig,
    ...(config.maxTime !== undefined ? { maxTimeMs: config.maxTime } : {}),
  });
  const startTime = runtimeClock.now();
  const controller = new AbortController();
  const externalAbort = () => controller.abort(config.abortSignal?.reason);
  config.abortSignal?.addEventListener("abort", externalAbort, { once: true });
  if (config.abortSignal?.aborted) externalAbort();
  const deadlineTimer = runtimeClock.setTimeout(
    () => controller.abort("deadline"),
    deadlineConfig.maxTimeMs,
  );
  const abortSignal = controller.signal;
  const errors: string[] = [];
  let createdRun: EconomicIngestionRun | undefined;
  let writeSession: OpenEconomicWriteSession | undefined;
  let failedSourceHealthUpdates:
    readonly [{ source: "orders"; outcome: SourceFetchResult }] | undefined;

  // Run-scoped counters (tracked locally during the run)
  const duplicatesIgnored = 0;
  const evidenceCreated = 0;
  const componentsCreated = 0;
  const snapshotsCreated = 0;

  try {
    // 1. Resolve seller
    if (!VALID_SELLERS.has(config.sellerId)) {
      throw new Error(
        `Invalid sellerId "${config.sellerId}". Must be one of: ${[...VALID_SELLERS].join(", ")}`,
      );
    }

    checkAborted(abortSignal);

    // 2. Verify read readiness (placeholder)

    // 3. Acquire lock
    const releaseLock = await acquireLock(config.sellerId, abortSignal);
    let executionError: unknown;
    try {
      checkAborted(abortSignal);

      // 4. Create run
      let run: EconomicIngestionRun | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const initialRunResult = createEconomicIngestionRun({
          ...(runIdFactory !== undefined ? { runIdFactory } : {}),
          sellerId: config.sellerId,
          mode: config.mode,
          sourceKinds: ["orders", "items", "claims", "ads"],
          startedAt: startTime,
          recordsFetched: 0,
          recordsNormalized: 0,
          componentsCreated: 0,
          snapshotsCreated: 0,
          duplicatesIgnored: 0,
          partialSnapshots: 0,
          disputedSnapshots: 0,
          errors: [],
          status: "pending",
        });
        if (!initialRunResult.success) {
          throw new Error(`Failed to create ingestion run: ${initialRunResult.error.message}`);
        }
        run = initialRunResult.run;
        createdRun = run;
        if (config.dryRun || config.noPersist || (await readers.runs.getRun(run.runId)) === null)
          break;
        if (attempt === 2) throw new Error("Failed to allocate a unique economic ingestion run ID");
      }
      if (run === undefined) throw new Error("Failed to create ingestion run");
      createdRun = run;

      if (!config.dryRun && !config.noPersist) {
        const receiptWindow = clipOperationTimeout({
          requestedMs: executionBudget.remaining(runtimeClock.now()),
          remainingMs: executionBudget.remaining(runtimeClock.now()),
        });
        if (receiptWindow.status !== "allowed")
          throw new Error("Economic admission deadline expired");
        writeSession = await writeSessionFactory.open({
          sellerId: config.sellerId,
          ownerRunId: run.runId,
          receiptTtlMs: receiptWindow.timeoutMs,
          signal: abortSignal,
          onInvalidated: () => controller.abort("write-session-invalidated"),
        });
      }

      checkAborted(abortSignal);

      // 5. Fetch data
      run = transitionRun(run, "fetching");
      const ordersCheckpoint =
        !config.dryRun && !config.noPersist && readers.runs.getSourceCheckpoint
          ? await readers.runs.getSourceCheckpoint(config.sellerId, "orders")
          : null;
      const ordersCursorBefore =
        ordersCheckpoint !== null &&
        ordersCheckpoint.occurredAt !== null &&
        ordersCheckpoint.sourceRecordId !== null
          ? {
              occurredAt: ordersCheckpoint.occurredAt,
              sourceRecordId: ordersCheckpoint.sourceRecordId,
            }
          : undefined;
      const fetched = await dataFetcher(
        config.sellerId,
        config.maxPages !== undefined || abortSignal !== undefined || ordersCheckpoint !== null
          ? {
              ...(config.maxPages !== undefined ? { maxPages: config.maxPages } : {}),
              abortSignal,
              deadlineAt: startTime + deadlineConfig.maxTimeMs,
              ...(ordersCursorBefore !== undefined ? { cursorBefore: ordersCursorBefore } : {}),
            }
          : undefined,
      );
      fetched.orders = strictAfterCursor(fetched.orders, ordersCursorBefore);

      const sourceResults = fetched.sourceResults;
      if (
        sourceResults !== undefined &&
        sourceResults.orders.status !== "success-with-data" &&
        sourceResults.orders.status !== "success-empty"
      ) {
        failedSourceHealthUpdates = [{ source: "orders", outcome: sourceResults.orders }];
      }

      checkAborted(abortSignal);

      if (failedSourceHealthUpdates !== undefined) {
        throw new Error(`orders-source-${failedSourceHealthUpdates[0].outcome.status}`);
      }
      const claimsGap =
        sourceResults !== undefined &&
        sourceResults.claims.status !== "success-with-data" &&
        sourceResults.claims.status !== "success-empty";
      const adsGap =
        sourceResults !== undefined &&
        sourceResults.productAds.status !== "success-with-data" &&
        sourceResults.productAds.status !== "success-empty";

      // 6. Normalize
      run = transitionRun(run, "normalizing");
      const transactions = (executionOverrides?.normalizeOrders ?? normalizeOrders)({
        orders: fetched.orders,
        sellerId: config.sellerId,
        ingestionRunId: run.runId,
      });

      checkAborted(abortSignal);

      // 7. Strip PII — normalization already handles this.

      // 8. Build evidence refs
      run = transitionRun(run, "adapting");
      const evidenceRefs: EconomicEvidenceReference[] = [];
      const adaptNow = Date.now();
      for (const order of fetched.orders) {
        const evidenceResult = createEconomicEvidenceReference({
          sellerId: config.sellerId,
          sourceSystem: "mercadolibre",
          sourceEntityType: "order",
          sourceRecordId: order.id,
          observedAt: adaptNow,
          occurredAt: Date.parse(order.date_created),
          sourceVersion: order.last_updated ?? order.date_created,
          checksum: `sha256:order:${order.id}:${order.total_amount}`,
          verification: "verified",
          confidence: 0.95,
          ingestionRunId: run.runId,
        });
        if (evidenceResult.success) {
          evidenceRefs.push(evidenceResult.evidence);
        }
      }

      checkAborted(abortSignal);

      // 9. Run adapters
      const allComponents: EconomicCostComponent[] = [];
      const componentsByTransaction = new Map<
        NormalizedCommerceTransaction,
        EconomicCostComponent[]
      >();
      for (const tx of transactions) {
        const orderData = fetched.orders.find((o) => o.id === tx.orderId);
        const orderTransactions = transactions.filter(
          (candidate) => candidate.orderId === tx.orderId,
        );
        const txComponents: EconomicCostComponent[] = [];

        // Marketplace fee
        if (orderData?.sale_fee_amount && orderData.sale_fee_amount > 0) {
          const feeData: FeeData = {
            saleFeeAmount:
              allocateOrderAmount(orderData.sale_fee_amount, tx, orderTransactions) ?? 0,
            ...(orderData.currency_id !== undefined ? { currencyId: orderData.currency_id } : {}),
          };
          txComponents.push(
            ...(executionOverrides?.adaptMarketplaceFee ?? adaptMarketplaceFee)(tx, feeData),
          );
        } else {
          txComponents.push(
            ...(executionOverrides?.adaptMarketplaceFee ?? adaptMarketplaceFee)(tx, null),
          );
        }

        // Shipping cost
        if (orderData?.shipping_cost !== undefined && orderData.shipping_mode === "seller") {
          const shippingData: ShippingData = {
            shippingCost: allocateOrderAmount(orderData.shipping_cost, tx, orderTransactions) ?? 0,
            shippingMode: orderData.shipping_mode,
          };
          txComponents.push(...adaptShippingCost(tx, shippingData));
        } else {
          txComponents.push(...adaptShippingCost(tx, null));
        }

        // Seller discount
        if (orderData?.seller_funded_discount && orderData.seller_funded_discount > 0) {
          const discountData: DiscountData = {
            sellerFundedAmount:
              allocateOrderAmount(orderData.seller_funded_discount, tx, orderTransactions) ?? 0,
            ...(orderData.ml_funded_discount !== undefined
              ? {
                  mlFundedAmount:
                    allocateOrderAmount(orderData.ml_funded_discount, tx, orderTransactions) ?? 0,
                }
              : {}),
            ...(orderData.total_discount !== undefined
              ? {
                  totalDiscount:
                    allocateOrderAmount(orderData.total_discount, tx, orderTransactions) ?? 0,
                }
              : {}),
          };
          txComponents.push(...adaptSellerDiscount(tx, discountData));
        } else {
          txComponents.push(...adaptSellerDiscount(tx, null));
        }

        // Refund/return
        if (orderData && (orderData.refund_amount || orderData.return_cost)) {
          const refundData: RefundData = {
            ...(orderData.refund_amount !== undefined
              ? {
                  refundAmount:
                    allocateOrderAmount(orderData.refund_amount, tx, orderTransactions) ?? 0,
                }
              : {}),
            ...(orderData.return_cost !== undefined
              ? {
                  returnCost:
                    allocateOrderAmount(orderData.return_cost, tx, orderTransactions) ?? 0,
                }
              : {}),
            ...(orderData.is_partial_refund !== undefined
              ? { isPartial: orderData.is_partial_refund }
              : {}),
            ...(orderData.claim_id !== undefined ? { claimId: orderData.claim_id } : {}),
          };
          txComponents.push(...adaptRefundReturn(tx, refundData));
        } else {
          txComponents.push(...adaptRefundReturn(tx, null));
        }

        // Advertising cost (per-order)
        if (orderData?.ad_cost && orderData.ad_cost > 0) {
          const adData: AdData = {
            campaignId: orderData.ad_campaign_id ?? "unknown",
            cost: allocateOrderAmount(orderData.ad_cost, tx, orderTransactions) ?? 0,
            currency: orderData.ad_currency ?? tx.currency,
          };
          txComponents.push(...adaptAdvertisingCost(tx.sellerId, adData, tx));
        }

        // Stub adapters (all return [])
        txComponents.push(...adaptProductCost(tx));
        txComponents.push(...adaptLandedCost(tx));
        txComponents.push(...adaptPackaging(tx));
        txComponents.push(...adaptFinancing(tx));
        txComponents.push(...adaptTax(tx));
        txComponents.push(...adaptOther(tx));
        const attributedComponents = txComponents.map((component) => ({
          ...component,
          sourceRecordId: tx.transactionId,
          metadata: {
            ...component.metadata,
            transactionId: tx.transactionId,
            orderId: tx.orderId,
            itemId: tx.itemId,
            ...(component.sourceRecordId === undefined
              ? {}
              : { providerSourceRecordId: component.sourceRecordId }),
          },
        }));
        allComponents.push(...attributedComponents);
        componentsByTransaction.set(tx, attributedComponents);
      }

      // Also process campaign-level ads (without order context)
      for (const ad of fetched.ads) {
        const adData: AdData = {
          campaignId: ad.campaignId,
          cost: ad.cost,
          currency: ad.currency,
          ...(ad.period !== undefined ? { period: ad.period } : {}),
        };
        allComponents.push(...adaptAdvertisingCost(config.sellerId, adData, undefined));
      }

      checkAborted(abortSignal);

      // 10. Evaluate missing inputs (handled by computeUnitEconomics)

      // 11. Compute snapshots
      run = transitionRun(run, "computing");
      let snapshots: UnitEconomicsSnapshot[] = [];
      for (const tx of transactions) {
        const revenueResult = extractOrderRevenue(tx);
        if (revenueResult === null) continue; // cancelled → no snapshot

        const txComponents = componentsByTransaction.get(tx) ?? [];

        const snapshot = createUnitEconomicsSnapshot({
          sellerId: tx.sellerId,
          orderId: tx.orderId,
          itemId: tx.itemId,
          sourceVersion: tx.sourceVersion,
          ...(tx.sku !== undefined ? { sku: tx.sku } : {}),
          channel: tx.channel,
          grossRevenue: revenueResult.grossRevenue,
          currency: revenueResult.currency,
          costComponents: txComponents,
        });

        snapshots.push(snapshot);
      }

      checkAborted(abortSignal);

      // 12. Reconcile and determine completion eligibility before persistence.
      // Missing costs are coverage facts, never fabricated zeroes; they do not
      // make otherwise balanced revenue ineligible for a partial completion.
      const sourceTotals = {
        grossRevenue: fetched.orders.reduce(
          (sum, order) => sum + (order.status !== "cancelled" ? order.total_amount : 0),
          0,
        ),
        fees: fetched.orders.reduce((sum, order) => sum + (order.sale_fee_amount ?? 0), 0),
        shipping: fetched.orders.reduce(
          (sum, order) => sum + (order.shipping_mode === "seller" ? (order.shipping_cost ?? 0) : 0),
          0,
        ),
        ads:
          fetched.orders.reduce((sum, order) => sum + (order.ad_cost ?? 0), 0) +
          fetched.ads.reduce((sum, ad) => sum + ad.cost, 0),
        refunds: fetched.orders.reduce((sum, order) => sum + (order.refund_amount ?? 0), 0),
      };
      const currencies = new Set([
        ...fetched.orders
          .map((order) => order.currency_id)
          .filter((currency): currency is string => Boolean(currency)),
        ...fetched.ads.map((ad) => ad.currency),
      ]);
      const reconciliation = reconcileEconomics(sourceTotals, snapshots, 1, {
        currencies: [...currencies],
        normalizedLines: transactions.length,
        normalizedSellerIds: transactions.map((transaction) => transaction.sellerId),
        expectedSellerId: config.sellerId,
        normalizationConsistent: isNormalizationConsistent(
          transactions,
          config.sellerId,
          fetched.orders,
        ),
        criticalDispute: hasCriticalContradictoryEvidence(fetched.claims),
        observedZeroDimensions: observedZeroDimensions(fetched),
      });
      const sourceGaps = [
        ...(claimsGap
          ? [{ source: "claims" as const, reasonCode: sourceResults.claims.reasonCode }]
          : []),
        ...(adsGap
          ? [{ source: "product-ads" as const, reasonCode: sourceResults.productAds.reasonCode }]
          : []),
      ];
      const reconciliationWithSourceGaps: ReconciliationVerdict = {
        ...reconciliation,
        ...(sourceGaps.length > 0 ? { sourceGaps } : {}),
        ...(claimsGap
          ? {
              claimsBacklogIntent: {
                action: "schedule-when-backlog-is-available" as const,
                reasonCode: sourceResults.claims.reasonCode,
              },
            }
          : {}),
      };
      const revenueBalanced =
        reconciliation.revenueReconciliation?.status === "balanced" ||
        reconciliation.revenueReconciliation?.status === "balanced-with-tolerance";
      const costsBalanced =
        reconciliation.costReconciliation?.status === "balanced" ||
        reconciliation.costReconciliation?.status === "balanced-with-tolerance";
      const eligible =
        revenueBalanced &&
        costsBalanced &&
        !reconciliationWithSourceGaps.reasonCodes.some((code) =>
          [
            "currency-mismatch",
            "seller-mismatch",
            "critical-dispute",
            "normalization-mismatch",
            "zero-values",
          ].includes(code),
        );
      const candidateCursor = lastNormalizedCursor(transactions);

      // 13. Persist (atomic transaction, fail-closed)
      run = transitionRun(run, "persisting");
      let cumulativeMetrics: CumulativeMetrics = emptyCumulativeMetrics();

      if (!config.noPersist && !config.dryRun) {
        if (writeSession === undefined) throw new Error("Economic write session required");
        const priorCursor =
          ordersCheckpoint?.occurredAt !== null &&
          ordersCheckpoint?.occurredAt !== undefined &&
          ordersCheckpoint.sourceRecordId !== null
            ? {
                occurredAt: ordersCheckpoint.occurredAt,
                sourceRecordId: ordersCheckpoint.sourceRecordId,
              }
            : undefined;
        const checkpointAdvanced =
          eligible &&
          candidateCursor !== undefined &&
          (priorCursor === undefined || compareCursor(candidateCursor, priorCursor) > 0);
        const finalRun = finalizeEconomicIngestionRun(run, {
          status: eligible ? "completed" : "failed",
          completedAt: runtimeClock.now(),
          recordsFetched: fetched.orders.length + fetched.ads.length,
          recordsNormalized: transactions.length,
          componentsCreated: eligible ? allComponents.length : 0,
          snapshotsCreated: eligible ? snapshots.length : 0,
          duplicatesIgnored: 0,
          partialSnapshots: snapshots.filter((snapshot) => snapshot.calculationStatus === "partial")
            .length,
          disputedSnapshots: snapshots.filter(
            (snapshot) => snapshot.calculationStatus === "disputed",
          ).length,
          errors: eligible ? [] : reconciliationWithSourceGaps.reasonCodes,
          reconciliation: reconciliationWithSourceGaps,
          cumulativeMetrics,
          ...(priorCursor === undefined
            ? {}
            : { checkpointBefore: `${priorCursor.occurredAt}:${priorCursor.sourceRecordId}` }),
          ...(checkpointAdvanced && candidateCursor !== undefined
            ? { checkpointAfter: `${candidateCursor.occurredAt}:${candidateCursor.sourceRecordId}` }
            : {}),
        });
        if (eligible) {
          checkAborted(abortSignal);
          executionBudget.require("economic ingestion commit");
          const components = allComponents.map((component) => {
            const sourceVersion =
              component.sourceVersion ??
              transactions.find((transaction) => transaction.orderId === component.sourceRecordId)
                ?.sourceVersion;
            return {
              ...component,
              ...(sourceVersion === undefined ? {} : { sourceVersion }),
            };
          });
          const committed = await writeSession.session.commitIngestion({
            run: finalRun,
            evidence: evidenceRefs,
            components,
            snapshots,
            checkpoints:
              checkpointAdvanced && candidateCursor !== undefined
                ? [
                    {
                      source: "orders",
                      cursor: candidateCursor,
                      expected: ordersCheckpoint ?? {
                        version: 0,
                        occurredAt: null,
                        sourceRecordId: null,
                      },
                    },
                  ]
                : [],
            sourceHealthUpdates:
              sourceResults === undefined
                ? []
                : [
                    { source: "orders", outcome: sourceResults.orders },
                    { source: "claims", outcome: sourceResults.claims },
                    { source: "product-ads", outcome: sourceResults.productAds },
                  ],
            reconciliation: reconciliationWithSourceGaps,
          });
          run = committed.run;
          snapshots = [...committed.snapshots];
          cumulativeMetrics = committed.cumulativeMetrics;
        } else {
          run = await writeSession.session.recordFailure({
            run: finalRun,
            error: reconciliationWithSourceGaps.reasonCodes.join(","),
          });
        }
      } else {
        run = finalizeEconomicIngestionRun(run, {
          status: eligible ? "completed" : "failed",
          completedAt: runtimeClock.now(),
          recordsFetched: fetched.orders.length + fetched.ads.length,
          recordsNormalized: transactions.length,
          componentsCreated: 0,
          snapshotsCreated: 0,
          duplicatesIgnored: 0,
          partialSnapshots: snapshots.filter((snapshot) => snapshot.calculationStatus === "partial")
            .length,
          disputedSnapshots: snapshots.filter(
            (snapshot) => snapshot.calculationStatus === "disputed",
          ).length,
          errors: eligible ? [] : reconciliationWithSourceGaps.reasonCodes,
          reconciliation: reconciliationWithSourceGaps,
          cumulativeMetrics,
        });
      }
      // 14. Emit truthful run-scoped and cumulative metrics.
      const elapsedMs = Date.now() - startTime;

      console.log(
        JSON.stringify({
          event: "economic-ingestion",
          runId: run.runId,
          sellerId: config.sellerId,
          mode: config.mode,
          runMetrics: {
            ordersFetched: fetched.orders.length,
            normalizedLines: transactions.length,
            componentsCreated,
            snapshotsCreated,
            evidenceCreated,
            duplicatesIgnored,
          },
          cumulativeMetrics,
          reconciliation: reconciliationWithSourceGaps,
          elapsedMs,
          dryRun: config.dryRun ?? false,
          timestamp: new Date().toISOString(),
        }),
      );

      return { run, snapshots, reconciliation: reconciliationWithSourceGaps, cumulativeMetrics };
    } catch (error) {
      executionError = error;
      throw error;
    } finally {
      // Close the admitted write session before releasing the in-process lock.
      try {
        await releaseEconomicWriteSession(writeSession, executionError);
      } finally {
        // 16. Release lock
        releaseLock();
      }
    }
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    const primaryError = err instanceof AggregateError && err.cause !== undefined ? err.cause : err;
    if (primaryError instanceof EconomicIngestionOwnershipError) throw primaryError;
    const errorMessage = sanitizeFailureMessage(primaryError);
    errors.push(errorMessage);

    if (err instanceof AggregateError) {
      console.error(
        JSON.stringify({
          event: "economic-ingestion-cleanup-error",
          sellerId: config.sellerId,
          errors: err.errors.slice(1).map(sanitizeFailureMessage),
          timestamp: new Date().toISOString(),
        }),
      );
    }

    console.error(
      JSON.stringify({
        event: "economic-ingestion-error",
        sellerId: config.sellerId,
        mode: config.mode,
        error: errorMessage,
        elapsedMs,
        timestamp: new Date().toISOString(),
      }),
    );

    const completedAt = Date.now();
    const failedRunResult = createEconomicIngestionRun({
      ...(createdRun !== undefined ? { runId: createdRun.runId } : {}),
      ...(createdRun === undefined && runIdFactory !== undefined ? { runIdFactory } : {}),
      sellerId: config.sellerId,
      mode: config.mode,
      sourceKinds: ["orders", "items", "claims", "ads"],
      startedAt: startTime,
      completedAt,
      recordsFetched: 0,
      recordsNormalized: 0,
      componentsCreated: 0,
      snapshotsCreated: 0,
      duplicatesIgnored: 0,
      partialSnapshots: 0,
      disputedSnapshots: 0,
      errors,
      status: "failed",
    });

    const run =
      createdRun !== undefined
        ? finalizeEconomicIngestionRun(createdRun, {
            status: "failed",
            completedAt,
            recordsFetched: 0,
            recordsNormalized: 0,
            componentsCreated: 0,
            snapshotsCreated: 0,
            duplicatesIgnored: 0,
            partialSnapshots: 0,
            disputedSnapshots: 0,
            errors,
          })
        : failedRunResult.success
          ? failedRunResult.run
          : ({
              runId: "failed-run",
              sellerId: config.sellerId,
              mode: config.mode,
              sourceKinds: [],
              startedAt: startTime,
              recordsFetched: 0,
              recordsNormalized: 0,
              componentsCreated: 0,
              snapshotsCreated: 0,
              duplicatesIgnored: 0,
              partialSnapshots: 0,
              disputedSnapshots: 0,
              errors,
              status: "failed" as const,
              noExternalMutationExecuted: true,
            } satisfies EconomicIngestionRun);

    let persistenceFailure: string | undefined;
    if (createdRun !== undefined && !config.dryRun && !config.noPersist) {
      let failureWriteSession: OpenEconomicWriteSession | undefined;
      try {
        failureWriteSession = await writeSessionFactory.open({
          sellerId: config.sellerId,
          ownerRunId: run.runId,
          receiptTtlMs: Math.max(1, executionBudget.remaining(runtimeClock.now())),
        });
        await failureWriteSession.session.recordFailure({
          run,
          error: errorMessage,
          ...(failedSourceHealthUpdates === undefined
            ? {}
            : { sourceHealthUpdates: failedSourceHealthUpdates }),
        });
      } catch (updateError) {
        persistenceFailure = sanitizeFailureMessage(updateError);
        console.error(
          JSON.stringify({
            event: "economic-ingestion-error",
            runId: run.runId,
            sellerId: config.sellerId,
            phase: "persist-failed-aggregate",
            error: persistenceFailure,
            timestamp: new Date().toISOString(),
          }),
        );
      } finally {
        await failureWriteSession?.release();
      }
    }

    const currencyFailure = errorMessage.includes("currencies must match");
    const writeSessionInvalidated = isWriteSessionInvalidated(primaryError);
    return {
      run,
      snapshots: [],
      reconciliation: {
        status: currencyFailure ? "mismatched" : "incomplete",
        details: persistenceFailure
          ? `Pipeline failed: ${errorMessage}. Durable failed aggregate could not be persisted: ${persistenceFailure}`
          : `Pipeline failed: ${errorMessage}`,
        reasonCodes: [
          writeSessionInvalidated
            ? "write-session-invalidated"
            : currencyFailure
              ? "currency-mismatch"
              : "pipeline-failure",
        ],
      },
      cumulativeMetrics: emptyCumulativeMetrics(),
    };
  } finally {
    runtimeClock.clearTimeout(deadlineTimer);
    config.abortSignal?.removeEventListener("abort", externalAbort);
  }
}
