import { describe, expect, it } from "vitest";
import { resolveOAuthConfigs } from "./oauthConfig.js";

describe("resolveOAuthConfigs", () => {
  it("returns an empty Map when no env vars are set", () => {
    const configs = resolveOAuthConfigs({});
    expect(configs.size).toBe(0);
  });

  it("resolves per-seller vars for source and target", () => {
    const env: NodeJS.ProcessEnv = {
      MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov",
      MERCADOLIBRE_TARGET_SELLER_ID: "maustian",
      MERCADOLIBRE_SOURCE_CLIENT_ID: "src-client",
      MERCADOLIBRE_SOURCE_CLIENT_SECRET: "src-secret",
      MERCADOLIBRE_SOURCE_REDIRECT_URI: "https://src.example/callback",
      MERCADOLIBRE_TARGET_CLIENT_ID: "tgt-client",
      MERCADOLIBRE_TARGET_CLIENT_SECRET: "tgt-secret",
      MERCADOLIBRE_TARGET_REDIRECT_URI: "https://tgt.example/callback",
      MSL_MERCADOLIBRE_OAUTH_DB_PATH: "/tmp/test.db",
    };

    const configs = resolveOAuthConfigs(env);
    expect(configs.size).toBe(2);

    const source = configs.get("plasticov");
    expect(source).toBeDefined();
    expect(source!.clientId).toBe("src-client");
    expect(source!.clientSecret).toBe("src-secret");
    expect(source!.redirectUri).toBe("https://src.example/callback");
    expect(source!.dbPath).toBe("/tmp/test.db");

    const target = configs.get("maustian");
    expect(target).toBeDefined();
    expect(target!.clientId).toBe("tgt-client");
    expect(target!.clientSecret).toBe("tgt-secret");
    expect(target!.redirectUri).toBe("https://tgt.example/callback");
    expect(target!.dbPath).toBe("/tmp/test.db");
  });

  it("per-seller vars take priority over legacy", () => {
    const env: NodeJS.ProcessEnv = {
      MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov",
      MERCADOLIBRE_CLIENT_ID: "legacy-client",
      MERCADOLIBRE_CLIENT_SECRET: "legacy-secret",
      MERCADOLIBRE_REDIRECT_URI: "https://legacy.example/callback",
      MERCADOLIBRE_SOURCE_CLIENT_ID: "src-client",
      MERCADOLIBRE_SOURCE_CLIENT_SECRET: "src-secret",
      MERCADOLIBRE_SOURCE_REDIRECT_URI: "https://src.example/callback",
    };

    const configs = resolveOAuthConfigs(env);
    expect(configs.size).toBe(1);

    const source = configs.get("plasticov");
    expect(source).toBeDefined();
    expect(source!.clientId).toBe("src-client");
    expect(source!.clientSecret).toBe("src-secret");
    expect(source!.redirectUri).toBe("https://src.example/callback");
  });

  it("falls back to legacy when per-seller vars are absent", () => {
    const env: NodeJS.ProcessEnv = {
      MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov",
      MERCADOLIBRE_CLIENT_ID: "legacy-client",
      MERCADOLIBRE_CLIENT_SECRET: "legacy-secret",
      MERCADOLIBRE_REDIRECT_URI: "https://legacy.example/callback",
    };

    const configs = resolveOAuthConfigs(env);
    expect(configs.size).toBe(1);

    const source = configs.get("plasticov");
    expect(source).toBeDefined();
    expect(source!.clientId).toBe("legacy-client");
    expect(source!.clientSecret).toBe("legacy-secret");
    expect(source!.redirectUri).toBe("https://legacy.example/callback");
  });

  it("both sellers share single legacy config when only legacy vars are set", () => {
    const env: NodeJS.ProcessEnv = {
      MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov",
      MERCADOLIBRE_TARGET_SELLER_ID: "maustian",
      MERCADOLIBRE_CLIENT_ID: "legacy-client",
      MERCADOLIBRE_CLIENT_SECRET: "legacy-secret",
      MERCADOLIBRE_REDIRECT_URI: "https://legacy.example/callback",
    };

    const configs = resolveOAuthConfigs(env);
    expect(configs.size).toBe(2);

    const source = configs.get("plasticov");
    expect(source!.clientId).toBe("legacy-client");

    const target = configs.get("maustian");
    expect(target!.clientId).toBe("legacy-client");
  });

  it("omits seller when no credentials can be resolved", () => {
    const env: NodeJS.ProcessEnv = {
      MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov",
      // No credential vars at all
    };

    const configs = resolveOAuthConfigs(env);
    expect(configs.size).toBe(0);
  });

  it("includes only sellers with resolvable credentials", () => {
    const env: NodeJS.ProcessEnv = {
      MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov",
      MERCADOLIBRE_TARGET_SELLER_ID: "maustian",
      MERCADOLIBRE_SOURCE_CLIENT_ID: "src-client",
      MERCADOLIBRE_SOURCE_CLIENT_SECRET: "src-secret",
      MERCADOLIBRE_SOURCE_REDIRECT_URI: "https://src.example/callback",
      // Target has no credentials — neither per-seller nor legacy
    };

    const configs = resolveOAuthConfigs(env);
    expect(configs.size).toBe(1);
    expect(configs.has("plasticov")).toBe(true);
    expect(configs.has("maustian")).toBe(false);
  });

  it("dbPath is undefined when MSL_MERCADOLIBRE_OAUTH_DB_PATH is not set", () => {
    const env: NodeJS.ProcessEnv = {
      MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov",
      MERCADOLIBRE_CLIENT_ID: "legacy-client",
      MERCADOLIBRE_CLIENT_SECRET: "legacy-secret",
      MERCADOLIBRE_REDIRECT_URI: "https://legacy.example/callback",
    };

    const configs = resolveOAuthConfigs(env);
    const source = configs.get("plasticov");
    expect(source!.dbPath).toBeUndefined();
  });
});
