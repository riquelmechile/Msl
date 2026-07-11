import { describe, expect, it } from "vitest";
import type { OAuthManagerConfig } from "../oauth/oauthManager.js";
import type { TokenStore } from "../oauth/tokenStore.js";
import { createMercadoLibreAccountRegistry } from "./registry.js";
import type { MlAccountEntry } from "./state.js";

// ── Stub token store ───────────────────────────────────────────────

function stubTokenStore(): TokenStore {
  return {
    saveToken: () => {},
    getToken: () => undefined,
    deleteToken: () => {},
    withLock: async (_sellerId, fn) => fn(),
    close: () => {},
  };
}

// ── Helper to build a real OAuthManagerConfig ──────────────────────

function oauthConfig(overrides: Partial<OAuthManagerConfig> = {}): OAuthManagerConfig {
  return {
    clientId: "test-client",
    clientSecret: "test-secret",
    redirectUri: "https://example.com/callback",
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("createMercadoLibreAccountRegistry", () => {
  it("returns an empty array when no seller IDs are configured", () => {
    const entries = createMercadoLibreAccountRegistry({
      env: {},
      oauthConfigs: new Map(),
      tokenStore: stubTokenStore(),
    });
    expect(entries).toEqual([]);
  });

  it("returns one entry when only source seller is configured", () => {
    const sourceId = "12345";
    const configMap = new Map<string, OAuthManagerConfig>();
    configMap.set(sourceId, oauthConfig());

    const entries = createMercadoLibreAccountRegistry({
      env: { MERCADOLIBRE_SOURCE_SELLER_ID: sourceId },
      oauthConfigs: configMap,
      tokenStore: stubTokenStore(),
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.accountRole).toBe("source");
    expect(entry.accountName).toBe("Plasticov");
    expect(entry.sellerId).toBe(sourceId);
    expect(entry.oauthAppBinding).toBe(sourceId);
    expect(entry.enabled).toBe(true);
    expect(entry.connectionPolicy).toBe("read-only");
    expect(entry.readCapability).toBe("mercadolibre-read-plasticov");
    expect(entry.writeCapability).toBe("mercadolibre-write-plasticov");
    expect(entry.operationalScope).toBe("mlc");
  });

  it("returns one entry when only target seller is configured", () => {
    const targetId = "67890";
    const configMap = new Map<string, OAuthManagerConfig>();
    configMap.set(targetId, oauthConfig());

    const entries = createMercadoLibreAccountRegistry({
      env: { MERCADOLIBRE_TARGET_SELLER_ID: targetId },
      oauthConfigs: configMap,
      tokenStore: stubTokenStore(),
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.accountRole).toBe("target");
    expect(entry.accountName).toBe("Maustian");
    expect(entry.readCapability).toBe("mercadolibre-read-maustian");
    expect(entry.writeCapability).toBe("mercadolibre-write-maustian");
  });

  it("returns both sellers when both IDs are configured", () => {
    const sourceId = "12345";
    const targetId = "67890";
    const configMap = new Map<string, OAuthManagerConfig>();
    configMap.set(sourceId, oauthConfig());
    configMap.set(targetId, oauthConfig());

    const entries = createMercadoLibreAccountRegistry({
      env: {
        MERCADOLIBRE_SOURCE_SELLER_ID: sourceId,
        MERCADOLIBRE_TARGET_SELLER_ID: targetId,
      },
      oauthConfigs: configMap,
      tokenStore: stubTokenStore(),
    });

    expect(entries).toHaveLength(2);

    const source = entries.find((e) => e.accountRole === "source")!;
    const target = entries.find((e) => e.accountRole === "target")!;

    expect(source.sellerId).toBe(sourceId);
    expect(target.sellerId).toBe(targetId);
    expect(source.enabled).toBe(true);
    expect(target.enabled).toBe(true);
  });

  it("disables both entries when seller IDs are identical (cross-binding validation)", () => {
    const duplicateId = "same-seller";
    const configMap = new Map<string, OAuthManagerConfig>();
    configMap.set(duplicateId, oauthConfig());

    const entries = createMercadoLibreAccountRegistry({
      env: {
        MERCADOLIBRE_SOURCE_SELLER_ID: duplicateId,
        MERCADOLIBRE_TARGET_SELLER_ID: duplicateId,
      },
      oauthConfigs: configMap,
      tokenStore: stubTokenStore(),
    });

    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.enabled).toBe(false);
    }
  });

  it("disables entry when OAuth config is missing for that seller", () => {
    const sourceId = "12345";
    const targetId = "67890";
    const configMap = new Map<string, OAuthManagerConfig>();
    // Only source has OAuth config — target is missing.
    configMap.set(sourceId, oauthConfig());

    const entries = createMercadoLibreAccountRegistry({
      env: {
        MERCADOLIBRE_SOURCE_SELLER_ID: sourceId,
        MERCADOLIBRE_TARGET_SELLER_ID: targetId,
      },
      oauthConfigs: configMap,
      tokenStore: stubTokenStore(),
    });

    const source = entries.find((e) => e.accountRole === "source")!;
    const target = entries.find((e) => e.accountRole === "target")!;

    expect(source.enabled).toBe(true);
    expect(target.enabled).toBe(false);
  });

  it("handles empty/whitespace env vars gracefully", () => {
    const entries = createMercadoLibreAccountRegistry({
      env: {
        MERCADOLIBRE_SOURCE_SELLER_ID: "   ",
        MERCADOLIBRE_TARGET_SELLER_ID: "",
      },
      oauthConfigs: new Map(),
      tokenStore: stubTokenStore(),
    });

    expect(entries).toEqual([]);
  });

  it("includes both sellers even when only one has OAuth config", () => {
    const sourceId = "111";
    const targetId = "222";
    const configMap = new Map<string, OAuthManagerConfig>();
    configMap.set(sourceId, oauthConfig());

    const entries = createMercadoLibreAccountRegistry({
      env: {
        MERCADOLIBRE_SOURCE_SELLER_ID: sourceId,
        MERCADOLIBRE_TARGET_SELLER_ID: targetId,
      },
      oauthConfigs: configMap,
      tokenStore: stubTokenStore(),
    });

    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.sellerId === sourceId)!.enabled).toBe(true);
    expect(entries.find((e) => e.sellerId === targetId)!.enabled).toBe(false);
  });

  it("sets connectionPolicy to read-only for all entries", () => {
    const sourceId = "12345";
    const configMap = new Map<string, OAuthManagerConfig>();
    configMap.set(sourceId, oauthConfig());

    const entries = createMercadoLibreAccountRegistry({
      env: { MERCADOLIBRE_SOURCE_SELLER_ID: sourceId },
      oauthConfigs: configMap,
      tokenStore: stubTokenStore(),
    });

    for (const entry of entries) {
      expect(entry.connectionPolicy).toBe("read-only");
    }
  });

  it("sets cortexScope correctly per role", () => {
    const sourceId = "s1";
    const targetId = "t1";
    const configMap = new Map<string, OAuthManagerConfig>();
    configMap.set(sourceId, oauthConfig());
    configMap.set(targetId, oauthConfig());

    const entries = createMercadoLibreAccountRegistry({
      env: {
        MERCADOLIBRE_SOURCE_SELLER_ID: sourceId,
        MERCADOLIBRE_TARGET_SELLER_ID: targetId,
      },
      oauthConfigs: configMap,
      tokenStore: stubTokenStore(),
    });

    const source = entries.find((e) => e.accountRole === "source")!;
    const target = entries.find((e) => e.accountRole === "target")!;
    expect(source.cortexScope).toBe("mlc-plasticov");
    expect(target.cortexScope).toBe("mlc-maustian");
  });
});
