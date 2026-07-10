import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import type { SupplierMirrorStore } from "@msl/memory";

// ── Feature flag ─────────────────────────────────────────────────────

function isOwnedEcommerceIntelligenceEnabled(): boolean {
  return process.env.MSL_OWNED_ECOMMERCE_INTELLIGENCE_ENABLED === "true";
}

// ── Signal kind constants ───────────────────────────────────────────

const SIGNAL_STOCK_GAP = "stock-gap";
const SIGNAL_PRICE_CHANGE = "price-change";
const SIGNAL_UNFILLED_MIRROR = "unfilled-mirror";

// ── Thresholds ──────────────────────────────────────────────────────

const PRICE_CHANGE_THRESHOLD = 0.05; // 5%

// ── Helpers ─────────────────────────────────────────────────────────

function buildIdempotencyKey(
  kind: string,
  supplierId: string,
  supplierItemId: string,
  hourKey: string,
): string {
  return `${kind}_${supplierId}_${supplierItemId}_${hourKey}`;
}

function buildDedupeKey(kind: string, capturedAt: string): string {
  return `supplier-${kind}-${capturedAt.slice(0, 13)}`;
}

/**
 * Build a dedupe key for supplier-web-signal messages enqueued to the
 * owned-ecommerce agent lane.  Format: sws:{supplierId}:{supplierItemId}:{signalKind}:{hourKey}
 */
function buildWebSignalDedupeKey(
  supplierId: string,
  supplierItemId: string,
  signalKind: string,
  hourKey: string,
): string {
  return `sws:${supplierId}:${supplierItemId}:${signalKind}:${hourKey}`;
}

function getPreviousHourKey(capturedAt: string): string {
  const d = new Date(capturedAt);
  d.setHours(d.getHours() - 1);
  return d.toISOString().slice(0, 13);
}

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Supplier Manager daemon handler.
 *
 * Reads SupplierMirrorStore data (supplier items, stock observations,
 * item mappings, sync ledger) and cross-references Cortex listing
 * snapshots to detect three signals:
 *
 * 1. Cross-account stock discrepancy (critical)
 * 2. Supplier price change >5% (warning)
 * 3. Unfilled mirror items (warning)
 *
 * Enqueues grouped CEO proposals with `noMutationExecuted: true`.
 * Deduplicates via sync_ledger idempotency keys.
 *
 * When MSL_OWNED_ECOMMERCE_INTELLIGENCE_ENABLED=true, additionally
 * enqueues supplier-web-signal messages to the owned-ecommerce lane
 * for 6 signal kinds: new-supplier-product, stock-gap, supplier-price-change,
 * supplier-stock-restored, supplier-stock-out, publish-opportunity.
 *
 * Graceful degrade: if `supplierMirrorStore` is undefined, returns
 * empty findings without error.
 */
export const supplierManagerDaemon: DaemonHandler = async ({
  claim: _claim, // eslint-disable-line @typescript-eslint/no-unused-vars
  reader: _reader, // eslint-disable-line @typescript-eslint/no-unused-vars
  cortex,
  bus,
  sellerIds: _sellerIds, // eslint-disable-line @typescript-eslint/no-unused-vars
  supplierMirrorStore,
  advisor,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];
  const now = new Date();
  const capturedAt = now.toISOString();
  const hourKey = capturedAt.slice(0, 13);
  const prevHourKey = getPreviousHourKey(capturedAt);

  // Store the latest aiEnrichment from a stock-gap advisor call
  let aiEnrichment:
    | {
        findings: Array<{
          kind: string;
          severity: string;
          summary: string;
          detail: string;
          evidenceIds: string[];
        }>;
        summary: string;
        modelUsed: string;
        enrichedAt: string;
      }
    | undefined;

  // ── Graceful degrade ─────────────────────────────────────────
  if (!supplierMirrorStore) {
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 1. Fetch enabled suppliers ───────────────────────────────
  let suppliers: Awaited<ReturnType<SupplierMirrorStore["listEnabledSuppliers"]>>;
  try {
    suppliers = await supplierMirrorStore.listEnabledSuppliers();
  } catch {
    return { findings, proposalEnqueued: false, messageIds };
  }

  if (suppliers.length === 0) {
    return { findings, proposalEnqueued: false, messageIds };
  }

  // Feature gate — skip owned-ecommerce signal enqueue entirely when off
  const ownedEcommerceEnabled = isOwnedEcommerceIntelligenceEnabled();

  // ── 2. Cross-reference: pre-fetch Cortex listing snapshots ───
  const listingByItemSeller = new Map<string, { sellerId: string; stock: number; price: number }>();
  try {
    const nodes = cortex.queryByMetadata({
      type: "listing_snapshot",
      limit: 5000,
    });
    for (const node of nodes) {
      const m = node.metadata;
      const itemId =
        typeof m.itemId === "string" ? m.itemId : typeof m.item_id === "string" ? m.item_id : "";
      const sellerId =
        typeof m.sellerId === "string"
          ? m.sellerId
          : typeof m.seller_id === "string"
            ? m.seller_id
            : "";
      if (!itemId || !sellerId) continue;
      listingByItemSeller.set(`${itemId}::${sellerId}`, {
        sellerId,
        stock: Number(m.stock ?? m.available_quantity ?? 0),
        price: Number(m.price ?? 0),
      });
    }
  } catch {
    // Cortex unavailable — cross-referencing will be partial
  }

  // ── Iterate suppliers ─────────────────────────────────────────
  for (const supplier of suppliers) {
    let items: Awaited<ReturnType<SupplierMirrorStore["listSupplierItemSnapshots"]>>;
    try {
      items = await supplierMirrorStore.listSupplierItemSnapshots(supplier.id);
    } catch {
      continue; // isolated per supplier
    }

    for (const item of items) {
      // ── Signal 1: Stock discrepancy (critical) ────────────────
      try {
        const mappings = await supplierMirrorStore.listTargetMappings(
          supplier.id,
          item.supplierItemId,
        );

        if (mappings.length >= 2) {
          // Group by seller — find stock for each mapped listing
          const sellerStock = new Map<string, { targetItemId: string; stock: number }>();

          for (const mapping of mappings) {
            const snapKey = `${mapping.targetItemId}::${mapping.targetSellerId}`;
            const snap = listingByItemSeller.get(snapKey);
            if (!snap) continue; // missing Cortex data — skip this seller
            sellerStock.set(mapping.targetSellerId, {
              targetItemId: mapping.targetItemId,
              stock: snap.stock,
            });
          }

          // Detect: one seller has stock > 0, another has stock === 0
          if (sellerStock.size >= 2) {
            const entries = [...sellerStock.entries()];
            const hasPositive = entries.some(([, s]) => s.stock > 0);
            const hasZero = entries.some(([, s]) => s.stock === 0);

            if (hasPositive && hasZero) {
              const inStock = entries.filter(([, s]) => s.stock > 0);
              const outOfStock = entries.filter(([, s]) => s.stock === 0);

              const key = buildIdempotencyKey(
                SIGNAL_STOCK_GAP,
                supplier.id,
                item.supplierItemId,
                hourKey,
              );

              const existing = await supplierMirrorStore.getLedgerByIdempotencyKey(key);
              if (!existing) {
                // ── [NEW] AI enrichment (stock-gap only, best-effort) ──
                if (advisor) {
                  try {
                    const analysis = await advisor.analyze({
                      supplierId: supplier.id,
                      supplierName: supplier.name,
                      question: `Stock discrepancy detected: ${item.title} (${item.supplierItemId}). In stock on: ${inStock.map(([s]) => s).join(", ")}. Out of stock on: ${outOfStock.map(([s]) => s).join(", ")}. Analyze the situation and provide actionable findings.`,
                    });
                    aiEnrichment = {
                      findings: analysis.findings.map((f) => ({
                        kind: f.kind,
                        severity: f.severity,
                        summary: f.summary,
                        detail: f.detail,
                        evidenceIds: f.evidenceIds,
                      })),
                      summary: analysis.summary,
                      modelUsed: analysis.modelUsed,
                      enrichedAt: capturedAt,
                    };
                  } catch (err) {
                    console.warn(
                      `[supplier-manager] Advisor enrichment failed for ${supplier.id}/${item.supplierItemId}:`,
                      err,
                    );
                    // Fall through — enrichment is best-effort; rule-only proposal still enqueued
                  }
                }

                findings.push({
                  kind: "alert",
                  severity: "critical",
                  summary: `Stock discrepancy: ${item.title} (${item.supplierItemId}) — in stock on [${inStock.map(([s]) => s).join(", ")}], out of stock on [${outOfStock.map(([s]) => s).join(", ")}]`,
                  evidenceIds: [
                    `supplier-item:${item.supplierItemId}`,
                    ...entries.map(([s]) => `listing_snapshot:${s}`),
                  ],
                });

                await supplierMirrorStore.appendLedger({
                  id: key,
                  actionType: "skip",
                  idempotencyKey: key,
                  status: "skipped",
                  reason: `Stock gap: ${inStock.length} in-stock, ${outOfStock.length} out-of-stock`,
                  supplierId: supplier.id,
                  supplierItemId: item.supplierItemId,
                  evidenceIds: [`supplier-item:${item.supplierItemId}`],
                  before: null,
                  after: null,
                  createdAt: capturedAt,
                });

                // ── Owned-ecommerce: stock-gap signal ──────────
                if (ownedEcommerceEnabled) {
                  const affectedSellerIds = entries.map(([s]) => s);
                  const evidenceIds = [
                    `supplier-item:${item.supplierItemId}`,
                    ...entries.map(([s]) => `listing_snapshot:${s}`),
                  ];
                  const webDedupeKey = buildWebSignalDedupeKey(
                    supplier.id,
                    item.supplierItemId,
                    "stock-gap",
                    hourKey,
                  );

                  const webMsg = bus.enqueue({
                    senderAgentId: "supplier-manager",
                    receiverAgentId: "owned-ecommerce",
                    messageType: "supplier-web-signal",
                    payloadJson: JSON.stringify({
                      type: "supplier-web-signal",
                      signalKind: "stock-gap",
                      supplierId: supplier.id,
                      supplierItemId: item.supplierItemId,
                      affectedSellerIds,
                      evidenceIds,
                      recommendedAction: "review-storefront-availability",
                      severity: "critical",
                      capturedAt,
                      noMutationExecuted: true,
                    }),
                    dedupeKey: webDedupeKey,
                  });
                  messageIds.push(webMsg.messageId);
                }
              }
            } else if (!hasZero && hasPositive) {
              // All sellers have stock > 0 → stock-restored
              const entries = [...sellerStock.entries()];

              if (ownedEcommerceEnabled) {
                const webDedupeKey = buildWebSignalDedupeKey(
                  supplier.id,
                  item.supplierItemId,
                  "supplier-stock-restored",
                  hourKey,
                );

                const webMsg = bus.enqueue({
                  senderAgentId: "supplier-manager",
                  receiverAgentId: "owned-ecommerce",
                  messageType: "supplier-web-signal",
                  payloadJson: JSON.stringify({
                    type: "supplier-web-signal",
                    signalKind: "supplier-stock-restored",
                    supplierId: supplier.id,
                    supplierItemId: item.supplierItemId,
                    affectedSellerIds: entries.map(([s]) => s),
                    evidenceIds: [
                      `supplier-item:${item.supplierItemId}`,
                      ...entries.map(([s]) => `listing_snapshot:${s}`),
                    ],
                    recommendedAction: "prepare-reactivation-review",
                    severity: "info",
                    capturedAt,
                    noMutationExecuted: true,
                  }),
                  dedupeKey: webDedupeKey,
                });
                messageIds.push(webMsg.messageId);
              }
            } else if (hasZero && !hasPositive) {
              // All sellers have stock === 0 → stock-out
              const entries = [...sellerStock.entries()];

              if (ownedEcommerceEnabled) {
                const webDedupeKey = buildWebSignalDedupeKey(
                  supplier.id,
                  item.supplierItemId,
                  "supplier-stock-out",
                  hourKey,
                );

                const webMsg = bus.enqueue({
                  senderAgentId: "supplier-manager",
                  receiverAgentId: "owned-ecommerce",
                  messageType: "supplier-web-signal",
                  payloadJson: JSON.stringify({
                    type: "supplier-web-signal",
                    signalKind: "supplier-stock-out",
                    supplierId: supplier.id,
                    supplierItemId: item.supplierItemId,
                    affectedSellerIds: entries.map(([s]) => s),
                    evidenceIds: [
                      `supplier-item:${item.supplierItemId}`,
                      ...entries.map(([s]) => `listing_snapshot:${s}`),
                    ],
                    recommendedAction: "prepare-availability-pause",
                    severity: "critical",
                    capturedAt,
                    noMutationExecuted: true,
                  }),
                  dedupeKey: webDedupeKey,
                });
                messageIds.push(webMsg.messageId);
              }
            }
          }
        }
      } catch {
        /* isolated */
      }

      // ── Signal 2: Price change >5% (warning) ─────────────────
      try {
        const currentPrice = item.price;
        const hasPrice = currentPrice !== undefined && currentPrice !== null;

        if (hasPrice) {
          // Hourly dedup — has this item already been checked this hour?
          const hourlyKey = buildIdempotencyKey(
            SIGNAL_PRICE_CHANGE,
            supplier.id,
            item.supplierItemId,
            hourKey,
          );
          const alreadyChecked = await supplierMirrorStore.getLedgerByIdempotencyKey(hourlyKey);

          if (!alreadyChecked) {
            // Look for the previous hour's record to get the prior price
            const prevKey = buildIdempotencyKey(
              SIGNAL_PRICE_CHANGE,
              supplier.id,
              item.supplierItemId,
              prevHourKey,
            );
            const prevRecord = await supplierMirrorStore.getLedgerByIdempotencyKey(prevKey);

            if (prevRecord && prevRecord.after) {
              const priorPrice = prevRecord.after.price;
              if (typeof priorPrice === "number" && priorPrice > 0) {
                const delta = Math.abs(currentPrice - priorPrice) / priorPrice;
                if (delta > PRICE_CHANGE_THRESHOLD) {
                  const direction = currentPrice > priorPrice ? "increase" : "decrease";
                  findings.push({
                    kind: "alert",
                    severity: "warning",
                    summary: `Price ${direction} >5%: ${item.title} (${item.supplierItemId}) — ${priorPrice} → ${currentPrice} (${(delta * 100).toFixed(1)}%)`,
                    evidenceIds: [`supplier-item:${item.supplierItemId}`],
                  });

                  // ── Owned-ecommerce: supplier-price-change ─────
                  if (ownedEcommerceEnabled) {
                    const webDedupeKey = buildWebSignalDedupeKey(
                      supplier.id,
                      item.supplierItemId,
                      "supplier-price-change",
                      hourKey,
                    );

                    const webMsg = bus.enqueue({
                      senderAgentId: "supplier-manager",
                      receiverAgentId: "owned-ecommerce",
                      messageType: "supplier-web-signal",
                      payloadJson: JSON.stringify({
                        type: "supplier-web-signal",
                        signalKind: "supplier-price-change",
                        supplierId: supplier.id,
                        supplierItemId: item.supplierItemId,
                        evidenceIds: [`supplier-item:${item.supplierItemId}`],
                        recommendedAction: "prepare-price-review",
                        severity: "warning",
                        capturedAt,
                        noMutationExecuted: true,
                      }),
                      dedupeKey: webDedupeKey,
                    });
                    messageIds.push(webMsg.messageId);
                  }
                }
              }
            }

            // Record this hour's price regardless of finding
            await supplierMirrorStore.appendLedger({
              id: hourlyKey,
              actionType: "skip",
              idempotencyKey: hourlyKey,
              status: "skipped",
              reason: prevRecord
                ? `Price check: current ${currentPrice}${
                    prevRecord.after && typeof prevRecord.after.price === "number"
                      ? `, prior ${prevRecord.after.price}`
                      : ""
                  }`
                : `First price observation: ${currentPrice}`,
              supplierId: supplier.id,
              supplierItemId: item.supplierItemId,
              evidenceIds: [`supplier-item:${item.supplierItemId}`],
              before: prevRecord?.after ?? null,
              after: { price: currentPrice },
              createdAt: capturedAt,
            });
          }
        }
      } catch {
        /* isolated */
      }

      // ── Signal 3: Unfilled mirror (warning) ───────────────────
      try {
        if (item.mlItemId) continue; // has MercadoLibre item ID — published

        const mappings = await supplierMirrorStore.listTargetMappings(
          supplier.id,
          item.supplierItemId,
        );
        if (mappings.length > 0) continue; // has mappings — will be published

        const key = buildIdempotencyKey(
          SIGNAL_UNFILLED_MIRROR,
          supplier.id,
          item.supplierItemId,
          hourKey,
        );

        const existing = await supplierMirrorStore.getLedgerByIdempotencyKey(key);
        if (!existing) {
          const evidenceIds = [`supplier-item:${item.supplierItemId}`];
          const hasEvidence = item.price !== undefined && item.price !== null;

          findings.push({
            kind: "alert",
            severity: "warning",
            summary: `Unfilled mirror: ${item.title} (${item.supplierItemId}) — no ml_item_id and no mappings`,
            evidenceIds,
          });

          await supplierMirrorStore.appendLedger({
            id: key,
            actionType: "skip",
            idempotencyKey: key,
            status: "skipped",
            reason: "Unfilled mirror item — no ml_item_id and no mappings",
            supplierId: supplier.id,
            supplierItemId: item.supplierItemId,
            evidenceIds,
            before: null,
            after: null,
            createdAt: capturedAt,
          });

          // ── Owned-ecommerce: new-supplier-product ──────────
          if (ownedEcommerceEnabled) {
            const webDedupeKey = buildWebSignalDedupeKey(
              supplier.id,
              item.supplierItemId,
              "new-supplier-product",
              hourKey,
            );

            // Missing critical evidence → collect-more-evidence, not aggressive proposal
            const recommendedAction: "prepare-storefront-candidate" | "collect-more-evidence" =
              hasEvidence ? "prepare-storefront-candidate" : "collect-more-evidence";

            const webMsg = bus.enqueue({
              senderAgentId: "supplier-manager",
              receiverAgentId: "owned-ecommerce",
              messageType: "supplier-web-signal",
              payloadJson: JSON.stringify({
                type: "supplier-web-signal",
                signalKind: "new-supplier-product",
                supplierId: supplier.id,
                supplierItemId: item.supplierItemId,
                evidenceIds,
                recommendedAction,
                severity: "warning",
                capturedAt,
                noMutationExecuted: true,
              }),
              dedupeKey: webDedupeKey,
            });
            messageIds.push(webMsg.messageId);
          }

          // ── Owned-ecommerce: publish-opportunity ───────────
          // When the item has enough evidence (price present) to be a real product
          if (ownedEcommerceEnabled && hasEvidence) {
            const pubDedupeKey = buildWebSignalDedupeKey(
              supplier.id,
              item.supplierItemId,
              "publish-opportunity",
              hourKey,
            );

            const pubMsg = bus.enqueue({
              senderAgentId: "supplier-manager",
              receiverAgentId: "owned-ecommerce",
              messageType: "supplier-web-signal",
              payloadJson: JSON.stringify({
                type: "supplier-web-signal",
                signalKind: "publish-opportunity",
                supplierId: supplier.id,
                supplierItemId: item.supplierItemId,
                evidenceIds,
                recommendedAction: "prepare-product-page",
                severity: "info",
                capturedAt,
                noMutationExecuted: true,
              }),
              dedupeKey: pubDedupeKey,
            });
            messageIds.push(pubMsg.messageId);
          }
        }
      } catch {
        /* isolated */
      }
    }
  }

  // ── CEO proposal enqueue (per severity tier) ──────────────────

  let proposalEnqueued = false;

  if (findings.length > 0) {
    const criticals = findings.filter((f) => f.severity === "critical");
    const warnings = findings.filter((f) => f.severity === "warning");

    const enqueueGroup = (group: DaemonFinding[], kind: string) => {
      if (group.length === 0) return;

      const summary = `Supplier ${kind}s: ${group.length} finding(s)`;
      const recommendedAction =
        kind === "critical"
          ? "Review stock discrepancies immediately — one seller has stock, another has zero"
          : "Review supplier price changes and unfilled mirror items";

      const msg = bus.enqueue({
        senderAgentId: "supplier-manager",
        receiverAgentId: "ceo",
        messageType: "proposal",
        payloadJson: JSON.stringify({
          type: "proposal",
          summary,
          findings: group.map((f) => ({
            kind: f.kind,
            severity: f.severity,
            summary: f.summary,
            evidenceIds: f.evidenceIds,
          })),
          recommendedAction,
          capturedAt,
          noMutationExecuted: true,
          // Only stock-gap (critical) proposals carry AI enrichment
          ...(kind === "critical" && aiEnrichment ? { aiEnrichment } : {}),
        }),
        dedupeKey: buildDedupeKey(kind, capturedAt),
      });
      messageIds.push(msg.messageId);
    };

    enqueueGroup(criticals, "critical");
    enqueueGroup(warnings, "warning");
    proposalEnqueued = true;
  }

  return {
    findings,
    proposalEnqueued,
    messageIds,
  };
};
