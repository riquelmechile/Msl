import { afterEach, describe, expect, it, vi } from "vitest";

import { validateAuth } from "../apps/web/app/api/chat/auth.ts";

describe("/api/chat auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when MSL_API_KEY is missing outside explicit local/demo mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MSL_API_KEY", "");
    vi.stubEnv("MSL_ALLOW_UNAUTHENTICATED_LOCAL", "");

    const result = validateAuth(new Request("https://msl.local/api/chat"));

    expect(result.authorized).toBe(false);
    expect(result.error).toContain("MSL_API_KEY is required");
  });

  it("allows missing MSL_API_KEY only with explicit local/demo opt-in", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MSL_API_KEY", "");
    vi.stubEnv("MSL_ALLOW_UNAUTHENTICATED_LOCAL", "true");

    const result = validateAuth(new Request("https://msl.local/api/chat"));

    expect(result.authorized).toBe(true);
  });
});
