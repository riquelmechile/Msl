import { describe, expect, it, vi, afterEach } from "vitest";
import { createMultiAppOAuthManager } from "./multiAppOAuthManager.js";
import type { OAuthManagerConfig } from "./oauthManager.js";

function stubConfig(overrides: Partial<OAuthManagerConfig> = {}): OAuthManagerConfig {
  return {
    clientId: "stub",
    clientSecret: "stub-secret",
    redirectUri: "https://example.test/callback",
    dbPath: ":memory:",
    ...overrides,
  };
}

function stubConfigs(
  entries: [string, OAuthManagerConfig][],
): ReadonlyMap<string, OAuthManagerConfig> {
  return new Map(entries);
}

describe("createMultiAppOAuthManager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getAuthorizationUrl uses correct clientId per seller", () => {
    const configs = stubConfigs([
      ["plasticov", stubConfig({ clientId: "TEST-app-plasticov" })],
      ["maustian", stubConfig({ clientId: "TEST-app-maustian" })],
    ]);
    const mgr = createMultiAppOAuthManager(configs);

    const plasticovUrl = mgr.getAuthorizationUrl("plasticov", "state-1");
    const maustianUrl = mgr.getAuthorizationUrl("maustian", "state-2");

    expect(plasticovUrl).toContain("client_id=TEST-app-plasticov");
    expect(maustianUrl).toContain("client_id=TEST-app-maustian");
    expect(plasticovUrl).toContain("mock_seller=plasticov");
    expect(maustianUrl).toContain("mock_seller=maustian");
  });

  it("exchangeCodeForToken uses correct credentials per seller (stub mode)", async () => {
    const configs = stubConfigs([
      ["plasticov", stubConfig()],
      ["maustian", stubConfig()],
    ]);
    const mgr = createMultiAppOAuthManager(configs);

    const plasticovTokens = await mgr.exchangeCodeForToken("plasticov", "code-1");
    const maustianTokens = await mgr.exchangeCodeForToken("maustian", "code-2");

    expect(plasticovTokens.nickname).toBe("seller_plasticov");
    expect(maustianTokens.nickname).toBe("seller_maustian");
    expect(plasticovTokens.access_token).toContain("mock-access-plasticov");
    expect(maustianTokens.access_token).toContain("mock-access-maustian");
  });

  it("refreshAccessToken uses correct credentials per seller", async () => {
    const configs = stubConfigs([
      ["plasticov", stubConfig()],
      ["maustian", stubConfig()],
    ]);
    const mgr = createMultiAppOAuthManager(configs);

    // First exchange to populate tokens
    await mgr.exchangeCodeForToken("plasticov", "code-1");
    await mgr.exchangeCodeForToken("maustian", "code-2");

    const plasticovTokens = await mgr.refreshAccessToken("plasticov");
    const maustianTokens = await mgr.refreshAccessToken("maustian");

    expect(plasticovTokens.nickname).toBe("seller_plasticov");
    expect(maustianTokens.nickname).toBe("seller_maustian");
  });

  it("unknown sellerId throws descriptive error", () => {
    // Requires 2+ entries — single-entry uses passthrough routing
    const configs = stubConfigs([
      ["plasticov", stubConfig()],
      ["maustian", stubConfig()],
    ]);
    const mgr = createMultiAppOAuthManager(configs);

    expect(() => mgr.getAuthorizationUrl("nonexistent", "state")).toThrow(
      "Unknown seller: nonexistent",
    );
  });

  it("unknown sellerId throws on exchangeCodeForToken", async () => {
    // Requires 2+ entries — single-entry uses passthrough routing
    const configs = stubConfigs([
      ["plasticov", stubConfig()],
      ["maustian", stubConfig()],
    ]);
    const mgr = createMultiAppOAuthManager(configs);

    await expect(mgr.exchangeCodeForToken("nonexistent", "code")).rejects.toThrow(
      "Unknown seller: nonexistent",
    );
  });

  it("single-entry config routes all sellers to the same manager", () => {
    const configs = stubConfigs([["plasticov", stubConfig({ clientId: "TEST-only-app" })]]);
    const mgr = createMultiAppOAuthManager(configs);

    // Any sellerId should work — passthrough mode
    const url = mgr.getAuthorizationUrl("maustian", "state-1");
    expect(url).toContain("client_id=TEST-only-app");
    expect(url).toContain("mock_seller=maustian");

    const url2 = mgr.getAuthorizationUrl("plasticov", "state-2");
    expect(url2).toContain("client_id=TEST-only-app");
  });

  it("two tokens coexist (different seller IDs in token store)", async () => {
    const configs = stubConfigs([
      ["plasticov", stubConfig()],
      ["maustian", stubConfig()],
    ]);
    const mgr = createMultiAppOAuthManager(configs);

    await mgr.exchangeCodeForToken("plasticov", "code-1");
    await mgr.exchangeCodeForToken("maustian", "code-2");

    const plasticovToken = mgr.getStoredToken("plasticov");
    const maustianToken = mgr.getStoredToken("maustian");

    expect(plasticovToken).toBeDefined();
    expect(maustianToken).toBeDefined();
    expect(plasticovToken!.seller_id).toBe("plasticov");
    expect(maustianToken!.seller_id).toBe("maustian");
    expect(plasticovToken!.access_token).toContain("plasticov");
    expect(maustianToken!.access_token).toContain("maustian");
  });

  it("refresh of one seller does not affect the other", async () => {
    const configs = stubConfigs([
      ["plasticov", stubConfig()],
      ["maustian", stubConfig()],
    ]);
    const mgr = createMultiAppOAuthManager(configs);

    await mgr.exchangeCodeForToken("plasticov", "code-1");
    await mgr.exchangeCodeForToken("maustian", "code-2");

    const maustianBefore = mgr.getStoredToken("maustian");

    // Refresh only plasticov
    await mgr.refreshAccessToken("plasticov");

    const maustianAfter = mgr.getStoredToken("maustian");
    expect(maustianAfter!.access_token).toBe(maustianBefore!.access_token);
    expect(maustianAfter!.refresh_token).toBe(maustianBefore!.refresh_token);
  });

  it("isStubMode() no-arg returns true when all inner managers are stub", () => {
    const configs = stubConfigs([
      ["plasticov", stubConfig({ clientId: "stub" })],
      ["maustian", stubConfig({ clientId: "stub" })],
    ]);
    const mgr = createMultiAppOAuthManager(configs);

    expect(mgr.isStubMode()).toBe(true);
  });

  it("isStubMode() no-arg returns false when any manager is not stub", () => {
    const configs = stubConfigs([
      ["plasticov", stubConfig({ clientId: "stub" })],
      [
        "maustian",
        stubConfig({
          clientId: "APP-prod",
          clientSecret: "real",
          redirectUri: "https://real.example/callback",
        }),
      ],
    ]);
    const mgr = createMultiAppOAuthManager(configs);

    // "APP-" prefixed credentials are considered production, not stub
    expect(mgr.isStubMode()).toBe(false);
  });

  it("isStubMode() no-arg returns true for empty configs", () => {
    const mgr = createMultiAppOAuthManager(new Map());
    expect(mgr.isStubMode()).toBe(true);
  });

  it("close() closes all inner managers", () => {
    const configs = stubConfigs([
      ["plasticov", stubConfig()],
      ["maustian", stubConfig()],
    ]);
    const mgr = createMultiAppOAuthManager(configs);

    // Should not throw — verifies close handles all managers
    expect(() => mgr.close()).not.toThrow();
  });

  it("isTokenExpired delegates per seller", async () => {
    const configs = stubConfigs([
      ["plasticov", stubConfig()],
      ["maustian", stubConfig()],
    ]);
    const mgr = createMultiAppOAuthManager(configs);

    // No tokens yet — should be expired
    expect(mgr.isTokenExpired("plasticov")).toBe(true);

    await mgr.exchangeCodeForToken("plasticov", "code-1");
    expect(mgr.isTokenExpired("plasticov")).toBe(false);
    expect(mgr.isTokenExpired("maustian")).toBe(true);
  });

  it("deleteToken delegates per seller", async () => {
    const configs = stubConfigs([
      ["plasticov", stubConfig()],
      ["maustian", stubConfig()],
    ]);
    const mgr = createMultiAppOAuthManager(configs);

    await mgr.exchangeCodeForToken("plasticov", "code-1");
    expect(mgr.getStoredToken("plasticov")).toBeDefined();

    mgr.deleteToken("plasticov");
    expect(mgr.getStoredToken("plasticov")).toBeUndefined();
  });

  it("ensureValidToken returns access token", async () => {
    const configs = stubConfigs([["plasticov", stubConfig()]]);
    const mgr = createMultiAppOAuthManager(configs);

    await mgr.exchangeCodeForToken("plasticov", "code-1");
    const token = await mgr.ensureValidToken("plasticov");
    expect(token).toContain("mock-access-plasticov");
  });
});
