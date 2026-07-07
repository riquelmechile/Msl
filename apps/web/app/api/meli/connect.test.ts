import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the DI module before importing the route handler.
const mockGetAuthorizationUrl = vi.fn();
const mockManager = { getAuthorizationUrl: mockGetAuthorizationUrl };

vi.mock("../meli/oauth", () => ({
  getOAuthManager: vi.fn(() => mockManager),
}));

// Mock generateState to return a predictable state string.
vi.mock("@msl/mercadolibre", () => ({
  generateState: vi.fn(() => "mock-signed-state"),
}));

import { GET } from "./connect/route";
import { getOAuthManager } from "./oauth";

const STUB_SECRET = "test-state-secret-32bytes!";

describe("GET /api/meli/connect", () => {
  beforeEach(() => {
    vi.stubEnv("MSL_OAUTH_STATE_SECRET", STUB_SECRET);
    vi.stubEnv("MERCADOLIBRE_SOURCE_SELLER_ID", "plasticov");
    vi.stubEnv("MERCADOLIBRE_TARGET_SELLER_ID", "maustian");
    mockGetAuthorizationUrl.mockReset();
    vi.mocked(getOAuthManager).mockReturnValue(mockManager as unknown as ReturnType<typeof getOAuthManager>);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 302 redirect for role=source with correct seller config", async () => {
    mockGetAuthorizationUrl.mockReturnValue(
      "https://auth.mercadolibre.cl/authorization?response_type=code&client_id=TEST-plasticov&redirect_uri=https%3A%2F%2Fsrc.example%2Fcallback&state=mock-signed-state",
    );

    const req = new NextRequest("https://example.test/api/meli/connect?role=source");
    const res = await GET(req);

    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toContain("client_id=TEST-plasticov");
    expect(location).toContain("mock-signed-state");
    expect(mockGetAuthorizationUrl).toHaveBeenCalledWith("plasticov", "mock-signed-state");
  });

  it("returns 302 redirect for role=target with correct seller config", async () => {
    mockGetAuthorizationUrl.mockReturnValue(
      "https://auth.mercadolibre.cl/authorization?response_type=code&client_id=TEST-maustian&redirect_uri=https%3A%2F%2Ftgt.example%2Fcallback&state=mock-signed-state",
    );

    const req = new NextRequest("https://example.test/api/meli/connect?role=target");
    const res = await GET(req);

    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toContain("client_id=TEST-maustian");
    expect(mockGetAuthorizationUrl).toHaveBeenCalledWith("maustian", "mock-signed-state");
  });

  it("returns 400 for unknown role", async () => {
    const req = new NextRequest("https://example.test/api/meli/connect?role=admin");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Unknown role");
  });

  it("returns 400 when no role param is provided", async () => {
    const req = new NextRequest("https://example.test/api/meli/connect");
    const res = await GET(req);

    expect(res.status).toBe(400);
  });

  it("returns 500 when source seller ID is not configured", async () => {
    vi.stubEnv("MERCADOLIBRE_SOURCE_SELLER_ID", "");

    const req = new NextRequest("https://example.test/api/meli/connect?role=source");
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Seller ID not configured");
  });

  it("returns 500 when MSL_OAUTH_STATE_SECRET is not set", async () => {
    vi.stubEnv("MSL_OAUTH_STATE_SECRET", "");

    const req = new NextRequest("https://example.test/api/meli/connect?role=source");
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("MSL_OAUTH_STATE_SECRET");
  });
});
