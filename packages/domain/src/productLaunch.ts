import crypto from "node:crypto";

// ── State Machine ────────────────────────────────────────────────────

export type ProductLaunchStatus =
  | "photo_received"
  | "recognizing"
  | "researching"
  | "generating_creative"
  | "composing"
  | "awaiting_approval"
  | "approved"
  | "ready_to_publish"
  | "rejected";

/**
 * Valid state transitions for the product launch pipeline.
 * Terminal states (ready_to_publish, rejected) have no outgoing transitions.
 */
const VALID_TRANSITIONS: Record<ProductLaunchStatus, readonly ProductLaunchStatus[]> = {
  photo_received: ["recognizing"],
  recognizing: ["researching"],
  researching: ["generating_creative"],
  generating_creative: ["composing"],
  composing: ["awaiting_approval"],
  awaiting_approval: ["approved", "rejected"],
  approved: ["ready_to_publish"],
  ready_to_publish: [],
  rejected: [],
};

export type TransitionError = {
  type: "invalid_transition";
  from: ProductLaunchStatus;
  to: ProductLaunchStatus;
  message: string;
};

export function isValidTransition(from: ProductLaunchStatus, to: ProductLaunchStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed.includes(to);
}

export function transitionLaunch(
  launch: ProductLaunch,
  newState: ProductLaunchStatus,
  now?: string,
): ProductLaunch {
  const allowed = VALID_TRANSITIONS[launch.status];
  if (!allowed || allowed.length === 0) {
    throw new Error(
      `Cannot transition launch "${launch.launchId}" from terminal status "${launch.status}" to "${newState}"`,
    );
  }
  if (!(allowed as readonly string[]).includes(newState)) {
    throw new Error(
      `Invalid transition: "${launch.status}" → "${newState}". Allowed: ${allowed.join(", ")}`,
    );
  }

  const updated = {
    ...launch,
    status: newState,
    updatedAt: now ?? new Date().toISOString(),
  };

  if (newState === "ready_to_publish" || newState === "rejected") {
    (updated as Record<string, unknown>).completedAt = now ?? new Date().toISOString();
  }

  return updated;
}

// ── Domain Types ─────────────────────────────────────────────────────

export type ImageQualityDecision = "USE_AS_REFERENCE" | "REGENERATE" | "DISCARD_AND_SEARCH";

export type ImageQualityScore = {
  /** Overall quality score from 0 to 100. */
  score: number;
  /** Routing decision based on quality thresholds. */
  decision: ImageQualityDecision;
  /** Breakdown of individual dimension scores (resolution, background, lighting, focus). */
  dimensions?: {
    resolution: number;
    background: number;
    lighting: number;
    focus: number;
  };
};

export type ProductContext = {
  brand?: string;
  model?: string;
  color?: string;
  category?: string;
  attributes?: Record<string, string>;
  searchTerms?: string[];
};

export type ProductLaunch = {
  launchId: string;
  productId?: string;
  sellerId: string;
  status: ProductLaunchStatus;
  context: ProductContext;
  imageUrls: string[];
  photoPath?: string;
  caption?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type CreateProductLaunchInput = {
  launchId?: string;
  sellerId: string;
  productId?: string;
  photoPath?: string;
  caption?: string;
  context?: ProductContext;
};

export function createProductLaunch(input: CreateProductLaunchInput): ProductLaunch {
  const now = new Date().toISOString();
  const launch: ProductLaunch = {
    launchId: input.launchId ?? crypto.randomUUID(),
    sellerId: input.sellerId,
    status: "photo_received",
    context: input.context ?? {},
    imageUrls: [],
    createdAt: now,
    updatedAt: now,
  };
  if (input.productId) launch.productId = input.productId;
  if (input.photoPath) launch.photoPath = input.photoPath;
  if (input.caption) launch.caption = input.caption;
  return launch;
}
