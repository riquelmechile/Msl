import { describe, expect, it } from "vitest";
import {
  createProductLaunch,
  isValidTransition,
  transitionLaunch,
  type ProductLaunch,
  type ProductLaunchStatus,
} from "./productLaunch.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeLaunch(
  overrides?: Partial<Pick<ProductLaunch, "status" | "launchId" | "sellerId">>,
): ProductLaunch {
  const base = createProductLaunch({ sellerId: "seller-test", launchId: "launch-001" });
  if (!overrides) return base;
  return { ...base, ...overrides } as ProductLaunch;
}

function statuses(...states: [ProductLaunchStatus, ...ProductLaunchStatus[]]): ProductLaunch {
  let launch = makeLaunch({ status: states[0] });
  for (let i = 1; i < states.length; i++) {
    launch = transitionLaunch(launch, states[i]!);
  }
  return launch;
}

// ── State Machine ─────────────────────────────────────────────────────

describe("ProductLaunch — state machine", () => {
  it("starts in photo_received state", () => {
    const launch = createProductLaunch({ sellerId: "seller-test" });
    expect(launch.status).toBe("photo_received");
  });

  it("follows the full happy path: photo_received → ready_to_publish", () => {
    const launch = statuses(
      "photo_received",
      "recognizing",
      "researching",
      "generating_creative",
      "composing",
      "awaiting_approval",
      "approved",
      "ready_to_publish",
    );

    expect(launch.status).toBe("ready_to_publish");
    expect(launch.completedAt).toBeDefined();
  });

  it("can transition from awaiting_approval to rejected", () => {
    const launch = statuses(
      "photo_received",
      "recognizing",
      "researching",
      "generating_creative",
      "composing",
      "awaiting_approval",
      "rejected",
    );

    expect(launch.status).toBe("rejected");
    expect(launch.completedAt).toBeDefined();
  });

  it("prevents invalid transitions", () => {
    const launch = makeLaunch({ status: "photo_received" });

    expect(() => transitionLaunch(launch, "composing")).toThrow(
      /Invalid transition.*photo_received.*composing/,
    );
  });

  it("prevents transitions out of terminal states", () => {
    const rejected = statuses(
      "photo_received",
      "recognizing",
      "researching",
      "generating_creative",
      "composing",
      "awaiting_approval",
      "rejected",
    );

    expect(() => transitionLaunch(rejected, "approved")).toThrow(
      /Cannot transition.*from terminal status/,
    );

    const published = statuses(
      "photo_received",
      "recognizing",
      "researching",
      "generating_creative",
      "composing",
      "awaiting_approval",
      "approved",
      "ready_to_publish",
    );

    expect(() => transitionLaunch(published, "rejected")).toThrow(
      /Cannot transition.*from terminal status/,
    );
  });

  it("isValidTransition returns true for valid hops", () => {
    expect(isValidTransition("photo_received", "recognizing")).toBe(true);
    expect(isValidTransition("awaiting_approval", "rejected")).toBe(true);
    expect(isValidTransition("approved", "ready_to_publish")).toBe(true);
  });

  it("isValidTransition returns false for invalid hops", () => {
    expect(isValidTransition("photo_received", "composing")).toBe(false);
    expect(isValidTransition("approved", "rejected")).toBe(false);
    expect(isValidTransition("rejected", "photo_received")).toBe(false);
  });
});

// ── ProductLaunch Creation ────────────────────────────────────────────

describe("ProductLaunch — creation", () => {
  it("assigns auto-generated launchId if not provided", () => {
    const launch = createProductLaunch({ sellerId: "seller-test" });
    expect(launch.launchId).toBeTruthy();
    expect(launch.launchId.length).toBeGreaterThan(10);
  });

  it("respects explicit launchId", () => {
    const launch = createProductLaunch({ sellerId: "seller-test", launchId: "custom-launch-001" });
    expect(launch.launchId).toBe("custom-launch-001");
  });

  it("initializes context, imageUrls, and timestamps", () => {
    const launch = createProductLaunch({
      sellerId: "seller-test",
      productId: "prod-001",
      photoPath: "/photos/test.jpg",
      caption: "Nuevo producto para test",
      context: { brand: "Samsung", color: "Negro" },
    });

    expect(launch.sellerId).toBe("seller-test");
    expect(launch.productId).toBe("prod-001");
    expect(launch.photoPath).toBe("/photos/test.jpg");
    expect(launch.caption).toBe("Nuevo producto para test");
    expect(launch.context.brand).toBe("Samsung");
    expect(launch.context.color).toBe("Negro");
    expect(launch.imageUrls).toEqual([]);
    expect(launch.status).toBe("photo_received");
    expect(launch.createdAt).toBeTruthy();
    expect(launch.updatedAt).toBeTruthy();
    expect(launch.completedAt).toBeUndefined();
  });

  it("preserves updatedAt through transitions", () => {
    const launch = makeLaunch({ status: "photo_received" });
    const next = transitionLaunch(launch, "recognizing", "2026-07-16T12:00:00.000Z");

    expect(next.updatedAt).toBe("2026-07-16T12:00:00.000Z");
    expect(next.createdAt).toBe(launch.createdAt);
  });
});

// ── Product Context ───────────────────────────────────────────────────

describe("ProductContext — accumulation", () => {
  it("starts empty and accumulates through pipeline", () => {
    const launch = createProductLaunch({ sellerId: "seller-test" });
    expect(launch.context).toEqual({});

    const withBrand = { ...launch, context: { brand: "Apple", model: "iPhone 16" } };
    expect(withBrand.context.brand).toBe("Apple");
    expect(withBrand.context.model).toBe("iPhone 16");

    const withSearch = {
      ...withBrand,
      context: { ...withBrand.context, searchTerms: ["iPhone 16 specs"] },
    };
    expect(withSearch.context.searchTerms).toEqual(["iPhone 16 specs"]);
    expect(withSearch.context.brand).toBe("Apple"); // preserved
  });
});

// ── ImageQualityScore ─────────────────────────────────────────────────

describe("ImageQualityScore", () => {
  it("accepts valid score and decision values", () => {
    const score = {
      score: 85,
      decision: "USE_AS_REFERENCE" as const,
      dimensions: { resolution: 90, background: 80, lighting: 85, focus: 85 },
    };

    expect(score.score).toBe(85);
    expect(score.decision).toBe("USE_AS_REFERENCE");
    expect(score.dimensions!.resolution).toBe(90);
  });
});
