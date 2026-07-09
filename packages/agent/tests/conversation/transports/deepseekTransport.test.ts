import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DeepSeekFakeTransport,
  DeepSeekFixtureTransport,
  DeepSeekRealTransport,
  type DeepSeekChatResponse,
} from "../../../src/conversation/transports/deepseekTransport.js";
import {
  classifyDeepSeekError,
  DeepSeekRequestError,
} from "../../../src/conversation/transports/deepseekErrors.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helper: assert no real fetch calls ────────────────────────────────

function assertNoFetchCalls() {
  expect(vi.mocked(fetch)).not.toHaveBeenCalled();
}

// ── DeepSeekFakeTransport tests ───────────────────────────────────────

describe("DeepSeekFakeTransport", () => {
  it("returns deterministic models list", async () => {
    vi.spyOn(globalThis, "fetch");
    const transport = new DeepSeekFakeTransport();
    const models = await transport.listModels();

    expect(models).toHaveLength(2);
    expect(models[0]?.id).toBe("deepseek-v4-flash");
    expect(models[1]?.id).toBe("deepseek-v4-pro");
    assertNoFetchCalls();
  });

  it("returns deterministic response for createChatCompletion", async () => {
    vi.spyOn(globalThis, "fetch");
    const transport = new DeepSeekFakeTransport();
    const response = await transport.createChatCompletion({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(response.id).toBe("fake-cmpl-001");
    expect(response.choices[0]?.message.content).toBe("Fake response.");
    assertNoFetchCalls();
  });

  it("replays responses in order", async () => {
    vi.spyOn(globalThis, "fetch");
    const responses: DeepSeekChatResponse[] = [
      {
        id: "r1",
        choices: [
          { index: 0, message: { role: "assistant", content: "First" }, finish_reason: "stop" },
        ],
      },
      {
        id: "r2",
        choices: [
          { index: 0, message: { role: "assistant", content: "Second" }, finish_reason: "stop" },
        ],
      },
    ];

    const transport = new DeepSeekFakeTransport(responses);

    const r1 = await transport.createChatCompletion({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "a" }],
    });
    expect(r1.id).toBe("r1");
    expect(r1.choices[0]?.message.content).toBe("First");

    const r2 = await transport.createChatCompletion({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "b" }],
    });
    expect(r2.id).toBe("r2");
    expect(r2.choices[0]?.message.content).toBe("Second");
  });

  it("cycles responses when exhausted", async () => {
    vi.spyOn(globalThis, "fetch");
    const responses: DeepSeekChatResponse[] = [
      {
        id: "cycle-1",
        choices: [
          { index: 0, message: { role: "assistant", content: "A" }, finish_reason: "stop" },
        ],
      },
    ];

    const transport = new DeepSeekFakeTransport(responses);

    const r1 = await transport.createChatCompletion({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "x" }],
    });
    expect(r1.id).toBe("cycle-1");

    const r2 = await transport.createChatCompletion({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "y" }],
    });
    expect(r2.id).toBe("cycle-1");
  });

  it("never calls fetch for streamChatCompletion", async () => {
    vi.spyOn(globalThis, "fetch");
    const transport = new DeepSeekFakeTransport();
    const chunks: Array<{ delta: string; done: boolean }> = [];

    for await (const chunk of transport.streamChatCompletion({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "Stream" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.delta).toBe("Fake response.");
    expect(chunks[0]?.done).toBe(true);
    assertNoFetchCalls();
  });
});

// ── DeepSeekFixtureTransport tests ────────────────────────────────────

describe("DeepSeekFixtureTransport", () => {
  it("matches fixtures by key (model + first message content)", async () => {
    vi.spyOn(globalThis, "fetch");
    const fixtures: Record<string, DeepSeekChatResponse> = {
      "deepseek-v4-flash:What is AI?": {
        id: "fix-ai",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "AI response" },
            finish_reason: "stop",
          },
        ],
      },
    };

    const transport = new DeepSeekFixtureTransport(fixtures);

    const response = await transport.createChatCompletion({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "What is AI?" }],
    });

    expect(response.id).toBe("fix-ai");
    expect(response.choices[0]?.message.content).toBe("AI response");
    assertNoFetchCalls();
  });

  it("falls back to default when no fixture matches", async () => {
    vi.spyOn(globalThis, "fetch");
    const transport = new DeepSeekFixtureTransport({});

    const response = await transport.createChatCompletion({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "Random question" }],
    });

    expect(response.id).toBe("fixture-default-001");
    assertNoFetchCalls();
  });
});

// ── DeepSeekRealTransport constructor test (no network in constructor) ─

describe("DeepSeekRealTransport", () => {
  it("is constructable without network calls", () => {
    vi.spyOn(globalThis, "fetch");
    const transport = new DeepSeekRealTransport("sk-fake-key", "https://api.deepseek.com");
    expect(transport).toBeInstanceOf(DeepSeekRealTransport);
    // The OpenAI client constructor does not make network calls
    assertNoFetchCalls();
  });
});

// ── classifyDeepSeekError tests ──────────────────────────────────────

describe("classifyDeepSeekError", () => {
  it("maps 400 to invalid_request", () => {
    expect(classifyDeepSeekError(400)).toBe("invalid_request");
  });

  it("maps 401 to auth_error", () => {
    expect(classifyDeepSeekError(401)).toBe("auth_error");
  });

  it("maps 402 to insufficient_balance", () => {
    expect(classifyDeepSeekError(402)).toBe("insufficient_balance");
  });

  it("maps 422 to invalid_params", () => {
    expect(classifyDeepSeekError(422)).toBe("invalid_params");
  });

  it("maps 429 to rate_limited", () => {
    expect(classifyDeepSeekError(429)).toBe("rate_limited");
  });

  it("maps 500 to provider_retryable", () => {
    expect(classifyDeepSeekError(500)).toBe("provider_retryable");
  });

  it("maps 503 to provider_retryable", () => {
    expect(classifyDeepSeekError(503)).toBe("provider_retryable");
  });

  it("maps unknown code to unknown", () => {
    expect(classifyDeepSeekError(418)).toBe("unknown");
  });
});

// ── DeepSeekRequestError tests ───────────────────────────────────────

describe("DeepSeekRequestError", () => {
  it("carries category and statusCode", () => {
    const err = new DeepSeekRequestError("auth_error", "Bad key", 401);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DeepSeekRequestError");
    expect(err.category).toBe("auth_error");
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe("Bad key");
  });
});
