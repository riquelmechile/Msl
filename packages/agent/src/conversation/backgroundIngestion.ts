import type { GraphEngine } from "@msl/memory";
import type { MlcApiClient, MlcListingSummary, MlcVisitsDetail } from "@msl/mercadolibre";

// ── Types ──────────────────────────────────────────────────────────────

export type BackgroundIngestionConfig = {
  mlcClient: MlcApiClient;
  engine: GraphEngine;
  sendProactiveMessage: (chatId: number, text: string) => Promise<void>;
  listActiveChats: () => Promise<number[]>;
  sellerIds: string[];
  /** Interval in milliseconds between ingestion runs. Default: 6 hours. */
  intervalMs?: number;
};

// ── Helpers ────────────────────────────────────────────────────────────

function todayLabel(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeListings(
  data: ReadonlyArray<MlcListingSummary> | MlcListingSummary,
): ReadonlyArray<MlcListingSummary> {
  if (Array.isArray(data)) return data;
  return [data as MlcListingSummary];
}

function normalizeVisitsDetail(
  detail: MlcVisitsDetail[] | undefined,
): ReadonlyArray<MlcVisitsDetail> {
  return detail ?? [];
}

// ── Worker ─────────────────────────────────────────────────────────────

/**
 * Start a background ingestion worker that periodically syncs all listings
 * into Cortex and detects anomalies (pauses, reactivations, price changes,
 * visit spikes/drops).
 *
 * Returns a `stop` handle to cancel the interval timer.
 */
export function startBackgroundIngestion(
  config: BackgroundIngestionConfig,
): { stop: () => void } {
  const intervalMs = config.intervalMs ?? 6 * 60 * 60 * 1000; // 6 hours

  const run = async () => {
    const runStart = Date.now();
    let totalListings = 0;
    const alerts: string[] = [];

    for (const sellerId of config.sellerIds) {
      try {
        // ── Fetch all listings ────────────────────────────────
        const snapshot = await config.mlcClient.getListings(sellerId);
        const listings = normalizeListings(snapshot.data);

        for (const listing of listings) {
          totalListings++;
          const itemId = listing.id;

          if (!itemId) continue;

          const capturedAt = new Date().toISOString();
          const snapshotLabel = `listing_snapshot_${itemId}_${todayLabel()}`;

          // ── Create snapshot node ─────────────────────────────
          config.engine.getOrCreateNode(snapshotLabel, {
            type: "listing_snapshot",
            itemId,
            title: listing.title ?? "",
            price: listing.price ?? 0,
            currencyId: listing.currencyId ?? "CLP",
            status: listing.status ?? "unknown",
            categoryId: listing.categoryId ?? "",
            listingTypeId: listing.listingTypeId ?? "",
            capturedAt,
          });

          // ── Find previous snapshot for comparison ────────────
          const previousSnapshots = config.engine.queryByMetadata({
            type: "listing_snapshot",
            itemId,
            limit: 2, // Get last 2 so we can compare with the one just before
          });

          // Previous snapshot is index 1 (index 0 is the one we just created)
          const prevSnapshot =
            previousSnapshots.length >= 2 ? previousSnapshots[1] : null;

          if (prevSnapshot?.metadata) {
            const prevMeta = prevSnapshot.metadata as Record<string, unknown>;

            // ── Detect paused with sales history ───────────────
            const newStatus = listing.status ?? "unknown";
            const prevStatus = String(prevMeta.status ?? "unknown");
            const salesCount = Number(prevMeta.salesCount ?? 0);

            if (
              newStatus === "paused" &&
              prevStatus !== "paused" &&
              salesCount > 0
            ) {
              alerts.push(
                `${itemId} se pausó. Tenía ${salesCount} ventas — ¿reutilizar?`,
              );
            }

            // ── Detect reactivation ────────────────────────────
            if (
              newStatus === "active" &&
              prevStatus === "paused"
            ) {
              alerts.push(`${itemId} volvió a activarse`);
            }

            // ── Detect significant price change (>20%) ─────────
            const newPrice = listing.price ?? 0;
            const prevPrice = Number(prevMeta.price ?? 0);
            if (prevPrice > 0 && newPrice > 0) {
              const change = Math.abs(newPrice - prevPrice) / prevPrice;
              if (change > 0.2) {
                const direction = newPrice > prevPrice ? "subió" : "bajó";
                const pct = Math.round(change * 100);
                alerts.push(
                  `${itemId} ${direction} de precio en ${pct}% (${prevPrice} → ${newPrice})`,
                );
              }
            }
          }

          // ── Visits snapshot ──────────────────────────────────
          if (typeof config.mlcClient.getItemVisits === "function") {
            try {
              const visitsSnapshot = await config.mlcClient.getItemVisits(
                sellerId,
                itemId,
              );
              const visitsSummary = Array.isArray(visitsSnapshot.data)
                ? visitsSnapshot.data[0]
                : visitsSnapshot.data;

              if (visitsSummary) {
                const detail = normalizeVisitsDetail(visitsSummary.visitsDetail);
                const totalVisits = visitsSummary.totalVisits ?? 0;

                const visitLabel = `visit_snapshot_${itemId}_${todayLabel()}`;
                config.engine.getOrCreateNode(visitLabel, {
                  type: "visit_snapshot",
                  itemId,
                  totalVisits,
                  visitsDetail: detail,
                  capturedAt,
                });

                // ── Detect visit anomalies ─────────────────────
                const previousVisits = config.engine.queryByMetadata({
                  type: "visit_snapshot",
                  itemId,
                  limit: 2,
                });

                const prevVisit =
                  previousVisits.length >= 2 ? previousVisits[1] : null;

                if (prevVisit?.metadata) {
                  const prevVisitMeta = prevVisit.metadata as Record<
                    string,
                    unknown
                  >;
                  const prevTotal = Number(prevVisitMeta.totalVisits ?? 0);

                  if (prevTotal > 0) {
                    const visitChange =
                      (totalVisits - prevTotal) / prevTotal;

                    if (visitChange > 0.5) {
                      const pct = Math.round(visitChange * 100);
                      alerts.push(
                        `📈 ${itemId} +${pct}% visitas esta semana. ¿Aumentar precio?`,
                      );
                    } else if (visitChange < -0.5) {
                      const pct = Math.round(Math.abs(visitChange) * 100);
                      alerts.push(
                        `📉 ${itemId} -${pct}% visitas. ¿Revisar título/fotos/ads?`,
                      );
                    }
                  }
                }
              }
            } catch {
              // Visits unavailable for this item — skip silently
            }
          }
        }
      } catch (err) {
        console.error(
          `[background-ingestion] Failed to fetch listings for seller ${sellerId}:`,
          err instanceof Error ? err.message : String(err),
        );
        // Skip this seller cycle, retry next interval
      }
    }

    // ── Send proactive alerts to all active chats ──────────────
    if (alerts.length > 0) {
      try {
        const chatIds = await config.listActiveChats();
        const alertMessage =
          `🔔 <b>Alerta de catálogo — ${todayLabel()}</b>\n\n` +
          alerts.map((a) => `• ${a}`).join("\n");

        for (const chatId of chatIds) {
          try {
            await config.sendProactiveMessage(chatId, alertMessage);
          } catch (err) {
            console.error(
              `[background-ingestion] Failed to send alert to chat ${chatId}:`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      } catch (err) {
        console.error(
          "[background-ingestion] Failed to list or message active chats:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const duration = Date.now() - runStart;
    console.log(
      `[background-ingestion] Ingestion complete: ${totalListings} listings, ` +
        `${alerts.length} alerts sent (${duration}ms)`,
    );
  };

  // Run immediately on start, then on interval
  void run();

  const interval = setInterval(() => {
    void run();
  }, intervalMs);

  return {
    stop: () => {
      clearInterval(interval);
      console.log("[background-ingestion] Stopped");
    },
  };
}
