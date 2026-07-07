import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the DI module.
const mockExchangeCodeForToken = vi.fn();
const mockManager = { exchangeCodeForToken: mockExchangeCodeForToken };

vi.mock("../meli/oauth", () => ({
  getOAuthManager: vi.fn(() => mockManager),
}));

// Mock validateState with a controllable implementation.
const mockValidateState = vi.fn();
vi.mock("@msl/mercadolibre", () => ({
  validateState: (state: string, secret: string) => mockValidateState(state, secret),
}));

import { GET } from "./callback/route";
import { getOAuthManager } from "./oauth";

const STUB_SECRET = "test-state-secret-32bytes!";

function validPayload() {
  return { role: "source" as const, sellerId: "plasticov", nonce: "test-nonce", createdAt: Date.now() };
}

function mockTokens() {
  return {
    access_token: "mock-access-token-secret-12345",
    refresh_token: "mock-refresh-token-secret-67890",
    expires_in: 21600,
    user_id: "plasticov",
    nickname: "seller_plasticov",
    account_level: "classic" as const,
  };
}

describe("GET /api/meli/callback", () => {
  beforeEach(() => {
    vi.stubEnv("MSL_OAUTH_STATE_SECRET", STUB_SECRET);
    vi.stubEnv("MERCADOLIBRE_SOURCE_SELLER_ID", "plasticov");
    vi.stubEnv("MERCADOLIBRE_TARGET_SELLER_ID", "maustian");
    mockValidateState.mockReset();
    mockExchangeCodeForToken.mockReset();
    vi.mocked(getOAuthManager).mockReturnValue(mockManager as unknown as ReturnType<typeof getOAuthManager>);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 200 HTML with user_id and nickname for valid callback", async () => {
    mockValidateState.mockReturnValue(validPayload());
    mockExchangeCodeForToken.mockResolvedValue(mockTokens());

    const url = "https://example.test/api/meli/callback?code=auth-code-123&state=mock-signed-state";
    const req = new NextRequest(url);
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Cuenta MercadoLibre conectada correctamente");
    expect(body).toContain("User ID: plasticov");
    expect(body).toContain("Nickname: seller_plasticov");
    expect(body).toContain("Role: source");
    expect(body).toContain("Seller ID: plasticov");

    // Must NOT expose tokens
    expect(body).not.toContain("mock-access-token");
    expect(body).not.toContain("mock-refresh-token");
    expect(body).not.toContain("access_token");
    expect(body).not.toContain("refresh_token");
  });

  it("returns 200 for target role callback", async () => {
    mockValidateState.mockReturnValue({
      ...validPayload(),
      role: "target" as const,
      sellerId: "maustian",
    });
    mockExchangeCodeForToken.mockResolvedValue({
      ...mockTokens(),
      user_id: "maustian",
      nickname: "seller_maustian",
    });

    const req = new NextRequest("https://example.test/api/meli/callback?code=code&state=state");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("User ID: maustian");
    expect(body).toContain("Nickname: seller_maustian");
    expect(body).toContain("Role: target");
  });

  it("returns 400 when code is missing", async () => {
    const req = new NextRequest("https://example.test/api/meli/callback?state=state");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("Missing authorization code");
  });

  it("returns 400 when state is missing", async () => {
    const req = new NextRequest("https://example.test/api/meli/callback?code=code");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("Missing state parameter");
  });

  it("returns 400 when state validation fails (expired)", async () => {
    mockValidateState.mockImplementation(() => {
      throw new Error("State token expired: age 700000ms exceeds TTL 600000ms");
    });

    const req = new NextRequest("https://example.test/api/meli/callback?code=code&state=expired");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("State token expired");
  });

  it("returns 400 when state validation fails (tampered)", async () => {
    mockValidateState.mockImplementation(() => {
      throw new Error("Invalid state: HMAC signature verification failed");
    });

    const req = new NextRequest("https://example.test/api/meli/callback?code=code&state=tampered");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("HMAC signature verification failed");
  });

  it("returns 400 on role/sellerId mismatch", async () => {
    mockValidateState.mockReturnValue({
      ...validPayload(),
      role: "source" as const,
      sellerId: "maustian", // source role but target sellerId
    });

    const req = new NextRequest("https://example.test/api/meli/callback?code=code&state=state");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("Role/seller ID mismatch");
  });

  it("returns 500 when token exchange fails", async () => {
    mockValidateState.mockReturnValue(validPayload());
    mockExchangeCodeForToken.mockRejectedValue(new Error("OAuth code exchange failed: 401 Unauthorized"));

    const req = new NextRequest("https://example.test/api/meli/callback?code=bad-code&state=state");
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("OAuth authorization failed");
  });
});
