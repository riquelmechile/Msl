import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { POST as chat } from "../apps/web/app/api/chat/route.ts";
import { resetConversationAccessLoginLimitForTests } from "../apps/web/app/api/conversation-access/auth.ts";
import { POST as login } from "../apps/web/app/api/conversation-access/route.ts";
import { POST as conversationChat } from "../apps/web/app/api/conversation-chat/route.ts";

async function readSse(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe("/api/conversation-chat auth bridge", () => {
  afterEach(() => {
    resetConversationAccessLoginLimitForTests();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("does not expose the server chat bearer key through the browser page", () => {
    const page = readFileSync("apps/web/app/conversacion/page.tsx", "utf8");

    expect(page).not.toContain("MSL_API_KEY");
    expect(page).not.toContain("NEXT_PUBLIC_MSL_API_KEY");
    expect(page).toContain("/api/conversation-chat");
    expect(page).not.toContain("/api/chat");
  });

  it("fails closed in production when the browser access gate is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MSL_CONVERSATION_ACCESS_TOKEN", "");
    vi.stubEnv("MSL_ALLOW_UNAUTHENTICATED_LOCAL", "");

    const response = await conversationChat(
      new Request("https://msl.local/api/conversation-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hola", history: [] }),
      }) as NextRequest,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error:
        "MSL_CONVERSATION_ACCESS_TOKEN is required for browser conversation access outside local/test mode.",
    });
  });

  it("rejects browser chat calls without an operator session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MSL_CONVERSATION_ACCESS_TOKEN", "operator-token");
    vi.stubEnv("MSL_API_KEY", "server-chat-key");
    vi.stubEnv("MSL_ALLOW_UNAUTHENTICATED_LOCAL", "");

    const response = await conversationChat(
      new Request("https://msl.local/api/conversation-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hola", history: [] }),
      }) as NextRequest,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Conversation access is required." });
  });

  it("fails closed with a 401 for malformed conversation access cookies", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MSL_CONVERSATION_ACCESS_TOKEN", "operator-token");
    vi.stubEnv("MSL_API_KEY", "server-chat-key");
    vi.stubEnv("MSL_ALLOW_UNAUTHENTICATED_LOCAL", "");

    const response = await conversationChat(
      new Request("https://msl.local/api/conversation-chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "msl_conversation_access=%",
        },
        body: JSON.stringify({ message: "hola", history: [] }),
      }) as NextRequest,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Invalid conversation access token." });
  });

  it("rejects invalid access login without issuing a cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MSL_CONVERSATION_ACCESS_TOKEN", "operator-token");
    vi.stubEnv("MSL_ALLOW_UNAUTHENTICATED_LOCAL", "");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await login(
      new Request("https://msl.local/api/conversation-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "wrong-token" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "Invalid conversation access token." });
  });

  it("rate-limits repeated invalid access login attempts", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MSL_CONVERSATION_ACCESS_TOKEN", "operator-token");
    vi.stubEnv("MSL_ALLOW_UNAUTHENTICATED_LOCAL", "");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login(
        new Request("https://msl.local/api/conversation-access", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "wrong-token" }),
        }),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie")).toBeNull();
    }

    const blocked = await login(
      new Request("https://msl.local/api/conversation-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "wrong-token" }),
      }),
    );

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(blocked.headers.get("set-cookie")).toBeNull();
  });

  it("issues an HttpOnly same-site cookie and forwards authorized browser chat server-side", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MSL_CONVERSATION_ACCESS_TOKEN", "operator-token");
    vi.stubEnv("MSL_API_KEY", "server-chat-key");
    vi.stubEnv("MSL_ALLOW_UNAUTHENTICATED_LOCAL", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("MSL_CHAT_SQLITE_PATH", "");

    const loginResponse = await login(
      new Request("https://msl.local/api/conversation-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "operator-token" }),
      }),
    );
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    expect(loginResponse.status).toBe(200);
    expect(cookie).toContain("msl_conversation_access=");
    expect(cookie).not.toContain("operator-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");

    const response = await conversationChat(
      new Request("https://msl.local/api/conversation-chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-forwarded-for": "203.0.113.20",
        },
        body: JSON.stringify({ message: "hola", history: [] }),
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    const events = await readSse(response);
    expect(events.find((event) => event.type === "metadata")?.sessionId).toEqual(
      expect.any(String),
    );
  });

  it("does not forward browser-supplied IP headers into the chat rate-limit key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MSL_CONVERSATION_ACCESS_TOKEN", "operator-token");
    vi.stubEnv("MSL_API_KEY", "server-chat-key");
    vi.stubEnv("MSL_ALLOW_UNAUTHENTICATED_LOCAL", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("MSL_CHAT_SQLITE_PATH", "");

    const spoofedIp = "198.51.100.77";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await chat(
        new Request("https://msl.local/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer server-chat-key",
            "x-forwarded-for": spoofedIp,
          },
          body: JSON.stringify({ message: "" }),
        }) as NextRequest,
      );
      expect(response.status).toBe(400);
    }

    const loginResponse = await login(
      new Request("https://msl.local/api/conversation-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "operator-token" }),
      }),
    );
    const cookie = loginResponse.headers.get("set-cookie") ?? "";

    const response = await conversationChat(
      new Request("https://msl.local/api/conversation-chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-forwarded-for": spoofedIp,
          "x-real-ip": spoofedIp,
        },
        body: JSON.stringify({ message: "hola", history: [] }),
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
  });
});
