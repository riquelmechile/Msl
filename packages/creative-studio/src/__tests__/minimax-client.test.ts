import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MinimaxClient, MinimaxRequestError } from "../infrastructure/providers/minimax/minimax-client.js";

// ── Tests ────────────────────────────────────────────────────────────

describe("MinimaxClient", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("throws when apiKey is empty", () => {
      expect(
        () =>
          new MinimaxClient({
            apiKey: "",
            apiHost: "https://api.minimax.io",
            timeoutMs: 30000,
          }),
      ).toThrow("apiKey is required");
    });

    it("creates client when apiKey is provided", () => {
      const client = new MinimaxClient({
        apiKey: "sk-test",
        apiHost: "https://api.minimax.io",
        timeoutMs: 30000,
      });
      expect(client).toBeInstanceOf(MinimaxClient);
    });
  });

  describe("post", () => {
    it("sends authorization header", async () => {
      const client = new MinimaxClient({
        apiKey: "sk-test-key",
        apiHost: "https://api.minimax.io",
        timeoutMs: 30000,
      });

      let capturedHeaders: Record<string, string> | undefined;
      vi.mocked(fetch).mockReset();
      vi.mocked(fetch).mockImplementation(async (_url, opts) => {
        capturedHeaders = opts?.headers as Record<string, string>;
        return {
          status: 200,
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ base_resp: { status_code: 0 } })),
        } as Response;
      });

      await client.post("/v1/image_generation", { model: "image-01" });
      expect(capturedHeaders).toBeDefined();
      expect(capturedHeaders!["Authorization"]).toBe("Bearer sk-test-key");
      expect(capturedHeaders!["Content-Type"]).toBe("application/json");
    });

    it("throws auth_error on 401 response", async () => {
      const client = new MinimaxClient({
        apiKey: "sk-bad",
        apiHost: "https://api.minimax.io",
        timeoutMs: 30000,
      });

      vi.mocked(fetch).mockReset();
      vi.mocked(fetch).mockResolvedValue({
        status: 401,
        ok: false,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              base_resp: { status_code: 1004, status_message: "Invalid API key" },
            }),
          ),
      } as Response);

      await expect(client.post("/v1/image_generation", {})).rejects.toThrow(MinimaxRequestError);
      await expect(client.post("/v1/image_generation", {})).rejects.toMatchObject({
        category: "auth_error",
      });
    });

    it("throws rate_limited on 429 response", async () => {
      const client = new MinimaxClient({
        apiKey: "sk-test",
        apiHost: "https://api.minimax.io",
        timeoutMs: 30000,
      });

      vi.mocked(fetch).mockReset();
      vi.mocked(fetch).mockResolvedValue({
        status: 429,
        ok: false,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              base_resp: { status_code: 1002, status_message: "Rate limit exceeded" },
            }),
          ),
      } as Response);

      await expect(client.post("/v1/image_generation", {})).rejects.toMatchObject({
        category: "rate_limited",
      });
    });

    it("throws insufficient_balance on 1008", async () => {
      const client = new MinimaxClient({
        apiKey: "sk-test",
        apiHost: "https://api.minimax.io",
        timeoutMs: 30000,
      });

      vi.mocked(fetch).mockReset();
      vi.mocked(fetch).mockResolvedValue({
        status: 200,
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              base_resp: { status_code: 1008, status_message: "Insufficient balance" },
            }),
          ),
      } as Response);

      await expect(client.post("/v1/image_generation", {})).rejects.toMatchObject({
        category: "insufficient_balance",
      });
    });

    it("throws content_blocked on 1026", async () => {
      const client = new MinimaxClient({
        apiKey: "sk-test",
        apiHost: "https://api.minimax.io",
        timeoutMs: 30000,
      });

      vi.mocked(fetch).mockReset();
      vi.mocked(fetch).mockResolvedValue({
        status: 200,
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              base_resp: { status_code: 1026, status_message: "Content policy violation" },
            }),
          ),
      } as Response);

      await expect(client.post("/v1/image_generation", {})).rejects.toMatchObject({
        category: "content_blocked",
      });
    });

    it("returns parsed response on success", async () => {
      const client = new MinimaxClient({
        apiKey: "sk-test",
        apiHost: "https://api.minimax.io",
        timeoutMs: 30000,
      });

      vi.mocked(fetch).mockReset();
      vi.mocked(fetch).mockResolvedValue({
        status: 200,
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              base_resp: { status_code: 0, status_message: "success" },
              data: [{ image_url: "https://cdn.minimax.io/img/123.jpg" }],
            }),
          ),
      } as Response);

      const result = await client.post<{
        base_resp: { status_code: number };
        data: Array<{ image_url: string }>;
      }>("/v1/image_generation", { model: "image-01" });

      expect(result.base_resp.status_code).toBe(0);
      expect(result.data?.[0]?.image_url).toBe("https://cdn.minimax.io/img/123.jpg");
    });
  });
});
