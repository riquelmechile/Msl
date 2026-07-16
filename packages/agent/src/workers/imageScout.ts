import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";

// ── Environment helpers ─────────────────────────────────────────────

function env(name: string, fallback = ""): string {
  return (globalThis as Record<string, unknown>).process
    ? ((globalThis as typeof globalThis & { process: { env: Record<string, string | undefined> } })
        .process.env[name] ?? fallback)
    : fallback;
}

// ── Input / Output types ─────────────────────────────────────────────

export type ImageScoutInput = {
  /** Product brand name for search. */
  brand: string;
  /** Product model name for search. */
  model: string;
  /** Additional search terms to refine results. */
  searchTerms: string[];
};

export type ImageScoutOutput = {
  /** Found product image URLs from across the web. */
  imageUrls: Array<{
    url: string;
    source: string;
    width?: number;
    height?: number;
  }>;
};

// ── SerpApi Google Lens image search ──────────────────────────────────

const SERPAPI_BASE_URL = "https://serpapi.com/search";

async function searchGoogleLensImages(
  brand: string,
  model: string,
  searchTerms: string[],
): Promise<ImageScoutOutput> {
  const apiKey = env("SERPAPI_API_KEY");
  if (!apiKey) throw new Error("SERPAPI_API_KEY not set");

  const queryTerms = [brand, model, ...searchTerms].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    engine: "google_lens",
    q: queryTerms,
    type: "products",
    api_key: apiKey,
  });

  const response = await fetch(`${SERPAPI_BASE_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`SerpApi Google Lens request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  return parseSerpApiImageResults(data);
}

function parseSerpApiImageResults(data: Record<string, unknown>): ImageScoutOutput {
  const visualMatches = Array.isArray(data.visual_matches) ? data.visual_matches : [];
  const imageUrls: ImageScoutOutput["imageUrls"] = [];

  for (const match of visualMatches as Array<Record<string, unknown>>) {
    // Extract thumbnail/original URL
    const thumbnail = typeof match.thumbnail === "string" ? match.thumbnail : "";
    const original =
      typeof match.original === "string"
        ? match.original
        : typeof match.link === "string"
          ? match.link
          : "";

    const url = original || thumbnail;
    if (!url) continue;

    const source = typeof match.source === "string" ? match.source : "unknown";

    // Only include images with size info when available
    // SerpApi may provide dimensions in visual_matches via original_width/original_height
    const width =
      typeof match.original_width === "number"
        ? match.original_width
        : typeof match.width === "number"
          ? match.width
          : undefined;
    const height =
      typeof match.original_height === "number"
        ? match.original_height
        : typeof match.height === "number"
          ? match.height
          : undefined;

    imageUrls.push({ url, source, ...(width ? { width } : {}), ...(height ? { height } : {}) });
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const deduped: ImageScoutOutput["imageUrls"] = [];
  for (const entry of imageUrls) {
    if (!seen.has(entry.url)) {
      seen.add(entry.url);
      deduped.push(entry);
    }
  }

  return { imageUrls: deduped };
}

// ── Stub mode ────────────────────────────────────────────────────────

function stubSearch(input: ImageScoutInput): ImageScoutOutput {
  console.warn("[image-scout] SERPAPI_API_KEY not set — returning stub image URLs");

  const { brand, model } = input;
  const slug = `${brand}-${model}`.toLowerCase().replace(/\s+/g, "-");

  return {
    imageUrls: [
      { url: `https://http2.mlstatic.com/D_${slug}-1.jpg`, source: "mercadolibre.com" },
      { url: `https://http2.mlstatic.com/D_${slug}-2.jpg`, source: "mercadolibre.com" },
      { url: `https://m.media-amazon.com/images/I/${slug}-front.jpg`, source: "amazon.com" },
      { url: `https://example.com/images/${slug}-detail.jpg`, source: "example.com" },
    ],
  };
}

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Image Scout daemon handler.
 *
 * Processes creative-production messages from the agent bus.
 * Claims messages with `receiverAgentId: "creative-production"`.
 *
 * 1. Parse the claimed message payload as ImageScoutInput
 * 2. Search Google Lens via SerpApi for product images
 * 3. Return image URLs only — no downloading
 * 4. Enqueue result to creative-production lane
 */
export const imageScout: DaemonHandler = async ({
  claim,
  bus,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  // ── 1. Parse input ────────────────────────────────────────────
  let input: ImageScoutInput;
  try {
    input = JSON.parse(claim.payloadJson) as ImageScoutInput;
  } catch {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Image Scout: invalid payload — could not parse ImageScoutInput",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  if (!input.brand || !input.model) {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Image Scout: missing brand or model in payload",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 2. Search ─────────────────────────────────────────────────
  let output: ImageScoutOutput;
  try {
    output = await searchGoogleLensImages(input.brand, input.model, input.searchTerms ?? []);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("SERPAPI_API_KEY not set")) {
      // Stub mode
      output = stubSearch(input);
    } else {
      console.error(`[image-scout] SerpApi call failed: ${errorMessage}`);
      findings.push({
        kind: "alert",
        severity: "warning",
        summary: `Image Scout: search failed — ${errorMessage}`,
        evidenceIds: [claim.messageId],
      });
      return { findings, proposalEnqueued: false, messageIds };
    }
  }

  // ── 3. Enqueue result ─────────────────────────────────────────
  const resultPayload: Record<string, unknown> = {
    type: "finding",
    summary: `Image Scout: found ${output.imageUrls.length} image(s) for ${input.brand} ${input.model}`,
    imageScoutResult: output,
    brand: input.brand,
    model: input.model,
    noMutationExecuted: true,
    capturedAt: new Date().toISOString(),
  };

  const message = bus.enqueue({
    senderAgentId: "creative-production",
    receiverAgentId: "creative-production",
    messageType: "finding",
    payloadJson: JSON.stringify(resultPayload),
    dedupeKey: `image-scout-${claim.messageId}`,
  });
  messageIds.push(message.messageId);

  findings.push({
    kind: "opportunity",
    severity: "info",
    summary: `Image Scout: ${output.imageUrls.length} image(s) found for ${input.brand} ${input.model}`,
    evidenceIds: [claim.messageId, message.messageId],
  });

  return { findings, proposalEnqueued: true, messageIds };
};
