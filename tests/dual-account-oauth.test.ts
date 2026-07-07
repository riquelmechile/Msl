import { describe, expect, it } from "vitest";
import {
  createMultiAppOAuthManager,
  resolveOAuthConfigs,
  generateState,
  validateState,
} from "@msl/mercadolibre";
import type { OAuthManagerConfig } from "@msl/mercadolibre";

const SECRET = "integration-test-state-secret!!";

function stubConfig(clientId: string): OAuthManagerConfig {
  return {
    clientId,
    clientSecret: "stub-secret",
    redirectUri: "https://example.test/callback",
    dbPath: ":memory:",
  };
}

describe("dual-account OAuth integration", () => {
  it("full flow: two sellers get distinct auth URLs and tokens", async () => {
    const configs = new Map<string, OAuthManagerConfig>([
      ["plasticov", stubConfig("TEST-plasticov-app")],
      ["maustian", stubConfig("TEST-maustian-app")],
    ]);
    const mgr = createMultiAppOAuthManager(configs);

    // -- Connect phase --
    const plasticovState = generateState(
      { role: "source", sellerId: "plasticov", nonce: "nonce-1", createdAt: Date.now() },
      SECRET,
    );
    const maustianState = generateState(
      { role: "target", sellerId: "maustian", nonce: "nonce-2", createdAt: Date.now() },
      SECRET,
    );

    const plasticovUrl = mgr.getAuthorizationUrl("plasticov", plasticovState);
    const maustianUrl = mgr.getAuthorizationUrl("maustian", maustianState);

    // Verify each seller gets its own clientId in the auth URL.
    expect(plasticovUrl).toContain("client_id=TEST-plasticov-app");
    expect(maustianUrl).toContain("client_id=TEST-maustian-app");

    // Verify state is embedded in URLs.
    expect(plasticovUrl).toContain(encodeURIComponent(plasticovState));
    expect(maustianUrl).toContain(encodeURIComponent(maustianState));

    // -- Callback phase --
    const plasticovTokens = await mgr.exchangeCodeForToken("plasticov", "auth-code-plasticov");
    const maustianTokens = await mgr.exchangeCodeForToken("maustian", "auth-code-maustian");

    expect(plasticovTokens.nickname).toBe("seller_plasticov");
    expect(plasticovTokens.user_id).toContain("plasticov");
    expect(maustianTokens.nickname).toBe("seller_maustian");
    expect(maustianTokens.user_id).toContain("maustian");

    // Verify two rows coexist.
    const storedPlasticov = mgr.getStoredToken("plasticov");
    const storedMaustian = mgr.getStoredToken("maustian");

    expect(storedPlasticov).toBeDefined();
    expect(storedMaustian).toBeDefined();
    expect(storedPlasticov!.seller_id).toBe("plasticov");
    expect(storedMaustian!.seller_id).toBe("maustian");

    // Refresh only one seller — the other must stay untouched.
    const maustianBeforeRefresh = storedMaustian!.access_token;
    await mgr.refreshAccessToken("plasticov");
    const maustianAfterRefresh = mgr.getStoredToken("maustian");
    expect(maustianAfterRefresh!.access_token).toBe(maustianBeforeRefresh);
  });

  it("legacy single-app fallback: single config serves any seller", () => {
    const env: NodeJS.ProcessEnv = {
      MERCADOLIBRE_SOURCE_SELLER_ID: "only-seller",
      MERCADOLIBRE_CLIENT_ID: "TEST-legacy-app",
      MERCADOLIBRE_CLIENT_SECRET: "legacy-secret",
      MERCADOLIBRE_REDIRECT_URI: "https://legacy.example/callback",
    };

    const configs = resolveOAuthConfigs(env);
    expect(configs.size).toBe(1);
    expect(configs.get("only-seller")!.clientId).toBe("TEST-legacy-app");

    const mgr = createMultiAppOAuthManager(configs);

    // Any sellerId should work via pass-through.
    const url = mgr.getAuthorizationUrl("only-seller", "state-1");
    expect(url).toContain("client_id=TEST-legacy-app");
  });

  it("state round-trip validates correctly through the full callback flow", () => {
    const payload = {
      role: "source" as const,
      sellerId: "plasticov",
      nonce: "full-flow-nonce",
      createdAt: Date.now(),
    };

    const state = generateState(payload, SECRET);
    const parsed = validateState(state, SECRET);

    expect(parsed.role).toBe("source");
    expect(parsed.sellerId).toBe("plasticov");
    expect(parsed.nonce).toBe("full-flow-nonce");
  });
});
