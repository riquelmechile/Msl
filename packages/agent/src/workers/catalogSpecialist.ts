import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import type { MlcApiClient, MlcListingSummary } from "@msl/mercadolibre";
import { enqueueProductLaunchResult, parseProductLaunchEnvelope } from "./productLaunchEnvelope.js";

// ── Input / Output types ─────────────────────────────────────────────

export type CatalogSpecialistInput = {
  brand: string;
  model: string;
  title: string;
  sellerId?: string;
};

export type CatalogSpecialistOutput = {
  catalogProductId?: string;
  catalogDomain?: string;
  found: boolean;
};

// ── ML Catalog search ────────────────────────────────────────────────

/**
 * Search ML catalog for a product matching brand, model, and title.
 *
 * NOTE: Currently uses getListings + getItem to extract catalog_product_id
 * from the seller's own active listings. A product never listed before will
 * never be found this way. The proper approach is MercadoLibre's catalog
 * product search (e.g. GET /products/search?q=... or
 * GET /sites/MLC/domainDiscovery). The MlcApiClient does not yet expose a
 * catalog-search method — when available, replace this implementation with
 * a direct catalog query to find products by their title/GTIN in the ML
 * global product catalog.
 */
async function searchMlCatalog(
  input: CatalogSpecialistInput,
  mlcClient: MlcApiClient,
  sellerId: string,
): Promise<CatalogSpecialistOutput> {
  const siteId = "MLC";

  try {
    const listings = await mlcClient.getListings(sellerId, {
      status: "active",
    });

    const data = Array.isArray(listings.data) ? listings.data : [listings.data];
    const summaries = data as ReadonlyArray<MlcListingSummary>;

    const lowerBrand = input.brand.toLowerCase();
    const lowerModel = input.model.toLowerCase();

    // Find summaries whose title contains both brand and model
    const matchingSummaries = summaries.filter(
      (s) =>
        s.title &&
        s.title.toLowerCase().includes(lowerBrand) &&
        s.title.toLowerCase().includes(lowerModel),
    );

    if (matchingSummaries.length > 0) {
      // Fetch full item detail for the best match to extract catalog_product_id
      try {
        const bestMatch = matchingSummaries[0]!;
        const item = await mlcClient.getItem(sellerId, bestMatch.id);
        const catalogProductId = (item as Record<string, unknown>).catalog_product_id as
          string | undefined;
        if (catalogProductId) {
          return {
            catalogProductId,
            catalogDomain: siteId,
            found: true,
          };
        }
      } catch {
        // getItem may fail — fall through to fuzzy search
      }
    }

    // Fuzzy search on all items + getItem for first match with potential catalog ID
    for (const summary of summaries) {
      const title = summary.title?.toLowerCase() ?? "";
      if (
        title.includes(lowerBrand) ||
        title.includes(lowerModel) ||
        title.includes(input.title.toLowerCase())
      ) {
        try {
          const item = await mlcClient.getItem(sellerId, summary.id);
          const catalogProductId = (item as Record<string, unknown>).catalog_product_id as
            string | undefined;
          if (catalogProductId) {
            return {
              catalogProductId,
              catalogDomain: siteId,
              found: true,
            };
          }
        } catch {
          // Continue to next match
        }
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[catalog-specialist] ML search failed: ${errorMessage}`);
  }

  return { found: false };
}

// ── Stub mode ────────────────────────────────────────────────────────

function stubCatalogSearch(_input: CatalogSpecialistInput): CatalogSpecialistOutput {
  console.warn("[catalog-specialist] mlcClient not available — returning stub (not found)");
  return { found: false };
}

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Catalog Specialist daemon handler.
 *
 * Processes product-research messages from the agent bus.
 * Claims messages with `receiverAgentId: "product-research"`.
 *
 * 1. Parse the claimed message payload as CatalogSpecialistInput
 * 2. Search ML catalog for matching catalog_product_id
 * 3. Return findings with catalog product details or not-found
 */
export const catalogSpecialist: DaemonHandler = async ({ claim, bus, sellerIds, mlcClient }) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  // ── 1. Parse input ────────────────────────────────────────────
  let input: CatalogSpecialistInput;
  try {
    input = JSON.parse(claim.payloadJson) as CatalogSpecialistInput;
  } catch {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Catalog Specialist: invalid payload — could not parse CatalogSpecialistInput",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }
  const parsedLaunchEnvelope = parseProductLaunchEnvelope(claim);
  if (parsedLaunchEnvelope) {
    input.title = `${input.brand ?? ""} ${input.model ?? ""}`.trim();
    input.sellerId = parsedLaunchEnvelope.sellerId;
  }

  // ── 2. Search catalog ─────────────────────────────────────────
  let output: CatalogSpecialistOutput;
  const launchEnvelope = parsedLaunchEnvelope;
  const sellerId = launchEnvelope?.sellerId ?? input.sellerId ?? sellerIds[0] ?? "default";

  if (mlcClient) {
    output = await searchMlCatalog(input, mlcClient, sellerId);
  } else {
    output = stubCatalogSearch(input);
  }

  if (launchEnvelope) {
    const message = enqueueProductLaunchResult(bus, claim, launchEnvelope, {
      ...(output.catalogProductId ? { catalogProductId: output.catalogProductId } : {}),
    });
    messageIds.push(message.messageId);
    findings.push({
      kind: output.found ? "opportunity" : "info",
      severity: output.found ? "info" : "warning",
      summary: output.found
        ? `Catalog Specialist: found ${output.catalogProductId ?? ""}`
        : `Catalog Specialist: not found for ${input.brand} ${input.model}`,
      evidenceIds: [claim.messageId, message.messageId],
    });
    return { findings, proposalEnqueued: true, messageIds };
  }

  // ── 3. Enqueue result ─────────────────────────────────────────
  const payload: Record<string, unknown> = {
    type: "finding",
    summary: output.found
      ? `Catalog Specialist: found catalog product ${output.catalogProductId ?? ""} for ${input.brand} ${input.model}`
      : `Catalog Specialist: no catalog product found for ${input.brand} ${input.model}`,
    catalogResult: output,
    input: { brand: input.brand, model: input.model, title: input.title },
    nextAction: "market_research",
    noMutationExecuted: true,
    capturedAt: new Date().toISOString(),
  };

  // Enqueue result back to the product-research lane for MarketResearcher to pick up
  const message = bus.enqueue({
    senderAgentId: "product-research",
    receiverAgentId: "product-research",
    messageType: "catalog-result",
    payloadJson: JSON.stringify(payload),
    dedupeKey: `catalog-specialist-${claim.messageId}`,
  });
  messageIds.push(message.messageId);

  findings.push({
    kind: output.found ? "opportunity" : "info",
    severity: output.found ? "info" : "warning",
    summary: output.found
      ? `Catalog Specialist: found ${output.catalogProductId ?? ""} for ${input.brand} ${input.model}`
      : `Catalog Specialist: not found for ${input.brand} ${input.model}`,
    evidenceIds: [claim.messageId, message.messageId],
  });

  return { findings, proposalEnqueued: true, messageIds };
};
