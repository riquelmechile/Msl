import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MlDiagnosticAdapter } from "../infrastructure/ml-diagnostic-adapter.js";

// ── Helpers ──────────────────────────────────────────────────────────

const CONFIG = {
  mlApiBaseUrl: "https://api.mercadolibre.com",
  authToken: "test-token",
};

type MockResponse = {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
};

function mockResponse(data: unknown, status = 200): MockResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(data),
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("MlDiagnosticAdapter", () => {
  let adapter: MlDiagnosticAdapter;

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response()));
    adapter = new MlDiagnosticAdapter(CONFIG);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("diagnoseImage", () => {
    it("returns passed: true when action is empty", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ action: "empty" }) as Response);

      const result = await adapter.diagnoseImage("https://cdn.example.com/img.jpg", {
        categoryId: "MLC1055",
        title: "Test Product",
        pictureType: "thumbnail",
      });

      expect(result.passed).toBe(true);
      expect(result.detections).toHaveLength(0);
      expect(result.picture_type).toBe("thumbnail");
    });

    it("returns passed: true when action is diagnostic but no detections", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({ action: "diagnostic", detections: [] }) as Response,
      );

      const result = await adapter.diagnoseImage("https://cdn.example.com/img.jpg", {
        categoryId: "MLC1055",
        title: "Test Product",
        pictureType: "thumbnail",
      });

      expect(result.passed).toBe(true);
      expect(result.detections).toHaveLength(0);
    });

    it("returns passed: false with white_background detection", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({
          action: "diagnostic",
          detections: [
            {
              name: "white_background",
              wordings: [
                { kind: "description", value: "El fondo de la imagen no es blanco digitalizado" },
              ],
            },
          ],
        }) as Response,
      );

      const result = await adapter.diagnoseImage("https://cdn.example.com/img.jpg", {
        categoryId: "MLC1055",
        title: "Test Product",
        pictureType: "thumbnail",
      });

      expect(result.passed).toBe(false);
      expect(result.detections).toHaveLength(1);
      expect(result.detections[0]?.name).toBe("white_background");
      expect(result.detections[0]?.wordings[0]?.kind).toBe("description");
    });

    it("returns passed: false with text_logo detection", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({
          action: "diagnostic",
          detections: [
            {
              name: "text_logo",
              wordings: [
                { kind: "description", value: "La imagen contiene texto o logo no permitido" },
              ],
            },
          ],
        }) as Response,
      );

      const result = await adapter.diagnoseImage("https://cdn.example.com/img.jpg", {
        categoryId: "MLC1055",
        title: "Test Product",
        pictureType: "thumbnail",
      });

      expect(result.passed).toBe(false);
      expect(result.detections).toHaveLength(1);
      expect(result.detections[0]?.name).toBe("text_logo");
    });

    it("returns passed: false with watermark detection", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({
          action: "diagnostic",
          detections: [
            {
              name: "watermark",
              wordings: [{ kind: "description", value: "La imagen contiene una marca de agua" }],
            },
          ],
        }) as Response,
      );

      const result = await adapter.diagnoseImage("https://cdn.example.com/img.jpg", {
        categoryId: "MLC1055",
        title: "Test Product",
        pictureType: "thumbnail",
      });

      expect(result.passed).toBe(false);
      expect(result.detections).toHaveLength(1);
      expect(result.detections[0]?.name).toBe("watermark");
    });

    it("returns passed: false with minimum_size detection", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({
          action: "diagnostic",
          detections: [
            {
              name: "minimum_size",
              wordings: [
                {
                  kind: "description",
                  value: "La imagen no cumple con el tamaño mínimo requerido",
                },
              ],
            },
          ],
        }) as Response,
      );

      const result = await adapter.diagnoseImage("https://cdn.example.com/img.jpg", {
        categoryId: "MLC1055",
        title: "Test Product",
        pictureType: "thumbnail",
      });

      expect(result.passed).toBe(false);
      expect(result.detections).toHaveLength(1);
      expect(result.detections[0]?.name).toBe("minimum_size");
    });

    it("handles multiple detections", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({
          action: "diagnostic",
          detections: [
            {
              name: "white_background",
              wordings: [{ kind: "description", value: "Non-white background" }],
            },
            {
              name: "watermark",
              wordings: [{ kind: "description", value: "Watermark detected" }],
            },
          ],
        }) as Response,
      );

      const result = await adapter.diagnoseImage("https://cdn.example.com/img.jpg", {
        categoryId: "MLC1055",
        title: "Test Product",
        pictureType: "thumbnail",
      });

      expect(result.passed).toBe(false);
      expect(result.detections).toHaveLength(2);
      expect(result.detections.map((d) => d.name).sort()).toEqual([
        "watermark",
        "white_background",
      ]);
    });

    it("filters unknown detection types gracefully", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({
          action: "diagnostic",
          detections: [
            {
              name: "unknown_type",
              wordings: [{ kind: "description", value: "Something" }],
            },
          ],
        }) as Response,
      );

      const result = await adapter.diagnoseImage("https://cdn.example.com/img.jpg", {
        categoryId: "MLC1055",
        title: "Test Product",
        pictureType: "thumbnail",
      });

      // Unknown types are filtered → no detections → passed: true
      expect(result.passed).toBe(true);
      expect(result.detections).toHaveLength(0);
    });

    it("returns passed: true on API error (non-blocking)", async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error("Network failure"));

      const result = await adapter.diagnoseImage("https://cdn.example.com/img.jpg", {
        categoryId: "MLC1055",
        title: "Test Product",
        pictureType: "thumbnail",
      });

      expect(result.passed).toBe(true);
      expect(result.detections).toHaveLength(0);
    });

    it("returns passed: true on HTTP error status (non-blocking)", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({ error: "Unauthorized" }, 401) as Response,
      );

      const result = await adapter.diagnoseImage("https://cdn.example.com/img.jpg", {
        categoryId: "MLC1055",
        title: "Test Product",
        pictureType: "thumbnail",
      });

      expect(result.passed).toBe(true);
      expect(result.detections).toHaveLength(0);
    });

    it("sends correct request body", async () => {
      let capturedBody: string | undefined;
      vi.mocked(fetch).mockImplementationOnce(async (_url, opts) => {
         
        capturedBody = opts?.body as string;
        return mockResponse({ action: "empty" }) as Response;
      });

      await adapter.diagnoseImage("https://cdn.example.com/product.jpg", {
        categoryId: "MLC1055",
        title: "My Product",
        pictureType: "thumbnail",
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const body = JSON.parse(capturedBody!);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.picture_url).toBe("https://cdn.example.com/product.jpg");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.context.category_id).toBe("MLC1055");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.context.title).toBe("My Product");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.context.picture_type).toBe("thumbnail");
    });
  });
});
