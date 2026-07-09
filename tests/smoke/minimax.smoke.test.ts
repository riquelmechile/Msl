import { describe, it, expect } from "vitest";

const shouldRun =
  process.env["RUN_MINIMAX_SMOKE"] === "true" && Boolean(process.env["MINIMAX_API_KEY"]);
const describeSmoke = shouldRun ? describe : describe.skip;

const shouldRunCreative =
  process.env["RUN_MINIMAX_CREATIVE_SMOKE"] === "true" &&
  Boolean(process.env["MINIMAX_API_KEY"]) &&
  process.env["ALLOW_PAID_PROVIDER_SMOKE"] === "true";
const describeCreativeSmoke = shouldRunCreative ? describe : describe.skip;

describeSmoke("MiniMax live smoke", () => {
  it("OpenAI-compatible text call with MiniMax-M3 model", async () => {
    const apiKey = process.env["MINIMAX_API_KEY"]!;
    const baseUrl = process.env["MINIMAX_BASE_URL"] ?? "https://api.minimaxi.com";

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "MiniMax-M3",
        messages: [{ role: "user", content: "Say hello in one word." }],
        max_tokens: 5,
      }),
    });

    expect(response.ok).toBe(true);
    const body = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = body.choices[0]?.message.content ?? "";
    expect(content.length).toBeGreaterThan(0);
  });

  it("validates error mapping with invalid API key using fixture (no real HTTP)", async () => {
    // This test uses fixture data to validate error mapping.
    // It does NOT make real HTTP calls.
    const { classifyMinimaxError } =
      await import("../../packages/creative-studio/src/infrastructure/providers/minimax/minimaxErrors.js");

    const authCategory = classifyMinimaxError(200, {
      base_resp: { status_code: 1004, status_message: "Invalid API key" },
    });
    expect(authCategory).toBe("auth_error");

    const rateLimitCategory = classifyMinimaxError(429);
    expect(rateLimitCategory).toBe("rate_limited");

    const unknownCategory = classifyMinimaxError(418);
    expect(unknownCategory).toBe("unknown");
  });
});

describeCreativeSmoke("MiniMax creative smoke", () => {
  it("image generation creates a task", async () => {
    const apiKey = process.env["MINIMAX_API_KEY"]!;

    const response = await fetch("https://api.minimaxi.com/v1/image_generation", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "image-01",
        prompt: "A simple white background product image.",
        n: 1,
        response_format: "url",
      }),
    });

    expect(response.ok).toBe(true);
    const body = (await response.json()) as {
      base_resp: { status_code: number };
      data: Array<{ image_url: string }>;
    };
    expect(body.base_resp.status_code).toBe(0);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("video generation creates a task", async () => {
    const apiKey = process.env["MINIMAX_API_KEY"]!;

    const response = await fetch("https://api.minimaxi.com/v1/video_generation", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "MiniMax-Hailuo-2.3-Fast",
        prompt: "A simple product showcase video.",
        duration: 6,
      }),
    });

    expect(response.ok).toBe(true);
    const body = (await response.json()) as {
      base_resp: { status_code: number };
      task_id: string;
    };
    expect(body.base_resp.status_code).toBe(0);
    expect(body.task_id.length).toBeGreaterThan(0);
  });
});
