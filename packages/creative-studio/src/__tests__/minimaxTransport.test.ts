import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MinimaxFakeTransport,
  MinimaxFixtureTransport,
  MinimaxRealTransport,
  type MinimaxImageResponse,
} from "../infrastructure/providers/minimax/minimaxTransport.js";
import {
  classifyMinimaxError,
  MinimaxRequestError,
} from "../infrastructure/providers/minimax/minimaxErrors.js";
import { MinimaxClient } from "../infrastructure/providers/minimax/minimax-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helper: assert no real fetch calls ────────────────────────────────

function assertNoFetchCalls() {
  expect(vi.mocked(fetch)).not.toHaveBeenCalled();
}

// ── MinimaxFakeTransport tests ────────────────────────────────────────

describe("MinimaxFakeTransport", () => {
  it("returns deterministic image response", async () => {
    vi.spyOn(globalThis, "fetch");
    const transport = new MinimaxFakeTransport();
    const result = await transport.createImageTask({
      model: "image-01",
      prompt: "A beautiful product shot",
    });

    expect(result.base_resp.status_code).toBe(0);
    expect(result.data[0]?.image_url).toBe("https://fake-cdn.minimax.io/img/001.jpg");
    assertNoFetchCalls();
  });

  it("returns deterministic video response", async () => {
    vi.spyOn(globalThis, "fetch");
    const transport = new MinimaxFakeTransport();
    const result = await transport.createVideoTask({
      model: "MiniMax-Hailuo-2.3-Fast",
      prompt: "Product video",
      duration: 6,
    });

    expect(result.base_resp.status_code).toBe(0);
    expect(result.task_id).toBe("fake-task-001");
    assertNoFetchCalls();
  });

  it("returns deterministic video query response", async () => {
    vi.spyOn(globalThis, "fetch");
    const transport = new MinimaxFakeTransport();
    const result = await transport.queryVideoTask("any-task-id");

    expect(result.base_resp.status_code).toBe(0);
    expect(result.status).toBe("success");
    expect(result.file_id).toBe("fake-file-001");
    assertNoFetchCalls();
  });

  it("accepts overrides in constructor", async () => {
    vi.spyOn(globalThis, "fetch");
    const customImage: MinimaxImageResponse = {
      base_resp: { status_code: 0, status_message: "ok" },
      data: [{ image_url: "https://custom.img/1.jpg" }],
    };

    const transport = new MinimaxFakeTransport({ imageResponse: customImage });
    const result = await transport.createImageTask({
      model: "image-01",
      prompt: "test",
    });

    expect(result.data[0]?.image_url).toBe("https://custom.img/1.jpg");
  });
});

// ── MinimaxFixtureTransport tests ─────────────────────────────────────

describe("MinimaxFixtureTransport", () => {
  it("matches image fixtures by key", async () => {
    vi.spyOn(globalThis, "fetch");
    const transport = new MinimaxFixtureTransport({
      images: {
        "image:image-01:A beautiful product shot": {
          base_resp: { status_code: 0, status_message: "success" },
          data: [{ image_url: "https://fixture.img/fixture-1.jpg" }],
        },
      },
    });

    const result = await transport.createImageTask({
      model: "image-01",
      prompt: "A beautiful product shot",
    });

    expect(result.data[0]?.image_url).toBe("https://fixture.img/fixture-1.jpg");
    assertNoFetchCalls();
  });

  it("falls back to default when no fixture matches", async () => {
    vi.spyOn(globalThis, "fetch");
    const transport = new MinimaxFixtureTransport({});
    const result = await transport.createImageTask({
      model: "image-01",
      prompt: "Unknown prompt",
    });

    expect(result.data[0]?.image_url).toBe("https://fixture-cdn.minimax.io/img/default.jpg");
    assertNoFetchCalls();
  });

  it("matches video fixtures by key", async () => {
    vi.spyOn(globalThis, "fetch");
    const transport = new MinimaxFixtureTransport({
      videos: {
        "video:MiniMax-Hailuo-2.3-Fast:Product video": {
          base_resp: { status_code: 0, status_message: "success" },
          task_id: "fixture-video-001",
        },
      },
    });

    const result = await transport.createVideoTask({
      model: "MiniMax-Hailuo-2.3-Fast",
      prompt: "Product video",
      duration: 6,
    });

    expect(result.task_id).toBe("fixture-video-001");
  });

  it("matches video query fixtures by taskId", async () => {
    vi.spyOn(globalThis, "fetch");
    const transport = new MinimaxFixtureTransport({
      videoQueries: {
        "task-abc": {
          base_resp: { status_code: 0, status_message: "success" },
          status: "processing",
        },
      },
    });

    const result = await transport.queryVideoTask("task-abc");
    expect(result.status).toBe("processing");
  });
});

// ── MinimaxRealTransport constructor test (no network) ────────────────

describe("MinimaxRealTransport", () => {
  it("is constructable without network calls", () => {
    vi.spyOn(globalThis, "fetch");
    const client = new MinimaxClient({
      apiKey: "sk-test",
      apiHost: "https://api.minimaxi.com",
      timeoutMs: 30000,
    });
    const transport = new MinimaxRealTransport(client);
    expect(transport).toBeInstanceOf(MinimaxRealTransport);
  });
});

// ── classifyMinimaxError tests ────────────────────────────────────────

describe("classifyMinimaxError", () => {
  it("maps HTTP 401 to auth_error", () => {
    expect(classifyMinimaxError(401)).toBe("auth_error");
  });

  it("maps MiniMax code 1004 to auth_error via body", () => {
    expect(
      classifyMinimaxError(200, {
        base_resp: { status_code: 1004, status_message: "Invalid API key" },
      }),
    ).toBe("auth_error");
  });

  it("maps MiniMax code 2049 to auth_error via body", () => {
    expect(
      classifyMinimaxError(200, {
        base_resp: { status_code: 2049, status_message: "Token auth failure" },
      }),
    ).toBe("auth_error");
  });

  it("maps HTTP 429 to rate_limited", () => {
    expect(classifyMinimaxError(429)).toBe("rate_limited");
  });

  it("maps MiniMax code 1002 to rate_limited via body", () => {
    expect(
      classifyMinimaxError(200, {
        base_resp: { status_code: 1002, status_message: "Rate limited" },
      }),
    ).toBe("rate_limited");
  });

  it("maps MiniMax code 1008 to insufficient_balance via body", () => {
    expect(
      classifyMinimaxError(200, {
        base_resp: { status_code: 1008, status_message: "Insufficient balance" },
      }),
    ).toBe("insufficient_balance");
  });

  it("maps MiniMax code 1026 to content_blocked via body", () => {
    expect(
      classifyMinimaxError(200, {
        base_resp: { status_code: 1026, status_message: "Content safety" },
      }),
    ).toBe("content_blocked");
  });

  it("maps MiniMax code 1027 to content_blocked via body", () => {
    expect(
      classifyMinimaxError(200, {
        base_resp: { status_code: 1027, status_message: "Content safety 2" },
      }),
    ).toBe("content_blocked");
  });

  it("maps MiniMax code 2013 to invalid_request via body", () => {
    expect(
      classifyMinimaxError(200, {
        base_resp: { status_code: 2013, status_message: "Invalid request" },
      }),
    ).toBe("invalid_request");
  });

  it("maps HTTP 400 to invalid_request", () => {
    expect(classifyMinimaxError(400)).toBe("invalid_request");
  });

  it("maps HTTP 500 to provider_error", () => {
    expect(classifyMinimaxError(500)).toBe("provider_error");
  });

  it("maps HTTP 503 to provider_error", () => {
    expect(classifyMinimaxError(503)).toBe("provider_error");
  });

  it("maps unknown code to unknown", () => {
    expect(classifyMinimaxError(418)).toBe("unknown");
  });
});

// ── MinimaxRequestError tests ────────────────────────────────────────

describe("MinimaxRequestError", () => {
  it("carries category and statusCode", () => {
    const err = new MinimaxRequestError("auth_error", "Bad key", 401);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MinimaxRequestError");
    expect(err.category).toBe("auth_error");
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe("Bad key");
  });
});
