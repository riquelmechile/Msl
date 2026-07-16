import type { DaemonHandler } from "./daemonTypes.js";
import { copywriter } from "./copywriter.js";
import { specTechnician } from "./specTechnician.js";
import { qualityInspector } from "./qualityInspector.js";

/**
 * Listing Composition composite daemon handler.
 *
 * The `listing-composition` lane is shared between Copywriter, SpecTechnician,
 * and QualityInspector. This composite handler inspects the message payload
 * and dispatches to the appropriate specialist:
 *
 * - Messages with `sellerId` + `specs`: Copywriter (generate listing copy)
 * - Messages with `categoryId`: SpecTechnician (validate category attributes)
 * - Messages with `title` + `images`: QualityInspector (score listing quality)
 * - Default: Copywriter (most common entry point for composition)
 */
export const listingCompositionDaemon: DaemonHandler = async (ctx) => {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(ctx.claim.payloadJson) as Record<string, unknown>;
  } catch {
    // Unparseable — default to Copywriter which handles parse errors
  }

  if (payload.task === "quality-inspector") return qualityInspector(ctx);
  if (payload.task === "spec-technician") return specTechnician(ctx);
  if (payload.task === "copywriter") return copywriter(ctx);

  // Route to Copywriter when we have sellerId + specs
  if (typeof payload.sellerId === "string" && typeof payload.specs === "string") {
    return copywriter(ctx);
  }

  // Route to SpecTechnician when we have categoryId
  if (typeof payload.categoryId === "string") {
    return specTechnician(ctx);
  }

  // Route to QualityInspector when we have title + images
  if (typeof payload.title === "string" && Array.isArray(payload.images)) {
    return qualityInspector(ctx);
  }

  // Default: route to Copywriter (most common entry point)
  return copywriter(ctx);
};
