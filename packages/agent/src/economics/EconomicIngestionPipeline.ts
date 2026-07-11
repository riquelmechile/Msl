import type {
  EconomicCostComponent,
  EconomicEvidenceReference,
  EconomicIngestionRun,
  IngestionRunMode,
  RunIdFactory,
  UnitEconomicsSnapshot,
} from "@msl/domain";
import { createEconomicIngestionRun, createEconomicEvidenceReference } from "@msl/domain";
import { createUnitEconomicsSnapshot } from "@msl/domain";
import type { EconomicOutcomeStore } from "@msl/memory";
import type { EconomicIngestionRunStore } from "@msl/memory";
import { syncUpdateRunInTx, syncUpdateCheckpointInTx } from "@msl/memory";
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
import type {
  FeeData,
  ShippingData,
  DiscountData,
  RefundData,
  AdData,
} from "./adapters/index.js";
import { transitionRun } from "./EconomicIngestionRun.js";
import { reconcileEconomics } from "./EconomicReconciliationService.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type PipelineConfig = {
  sellerId: string;
  mode: IngestionRunMode;
  maxPages?: number;
  maxTime?: number; // ms
  dryRun?: boolean;
  noPersist?: boolean;
  abortSignal?: AbortSignal;
};

export type PipelineResult = {
  run: EconomicIngestionRun;
  snapshots: UnitEconomicsSnapshot[];
  reconciliation: ReconciliationVerdict;
};

export type ReconciliationVerdict = {
  status:
    | "balanced"
    | "balanced-with-tolerance"
    | "incomplete"
    | "mismatched"
    | "disputed";
  details: string;
  sourceTotal?: number;
  computedTotal?: number;
  difference?: number;
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
};

export type DataFetcher = (
  sellerId: string,
  opts?: { maxPages?: number; abortSignal?: AbortSignal },
) => Promise<FetchedData>;

// ── Seller validation ──────────────────────────────────────────────────────

const VALID_SELLERS = new Set(["plasticov", "maustian"]);

// ── In-process lock ────────────────────────────────────────────────────────

const sellerLocks = new Map<string, boolean>();

function acquireLock(sellerId: string): boolean {
  if (sellerLocks.get(sellerId)) return false;
  sellerLocks.set(sellerId, true);
  return true;
}

function releaseLock(sellerId: string): void {
  sellerLocks.delete(sellerId);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Pipeline aborted");
}

// ── Pipeline ───────────────────────────────────────────────────────────────

export async function runEconomicIngestion(
  config: PipelineConfig,
  store: EconomicOutcomeStore,
  dataFetcher: DataFetcher,
  runIdFactory?: RunIdFactory,
  runStore?: EconomicIngestionRunStore,
): Promise<PipelineResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  try {
    // 1. Resolve seller
    if (!VALID_SELLERS.has(config.sellerId)) {
      throw new Error(
        `Invalid sellerId "${config.sellerId}". Must be one of: ${[...VALID_SELLERS].join(", ")}`,
      );
    }

    checkAborted(config.abortSignal);

    // 2. Verify read readiness (placeholder)

    // 3. Acquire lock
    if (!acquireLock(config.sellerId)) {
      throw new Error(
        `Seller "${config.sellerId}" is already being ingested. Try again later.`,
      );
    }

    try {
      checkAborted(config.abortSignal);

      // 4. Create run
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

      let run = initialRunResult.run;

      // Persist the initial run record (if runStore is available)
      if (runStore && !config.dryRun && !config.noPersist) {
        try {
          await runStore.createRun({
            runId: run.runId,
            sellerId: run.sellerId,
            status: run.status,
            mode: run.mode,
            startedAt: run.startedAt,
            params: { maxPages: config.maxPages, mode: config.mode },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            JSON.stringify({
              event: "economic-ingestion-error",
              runId: run.runId,
              sellerId: config.sellerId,
              phase: "create-run",
              error: msg,
              timestamp: new Date().toISOString(),
            }),
          );
          throw new Error(`Failed to persist initial run record: ${msg}`);
        }
      }

      checkAborted(config.abortSignal);

      // 5. Fetch data
      run = transitionRun(run, "fetching");
      const fetched = await dataFetcher(
        config.sellerId,
        config.maxPages !== undefined || config.abortSignal !== undefined
          ? {
              ...(config.maxPages !== undefined ? { maxPages: config.maxPages } : {}),
              ...(config.abortSignal !== undefined ? { abortSignal: config.abortSignal } : {}),
            }
          : undefined,
      );

      checkAborted(config.abortSignal);

      // 6. Normalize
      run = transitionRun(run, "normalizing");
      const transactions = normalizeOrders({
        orders: fetched.orders,
        sellerId: config.sellerId,
        ingestionRunId: run.runId,
      });

      checkAborted(config.abortSignal);

      // 7. Strip PII — normalization already handles this.

      // 8. Build evidence refs
      run = transitionRun(run, "adapting");
      const evidenceRefs: EconomicEvidenceReference[] = [];
      const now = Date.now();
      for (const order of fetched.orders) {
        const evidenceResult = createEconomicEvidenceReference({
          sellerId: config.sellerId,
          sourceSystem: "mercadolibre",
          sourceEntityType: "order",
          sourceRecordId: order.id,
          observedAt: now,
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

      checkAborted(config.abortSignal);

      // 9. Run adapters
      const allComponents: EconomicCostComponent[] = [];
      for (const tx of transactions) {
        const orderData = fetched.orders.find((o) => o.id === tx.orderId);

        // Marketplace fee
        if (orderData?.sale_fee_amount && orderData.sale_fee_amount > 0) {
          const feeData: FeeData = {
            saleFeeAmount: orderData.sale_fee_amount,
            ...(orderData.currency_id !== undefined
              ? { currencyId: orderData.currency_id }
              : {}),
          };
          allComponents.push(...adaptMarketplaceFee(tx, feeData));
        } else {
          allComponents.push(...adaptMarketplaceFee(tx, null));
        }

        // Shipping cost
        if (
          orderData?.shipping_cost !== undefined &&
          orderData.shipping_mode === "seller"
        ) {
          const shippingData: ShippingData = {
            shippingCost: orderData.shipping_cost,
            shippingMode: orderData.shipping_mode,
          };
          allComponents.push(...adaptShippingCost(tx, shippingData));
        } else {
          allComponents.push(...adaptShippingCost(tx, null));
        }

        // Seller discount
        if (orderData?.seller_funded_discount && orderData.seller_funded_discount > 0) {
          const discountData: DiscountData = {
            sellerFundedAmount: orderData.seller_funded_discount,
            ...(orderData.ml_funded_discount !== undefined
              ? { mlFundedAmount: orderData.ml_funded_discount }
              : {}),
            ...(orderData.total_discount !== undefined
              ? { totalDiscount: orderData.total_discount }
              : {}),
          };
          allComponents.push(...adaptSellerDiscount(tx, discountData));
        } else {
          allComponents.push(...adaptSellerDiscount(tx, null));
        }

        // Refund/return
        if (orderData && (orderData.refund_amount || orderData.return_cost)) {
          const refundData: RefundData = {
            ...(orderData.refund_amount !== undefined
              ? { refundAmount: orderData.refund_amount }
              : {}),
            ...(orderData.return_cost !== undefined
              ? { returnCost: orderData.return_cost }
              : {}),
            ...(orderData.is_partial_refund !== undefined
              ? { isPartial: orderData.is_partial_refund }
              : {}),
            ...(orderData.claim_id !== undefined
              ? { claimId: orderData.claim_id }
              : {}),
          };
          allComponents.push(...adaptRefundReturn(tx, refundData));
        } else {
          allComponents.push(...adaptRefundReturn(tx, null));
        }

        // Advertising cost (per-order)
        if (orderData?.ad_cost && orderData.ad_cost > 0) {
          const adData: AdData = {
            campaignId: orderData.ad_campaign_id ?? "unknown",
            cost: orderData.ad_cost,
            currency: orderData.ad_currency ?? tx.currency,
          };
          allComponents.push(...adaptAdvertisingCost(tx.sellerId, adData, tx));
        }

        // Stub adapters (all return [])
        allComponents.push(...adaptProductCost(tx));
        allComponents.push(...adaptLandedCost(tx));
        allComponents.push(...adaptPackaging(tx));
        allComponents.push(...adaptFinancing(tx));
        allComponents.push(...adaptTax(tx));
        allComponents.push(...adaptOther(tx));
      }

      // Also process campaign-level ads (without order context)
      for (const ad of fetched.ads) {
        const adData: AdData = {
          campaignId: ad.campaignId,
          cost: ad.cost,
          currency: ad.currency,
          ...(ad.period !== undefined ? { period: ad.period } : {}),
        };
        allComponents.push(
          ...adaptAdvertisingCost(config.sellerId, adData, undefined),
        );
      }

      checkAborted(config.abortSignal);

      // 10. Evaluate missing inputs (handled by computeUnitEconomics)

      // 11. Compute snapshots
      run = transitionRun(run, "computing");
      const snapshots: UnitEconomicsSnapshot[] = [];
      for (const tx of transactions) {
        const revenueResult = extractOrderRevenue(tx);
        if (revenueResult === null) continue; // cancelled → no snapshot

        const txComponents = allComponents.filter(
          (c) => c.sourceRecordId === tx.orderId || c.sellerId === tx.sellerId,
        );

        const snapshot = createUnitEconomicsSnapshot({
          sellerId: tx.sellerId,
          orderId: tx.orderId,
          itemId: tx.itemId,
          ...(tx.sku !== undefined ? { sku: tx.sku } : {}),
          channel: tx.channel,
          grossRevenue: revenueResult.grossRevenue,
          currency: revenueResult.currency,
          costComponents: txComponents,
        });

        snapshots.push(snapshot);
      }

      checkAborted(config.abortSignal);

      // 12. Persist (atomic transaction, fail-closed)
      run = transitionRun(run, "persisting");

      if (!config.noPersist && !config.dryRun) {
        try {
          // Build run result (compute before transaction to keep it pure)
          const endTime = Date.now();
          const runResult = {
            transactions: transactions.length,
            components: allComponents.length,
            snapshots: snapshots.length,
            reconciliation: "", // populated after transaction succeeds
            elapsedMs: endTime - startTime,
          };

          // Build checkpoint data
          const lastOrder = fetched.orders[fetched.orders.length - 1];
          const checkpointData: {
            lastOrderDate: string;
            lastOrderId?: string;
            lastRunId: string;
          } = {
            lastOrderDate: lastOrder?.date_created ?? new Date().toISOString(),
            lastRunId: run.runId,
          };
          if (lastOrder?.id) checkpointData.lastOrderId = lastOrder.id;

          // Wrap all writes in a single atomic transaction.
          // If any write throws, SQLite auto-rollbacks → checkpoint NOT advanced.
          const db = store.getDb();
          store.transaction(() => {
            // Insert all cost components
            for (const comp of allComponents) {
              store.insertCostComponent({
                sellerId: comp.sellerId,
                type: comp.type,
                amount: comp.amount,
                source: comp.source,
                ...(comp.sourceRecordId !== undefined
                  ? { sourceRecordId: comp.sourceRecordId }
                  : {}),
                occurredAt: comp.occurredAt,
                observedAt: comp.observedAt,
                verification: comp.verification,
                confidence: comp.confidence,
                ...(comp.metadata !== undefined ? { metadata: comp.metadata } : {}),
              });
            }

            // Insert all unit economics snapshots
            for (const snap of snapshots) {
              store.insertUnitEconomicsSnapshot(snap);
            }

            // Update run record to completed (sync helper — must be inside tx)
            syncUpdateRunInTx(db, run.runId, {
              status: "completed",
              completedAt: endTime,
              result: runResult,
            });

            // Update checkpoint (last statement inside transaction)
            syncUpdateCheckpointInTx(db, run.sellerId, checkpointData);
          });

          // If we got here, the transaction committed successfully
          run = transitionRun(run, "completed");
        } catch (persistErr) {
          const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);

          // Log the persistence failure
          console.error(
            JSON.stringify({
              event: "economic-ingestion-error",
              runId: run.runId,
              sellerId: config.sellerId,
              phase: "persist",
              error: msg,
              timestamp: new Date().toISOString(),
            }),
          );

          // Try to mark the run as failed (best-effort; may also fail)
          if (runStore) {
            try {
              await runStore.updateRun(run.runId, {
                status: "failed",
                completedAt: Date.now(),
                error: `Persistence failed: ${msg}`,
              });
            } catch {
              // Secondary write failed — log but don't block the throw
              console.error(
                JSON.stringify({
                  event: "economic-ingestion-error",
                  runId: run.runId,
                  sellerId: config.sellerId,
                  phase: "mark-failed",
                  error: "Could not mark run as failed after persistence error",
                  timestamp: new Date().toISOString(),
                }),
              );
            }
          }

          // Throw so CLI gets exit code 1
          throw new Error(`Persistence failed: ${msg}`);
        }
      }

      // 13. Reconcile
      const sourceTotals = {
        grossRevenue: fetched.orders.reduce(
          (sum, o) => sum + (o.status !== "cancelled" ? o.total_amount : 0),
          0,
        ),
        fees: fetched.orders.reduce((sum, o) => sum + (o.sale_fee_amount ?? 0), 0),
        shipping: fetched.orders.reduce(
          (sum, o) =>
            sum +
            (o.shipping_mode === "seller" ? (o.shipping_cost ?? 0) : 0),
          0,
        ),
        ads:
          fetched.orders.reduce((sum, o) => sum + (o.ad_cost ?? 0), 0) +
          fetched.ads.reduce((sum, a) => sum + a.cost, 0),
        refunds: fetched.orders.reduce(
          (sum, o) => sum + (o.refund_amount ?? 0),
          0,
        ),
      };
      const reconciliation = reconcileEconomics(sourceTotals, snapshots, 1);

      // 15. Emit metrics
      const elapsedMs = Date.now() - startTime;
      console.log(
        JSON.stringify({
          event: "economic-ingestion",
          runId: run.runId,
          sellerId: config.sellerId,
          mode: config.mode,
          transactions: transactions.length,
          components: allComponents.length,
          snapshots: snapshots.length,
          reconciliation: reconciliation.status,
          elapsedMs,
          dryRun: config.dryRun ?? false,
          timestamp: new Date().toISOString(),
        }),
      );

      // Build the final run record with updated counts
      const endTime = Date.now();
      const isTerminal = run.status === "completed" || run.status === "failed";
      const finalRunResult = createEconomicIngestionRun({
        ...(runIdFactory !== undefined ? { runIdFactory } : {}),
        sellerId: config.sellerId,
        mode: config.mode,
        sourceKinds: ["orders", "items", "claims", "ads"],
        startedAt: startTime,
        ...(isTerminal ? { completedAt: endTime } : {}),
        ...(run.checkpointAfter !== undefined
          ? { checkpointAfter: run.checkpointAfter }
          : {}),
        recordsFetched: fetched.orders.length + fetched.ads.length,
        recordsNormalized: transactions.length,
        componentsCreated: allComponents.length,
        snapshotsCreated: snapshots.length,
        duplicatesIgnored: 0,
        partialSnapshots: snapshots.filter(
          (s) => s.calculationStatus === "partial",
        ).length,
        disputedSnapshots: snapshots.filter(
          (s) => s.calculationStatus === "disputed",
        ).length,
        errors,
        status: run.status,
      });

      const finalRun = finalRunResult.success ? finalRunResult.run : run;

      return { run: finalRun, snapshots, reconciliation };
    } finally {
      // 16. Release lock
      releaseLock(config.sellerId);
    }
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);
    errors.push(errorMessage);

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

    // Always release lock on error
    releaseLock(config.sellerId);

    // Create a failed run record
    const failedRunResult = createEconomicIngestionRun({
      ...(runIdFactory !== undefined ? { runIdFactory } : {}),
      sellerId: config.sellerId,
      mode: config.mode,
      sourceKinds: ["orders", "items", "claims", "ads"],
      startedAt: startTime,
      completedAt: Date.now(),
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

    const run = failedRunResult.success
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

    return {
      run,
      snapshots: [],
      reconciliation: {
        status: "incomplete",
        details: `Pipeline failed: ${errorMessage}`,
      },
    };
  }
}
