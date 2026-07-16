import type { DaemonHandler } from "./daemonTypes.js";
import { photoDirector } from "./photoDirector.js";
import { imageScout } from "./imageScout.js";
import { studioArtist } from "./studioArtist.js";

/**
 * Creative Production composite daemon handler.
 *
 * The `creative-production` lane is shared between PhotoDirector, ImageScout,
 * and StudioArtist. This composite handler inspects the message payload
 * and dispatches to the appropriate specialist:
 *
 * - Messages with `qualityDecision`: StudioArtist (post-quality-analysis)
 * - Messages with `brand` + `searchTerms`: ImageScout (search for product images)
 * - Default: PhotoDirector (analyze image quality)
 */
export const creativeProductionDaemon: DaemonHandler = async (ctx) => {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(ctx.claim.payloadJson) as Record<string, unknown>;
  } catch {
    // Unparseable — default to PhotoDirector which handles parse errors
  }

  if (payload.task === "studio-artist") return studioArtist(ctx);
  if (payload.task === "image-scout") return imageScout(ctx);
  if (payload.task === "photo-director") return photoDirector(ctx);

  // Route to StudioArtist when we have a quality decision
  if (typeof payload.qualityDecision === "string") {
    return studioArtist(ctx);
  }

  // Route to ImageScout when we have brand + searchTerms (product image search)
  if (typeof payload.brand === "string" && Array.isArray(payload.searchTerms)) {
    return imageScout(ctx);
  }

  // Default: route to PhotoDirector for image quality analysis
  return photoDirector(ctx);
};
