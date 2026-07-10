import type { DaemonHandler, DaemonFinding, DaemonResult } from "./daemonTypes.js";
import { isValidSupplierWebSignal } from "@msl/domain";
import type { SupplierWebSignalPayload } from "@msl/domain";
import type { AgentObservation } from "@msl/domain";
import crypto from "node:crypto";

// ── Feature flag ─────────────────────────────────────────────────────

function isOwnedEcommerceIntelligenceEnabled(): boolean {
  return process.env.MSL_OWNED_ECOMMERCE_INTELLIGENCE_ENABLED === "true";
}

// ── Thresholds ──────────────────────────────────────────────────────

const LOW_STOCK_THRESHOLD = 5;
const PRICE_DEVIATION_THRESHOLD = 0.2; // 20% above/below average

// ── Helpers ─────────────────────────────────────────────────────────

function envVal(key: string, fallback: number): number {
  const raw = typeof process !== "undefined" ? process.env?.[key] : undefined;
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Build a dedupe key for CEO proposals generated from supplier-web-signals.
 * Format: ceo-sws:{signalKind}:{supplierId}:{supplierItemId}:{hourKey}
 */
function buildCeoSignalDedupeKey(
  signalKind: string,
  supplierId: string,
  supplierItemId: string,
  hourKey: string,
): string {
  return `ceo-sws:${signalKind}:${supplierId}:${supplierItemId}:${hourKey}`;
}

// ── Monitor helpers (existing behavior) ──────────────────────────────

type ListingEntry = {
  itemId: string;
  sellerId: string;
  title: string;
  price: number;
  availableQuantity: number;
  thumbnail: string;
  categoryId: string;
};

async function detectFindings(
  reader: Parameters<DaemonHandler>[0]["reader"],
  sellerIds: string[],
  lowStockThreshold: number,
  priceDevThreshold: number,
): Promise<{ findings: DaemonFinding[]; allListings: ListingEntry[] }> {
  const findings: DaemonFinding[] = [];
  const allListings: ListingEntry[] = [];

  for (const sellerId of sellerIds) {
    try {
      const listingSnaps = await reader.searchSnapshots<{
        title?: string;
        price?: number;
        available_quantity?: number;
        availableQuantity?: number;
        thumbnail?: string;
        category_id?: string;
        categoryId?: string;
        status?: string;
      }>({ sellerId, kind: "listing_snapshot", status: "active", limit: 1000 });

      for (const snap of listingSnaps) {
        const d = snap.data;
        allListings.push({
          itemId: snap.itemId,
          sellerId,
          title: String(d.title ?? snap.itemId),
          price: Number(d.price ?? 0),
          availableQuantity: Number(d.available_quantity ?? d.availableQuantity ?? 0),
          thumbnail: String(d.thumbnail ?? ""),
          categoryId: String(d.category_id ?? d.categoryId ?? "unknown"),
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[owned-ecommerce] Failed to read listings for seller ${sellerId}: ${errorMessage}`,
      );
    }
  }

  // A. Missing / insufficient images
  for (const listing of allListings) {
    if (!listing.thumbnail || listing.thumbnail === "") {
      findings.push({
        kind: "alert",
        severity: "warning",
        summary: `Listing "${listing.title}" (${listing.itemId}) has no thumbnail image — storefront readiness issue`,
        evidenceIds: [`listing_snapshot:${listing.itemId}`, `seller:${listing.sellerId}`],
      });
    }
  }

  // B. Low stock
  for (const listing of allListings) {
    if (listing.availableQuantity > 0 && listing.availableQuantity < lowStockThreshold) {
      findings.push({
        kind: "alert",
        severity: "warning",
        summary: `Listing "${listing.title}" (${listing.itemId}) has low stock: ${listing.availableQuantity} units (threshold: ${lowStockThreshold})`,
        evidenceIds: [`listing_snapshot:${listing.itemId}`, `seller:${listing.sellerId}`],
      });
    }
  }

  // C. Price deviation
  const categoryPrices = new Map<string, number[]>();
  for (const listing of allListings) {
    const prices = categoryPrices.get(listing.categoryId) ?? [];
    prices.push(listing.price);
    categoryPrices.set(listing.categoryId, prices);
  }
  const categoryAvg = new Map<string, number>();
  for (const [cat, prices] of categoryPrices) {
    const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    categoryAvg.set(cat, avg);
  }

  for (const listing of allListings) {
    const avg = categoryAvg.get(listing.categoryId);
    if (avg && avg > 0 && listing.price > 0) {
      const deviation = Math.abs(listing.price - avg) / avg;
      if (deviation > priceDevThreshold) {
        const direction = listing.price > avg ? "above" : "below";
        findings.push({
          kind: "opportunity",
          severity: "info",
          summary: `Listing "${listing.title}" (${listing.itemId}) priced ${direction} category average by ${(deviation * 100).toFixed(0)}% — review for storefront readiness`,
          evidenceIds: [`listing_snapshot:${listing.itemId}`, `seller:${listing.sellerId}`],
        });
      }
    }
  }

  return { findings, allListings };
}

function enqueueMonitorProposals(
  findings: DaemonFinding[],
  capturedAt: string,
  bus: Parameters<DaemonHandler>[0]["bus"],
): { messageIds: string[]; proposalEnqueued: boolean } {
  const messageIds: string[] = [];
  let proposalEnqueued = false;

  if (findings.length > 0) {
    const warnings = findings.filter((f) => f.severity === "warning");
    const infos = findings.filter((f) => f.severity === "info");

    const enqueueGroup = (group: DaemonFinding[], kind: string) => {
      if (group.length === 0) return;

      const summary = `Owned Ecommerce ${kind}s: ${group.length} finding(s)`;
      const recommendedAction =
        kind === "warning"
          ? "Review and address listing issues — missing images and low stock affect storefront readiness"
          : "Review pricing deviations for storefront pricing strategy";

      const payloadJson: Record<string, unknown> = {
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
      };

      const message = bus.enqueue({
        senderAgentId: "owned-ecommerce",
        receiverAgentId: "ceo",
        messageType: "proposal",
        payloadJson: JSON.stringify(payloadJson),
        dedupeKey: `owned-ecommerce-${kind}-${capturedAt.slice(0, 13)}`,
      });
      messageIds.push(message.messageId);
    };

    enqueueGroup(warnings, "warning");
    enqueueGroup(infos, "opportunity");
    proposalEnqueued = true;
  }

  return { messageIds, proposalEnqueued };
}

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Owned Ecommerce daemon handler — dual-mode.
 *
 * **daemon-tick** messages (existing behavior):
 *   Monitor owned-ecommerce listings via `OperationalReadModelReader`.
 *   Detect missing images, low stock, price deviations. Enqueue CEO
 *   proposals with `noMutationExecuted: true`.
 *
 * **supplier-web-signal** messages (intelligence pipeline):
 *   Gated by `MSL_OWNED_ECOMMERCE_INTELLIGENCE_ENABLED`.
 *   Claim → validate → `intelligenceService.prepareFromSupplierWebSignal`
 *   → score → CEO proposal with `requiresApproval: true`.
 *   Deduplicates per signal kind + hour. Seller isolation enforced.
 *
 * All outputs: `noMutationExecuted: true`.
 */
export const ownedEcommerceDaemon: DaemonHandler = async ({
  claim,
  reader,
  cortex: _cortex, // eslint-disable-line @typescript-eslint/no-unused-vars
  bus,
  sellerIds,
  sessionStore,
  intelligenceService,
}) => {
  const capturedAt = new Date().toISOString();
  const hourKey = capturedAt.slice(0, 13);

  // ── Route: supplier-web-signal → intelligence pipeline ────────

  if (claim.messageType === "supplier-web-signal" && isOwnedEcommerceIntelligenceEnabled()) {
    return handleSupplierWebSignal({
      claim,
      bus,
      sellerIds,
      sessionStore,
      intelligenceService,
      capturedAt,
      hourKey,
    });
  }

  // ── Route: daemon-tick → monitor behavior ─────────────────────

  if (claim.messageType === "daemon-tick") {
    const lowStockThreshold = envVal(
      "MSL_OWNED_ECOMMERCE_LOW_STOCK_THRESHOLD",
      LOW_STOCK_THRESHOLD,
    );
    const priceDevThreshold = envVal(
      "MSL_OWNED_ECOMMERCE_PRICE_DEVIATION_THRESHOLD",
      PRICE_DEVIATION_THRESHOLD,
    );

    const { findings } = await detectFindings(
      reader,
      sellerIds,
      lowStockThreshold,
      priceDevThreshold,
    );

    const { messageIds, proposalEnqueued } = enqueueMonitorProposals(findings, capturedAt, bus);

    return { findings, proposalEnqueued, messageIds };
  }

  // ── Unknown message type → no-op ──────────────────────────────

  return { findings: [], proposalEnqueued: false, messageIds: [] };
};

// ── Supplier-web-signal handler ─────────────────────────────────────

function handleSupplierWebSignal({
  claim,
  bus,
  sellerIds: allSellerIds,
  sessionStore,
  intelligenceService,
  capturedAt,
  hourKey,
}: {
  claim: Parameters<DaemonHandler>[0]["claim"];
  bus: Parameters<DaemonHandler>[0]["bus"];
  sellerIds: string[];
  sessionStore: Parameters<DaemonHandler>[0]["sessionStore"];
  intelligenceService: Parameters<DaemonHandler>[0]["intelligenceService"];
  capturedAt: string;
  hourKey: string;
}): DaemonResult {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  // 1. Parse and validate the signal payload
  let signal: SupplierWebSignalPayload;
  try {
    const raw = JSON.parse(claim.payloadJson) as unknown;
    if (!isValidSupplierWebSignal(raw)) {
      // Invalid signal — log and skip
      console.warn(
        `[owned-ecommerce] Invalid supplier-web-signal payload on message ${claim.messageId}`,
      );
      return { findings: [], proposalEnqueued: false, messageIds: [] };
    }
    signal = raw;
  } catch {
    console.warn(
      `[owned-ecommerce] Failed to parse supplier-web-signal payload on message ${claim.messageId}`,
    );
    return { findings: [], proposalEnqueued: false, messageIds: [] };
  }

  // 2. Intelligence service not available → skip intelligence,
  //    but still record observation
  if (!intelligenceService) {
    if (sessionStore) {
      recordSignalObservation(sessionStore, signal, "owned-ecommerce");
    }
    console.warn(
      `[owned-ecommerce] Intelligence service unavailable — skipping intelligence pipeline for signal ${signal.signalKind}/${signal.supplierItemId}`,
    );
    return { findings: [], proposalEnqueued: false, messageIds: [] };
  }

  // 3. Process through intelligence pipeline (seller-isolated)
  const affectedSellers = signal.affectedSellerIds ?? allSellerIds;
  let proposalEnqueued = false;

  for (const sellerId of affectedSellers) {
    try {
      const result = intelligenceService.prepareFromSupplierWebSignal(signal, sellerId);

      // 4. Record work-session observation (F3)
      if (sessionStore) {
        recordSignalObservation(sessionStore, signal, sellerId);
      }

      // 5. Build CEO proposal from intelligence result
      const candidate = result.candidates[0];
      const score = candidate ? result.scores[candidate.id] : undefined;

      const recommendedAction = score?.recommendedAction ?? signal.recommendedAction;
      const confidence = score?.confidence ?? "medium";
      const blockers = score?.blockers ?? [];
      const strengths = score?.strengths ?? [];
      const warnings = score?.warnings ?? [];

      // Build evidence list for the proposal
      const evidenceIds: string[] = [...signal.evidenceIds];
      if (candidate) {
        evidenceIds.push(...candidate.evidenceIds);
      }
      if (result.projection) {
        evidenceIds.push(...result.projection.evidenceIds);
      }

      // Record lesson for blocked candidates (F3)
      if (sessionStore && blockers.length > 0 && candidate) {
        recordBlockedLesson(
          sessionStore,
          sellerId,
          candidate.id,
          blockers.join("; "),
          "owned-ecommerce",
        );
      }

      // Build the proposal summary
      const signalSummary = `Owned Ecommerce Intelligence: ${signal.signalKind} from supplier ${signal.supplierId}`;
      const actionSummary =
        blockers.length > 0
          ? `Blocked: ${blockers.join(", ")}`
          : warnings.length > 0
            ? `Needs review: ${warnings.join(", ")}`
            : `Ready: ${strengths.join(", ")}`;

      const dedupeKey = buildCeoSignalDedupeKey(
        signal.signalKind,
        signal.supplierId,
        signal.supplierItemId,
        hourKey,
      );

      const ceoMessage = bus.enqueue({
        senderAgentId: "owned-ecommerce",
        receiverAgentId: "ceo",
        messageType: "proposal",
        payloadJson: JSON.stringify({
          type: "proposal",
          source: "supplier-web-signal",
          signalKind: signal.signalKind,
          supplierId: signal.supplierId,
          supplierItemId: signal.supplierItemId,
          sellerId,
          summary: signalSummary,
          recommendedAction,
          confidence,
          score: score?.score ?? 0,
          blockers,
          strengths,
          warnings,
          missingEvidence: score?.missingEvidence ?? [],
          actionSummary,
          evidenceIds: [...new Set(evidenceIds)],
          candidateIds: result.candidates.map((c) => c.id),
          cortexUnavailable: result.cortexUnavailable === true,
          errors: result.errors,
          capturedAt,
          noMutationExecuted: true,
          requiresApproval: true,
        }),
        dedupeKey,
        sellerId,
      });
      messageIds.push(ceoMessage.messageId);

      // Link proposal to work session (F3)
      if (sessionStore) {
        try {
          // Use an ephemeral session link — the session store handles
          // linking proposals to whichever session is active for this seller+agent
          const sessions = sessionStore.listRecentSessionsByAgent(sellerId, "owned-ecommerce", 1);
          if (sessions.length > 0) {
            const activeSession = sessions[0];
            if (activeSession && activeSession.status === "running") {
              sessionStore.addProposalLink(activeSession.sessionId, ceoMessage.messageId, sellerId);
            }
          }
        } catch {
          // Session store unavailable — continue silently
        }
      }

      proposalEnqueued = true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[owned-ecommerce] Intelligence pipeline failed for seller ${sellerId}, signal ${signal.signalKind}: ${errorMessage}`,
      );
      // Isolated per seller — continue to next seller
    }
  }

  return { findings, proposalEnqueued, messageIds };
}

// ── Work session helpers (F3) ───────────────────────────────────────

function recordSignalObservation(
  store: NonNullable<Parameters<DaemonHandler>[0]["sessionStore"]>,
  signal: SupplierWebSignalPayload,
  sellerId: string,
): void {
  try {
    const observation: AgentObservation = {
      observationId: crypto.randomUUID(),
      sellerId,
      agentId: "owned-ecommerce",
      sessionId: "", // Will be filled by daemon scheduler's session awareness
      kind: "new_signal",
      summary: `Supplier web signal: ${signal.signalKind} for ${signal.supplierId}/${signal.supplierItemId}`,
      severity: signal.severity,
      metadataJson: JSON.stringify({
        signalKind: signal.signalKind,
        supplierId: signal.supplierId,
        supplierItemId: signal.supplierItemId,
        evidenceIds: signal.evidenceIds,
        noMutationExecuted: true,
      }),
    };
    store.addObservation(observation);
  } catch {
    // Store unavailable — continue silently
  }
}

function recordBlockedLesson(
  store: NonNullable<Parameters<DaemonHandler>[0]["sessionStore"]>,
  sellerId: string,
  candidateId: string,
  reason: string,
  agentId: string,
): void {
  try {
    store.addLesson({
      lessonId: crypto.randomUUID(),
      sellerId,
      agentId,
      sessionId: "",
      lesson: `Candidate ${candidateId} blocked: ${reason}`,
      transferable: true,
      learnedAt: new Date().toISOString(),
    });
  } catch {
    // Store unavailable — continue silently
  }
}
