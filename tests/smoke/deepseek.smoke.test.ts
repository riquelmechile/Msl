import { describe, it, expect } from "vitest";

const shouldRun =
  process.env["RUN_DEEPSEEK_SMOKE"] === "true" && Boolean(process.env["DEEPSEEK_API_KEY"]);
const describeSmoke = shouldRun ? describe : describe.skip;

describeSmoke("DeepSeek live smoke", () => {
  it("GET /models includes deepseek-v4-flash or deepseek-v4-pro", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]!;
    const baseUrl = process.env["DEEPSEEK_BASE_URL"] ?? "https://api.deepseek.com";

    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(response.ok).toBe(true);
    const body = (await response.json()) as {
      data: Array<{ id: string }>;
    };
    const modelIds = body.data.map((m) => m.id);
    const hasRelevantModel = modelIds.some(
      (id) => id.includes("deepseek-v4-flash") || id.includes("deepseek-v4-pro"),
    );
    expect(hasRelevantModel).toBe(true);
  });

  it("chat.completions minimal with low max_tokens", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]!;
    const baseUrl = process.env["DEEPSEEK_BASE_URL"] ?? "https://api.deepseek.com";

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "Say hello in one word." }],
        max_tokens: 10,
      }),
    });

    expect(response.ok).toBe(true);
    const body = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = body.choices[0]?.message.content ?? "";
    expect(content.length).toBeGreaterThan(0);
  });

  it("tool-call forced with record_test_event function", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]!;
    const baseUrl = process.env["DEEPSEEK_BASE_URL"] ?? "https://api.deepseek.com";

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          {
            role: "user",
            content: "Record a test event named smoke_test with value 'passed'.",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "record_test_event",
              description: "Records a test event",
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  value: { type: "string" },
                },
                required: ["name", "value"],
              },
            },
          },
        ],
        tool_choice: "required",
      }),
    });

    expect(response.ok).toBe(true);
    const body = (await response.json()) as {
      choices: Array<{
        message: {
          tool_calls?: Array<{ function: { name: string } }>;
        };
      }>;
    };

    const toolCalls = body.choices[0]?.message.tool_calls ?? [];
    const hasRecordEvent = toolCalls.some((tc) => tc.function.name === "record_test_event");
    expect(hasRecordEvent).toBe(true);
  });
});
