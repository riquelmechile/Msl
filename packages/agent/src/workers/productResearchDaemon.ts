import type { DaemonHandler } from "./daemonTypes.js";
import { catalogSpecialist } from "./catalogSpecialist.js";
import { marketResearcher } from "./marketResearcher.js";

/**
 * Product Research composite daemon handler.
 *
 * The `product-research` lane is shared between CatalogSpecialist and
 * MarketResearcher. This composite handler inspects the message payload
 * and dispatches to the appropriate specialist:
 *
 * - Messages with `brand`, `model`, `title` (no `searchTerms`): CatalogSpecialist
 * - Messages with `brand`, `model`, `searchTerms`: MarketResearcher
 * - Other message types: fall through via market researcher
 */
export const productResearchDaemon: DaemonHandler = async (ctx) => {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(ctx.claim.payloadJson) as Record<string, unknown>;
  } catch {
    // Unparseable — let market researcher handle the error
  }

  if (payload.task === "catalog-specialist") return catalogSpecialist(ctx);
  if (payload.task === "market-researcher") return marketResearcher(ctx);

  // Route to CatalogSpecialist when we have title but no searchTerms
  const hasCatalogInput =
    typeof payload.brand === "string" &&
    typeof payload.model === "string" &&
    typeof payload.title === "string" &&
    !Array.isArray(payload.searchTerms);

  if (hasCatalogInput) {
    return catalogSpecialist(ctx);
  }

  // Otherwise route to MarketResearcher (which handles brand+model+searchTerms,
  // and also handles messages forwarded from catalog results)
  return marketResearcher(ctx);
};
