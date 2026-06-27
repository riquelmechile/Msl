import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import OpenAI from "openai";

import { validateAuth } from "../apps/web/app/api/chat/auth.ts";
import { POST } from "../apps/web/app/api/chat/route.ts";

vi.mock("openai", () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

async function readSse(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe("/api/chat auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
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

  it("keeps demo chat local even when a DeepSeek key exists without durable chat state", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key-that-must-not-be-called");
    vi.stubEnv("MSL_CHAT_SQLITE_PATH", "");

    const response = await POST(
      new Request("https://msl.local/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.10",
        },
        body: JSON.stringify({ message: "hola", history: [] }),
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    const events = await readSse(response);
    const metadata = events.find((event) => event.type === "metadata");
    expect(metadata?.sessionId).toEqual(expect.any(String));
    expect(OpenAI).not.toHaveBeenCalled();
  });

  it("persists chat session state in SQLite when durable chat is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "msl-chat-"));
    const sqlitePath = join(dir, "chat.sqlite");
    try {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("DEEPSEEK_API_KEY", "");
      vi.stubEnv("MSL_CHAT_SQLITE_PATH", sqlitePath);
      vi.stubEnv("MSL_CHAT_SELLER_ID", "seller-a");

      const first = await POST(
        new Request("https://msl.local/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.11",
          },
          body: JSON.stringify({ message: "hola", history: [] }),
        }) as NextRequest,
      );
      const firstMetadata = (await readSse(first)).find((event) => event.type === "metadata");
      const sessionId = firstMetadata?.sessionId;

      expect(sessionId).toEqual(expect.any(String));

      const second = await POST(
        new Request("https://msl.local/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.12",
          },
          body: JSON.stringify({ message: "margen", sessionId }),
        }) as NextRequest,
      );

      expect(second.status).toBe(200);
      const secondEvents = await readSse(second);
      const secondMetadata = secondEvents.find((event) => event.type === "metadata");
      expect(secondMetadata?.sessionId).toBe(sessionId);

      const db = new Database(sqlitePath, { readonly: true });
      try {
        const rows = db.prepare("SELECT id, state_json FROM sessions ORDER BY id").all() as Array<{
          id: string;
          state_json: string;
        }>;
        expect(rows).toHaveLength(1);
        expect(rows[0]?.id).toBe(`seller-a:${sessionId}`);

        const state = JSON.parse(rows[0]!.state_json) as {
          messages?: Array<{ role?: string; content?: string }>;
        };
        expect(state.messages?.map((message) => message.content)).toEqual(
          expect.arrayContaining(["hola", "margen"]),
        );
        expect(state.messages?.filter((message) => message.role === "user")).toHaveLength(2);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid client session IDs", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MSL_CHAT_SQLITE_PATH", "");

    const response = await POST(
      new Request("https://msl.local/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.13",
        },
        body: JSON.stringify({ message: "hola", sessionId: "../seller-a:secret" }),
      }) as NextRequest,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid sessionId." });
  });

  it("fails closed when durable chat is configured without an explicit non-demo seller id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "msl-chat-"));
    try {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("DEEPSEEK_API_KEY", "");
      vi.stubEnv("MSL_CHAT_SQLITE_PATH", join(dir, "chat.sqlite"));
      vi.stubEnv("MSL_CHAT_SELLER_ID", "");

      const response = await POST(
        new Request("https://msl.local/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.16",
          },
          body: JSON.stringify({ message: "hola", history: [] }),
        }) as NextRequest,
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error:
          "MSL_CHAT_SELLER_ID must be explicitly set to a non-demo seller id for durable chat.",
      });

      vi.stubEnv("MSL_CHAT_SELLER_ID", "seller-mlc-demo");
      const demoSellerResponse = await POST(
        new Request("https://msl.local/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.17",
          },
          body: JSON.stringify({ message: "hola", history: [] }),
        }) as NextRequest,
      );

      expect(demoSellerResponse.status).toBe(500);
      await expect(demoSellerResponse.json()).resolves.toEqual({
        error:
          "MSL_CHAT_SELLER_ID must be explicitly set to a non-demo seller id for durable chat.",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      tableName: "ceo_strategies",
      seedSql: `
        CREATE TABLE ceo_strategies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rule_type TEXT NOT NULL,
          rule_text TEXT NOT NULL,
          parsed_rule TEXT NOT NULL
        );
        INSERT INTO ceo_strategies (rule_type, rule_text, parsed_rule)
        VALUES ('pricing', 'keep margin', '{}');
      `,
    },
    {
      tableName: "autonomy_state",
      seedSql: `
        CREATE TABLE autonomy_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          current_level INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO autonomy_state (id, current_level) VALUES (1, 1);
      `,
    },
  ])(
    "refuses to adopt an unbound durable chat database with existing $tableName rows",
    async ({ seedSql }) => {
      const dir = mkdtempSync(join(tmpdir(), "msl-chat-"));
      const sqlitePath = join(dir, "chat.sqlite");

      try {
        const db = new Database(sqlitePath);
        try {
          db.exec(seedSql);
        } finally {
          db.close();
        }

        vi.stubEnv("NODE_ENV", "test");
        vi.stubEnv("DEEPSEEK_API_KEY", "");
        vi.stubEnv("MSL_CHAT_SQLITE_PATH", sqlitePath);
        vi.stubEnv("MSL_CHAT_SELLER_ID", "seller-a");

        const response = await POST(
          new Request("https://msl.local/api/chat", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-for": "203.0.113.18",
            },
            body: JSON.stringify({ message: "hola", history: [] }),
          }) as NextRequest,
        );

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
          error:
            "MSL_CHAT_SQLITE_PATH contains durable state without a seller namespace; refusing to adopt it automatically.",
        });

        const readonlyDb = new Database(sqlitePath, { readonly: true });
        try {
          const namespace = readonlyDb
            .prepare("SELECT seller_id FROM chat_seller_namespace WHERE id = 1")
            .get();
          expect(namespace).toBeUndefined();
        } finally {
          readonlyDb.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("fails closed when a durable chat database is reused for another seller", async () => {
    const dir = mkdtempSync(join(tmpdir(), "msl-chat-"));
    const sqlitePath = join(dir, "chat.sqlite");
    const clientSessionId = "018f2a86-7b2d-4e4c-9f0d-111111111111";

    try {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("DEEPSEEK_API_KEY", "");
      vi.stubEnv("MSL_CHAT_SQLITE_PATH", sqlitePath);

      vi.stubEnv("MSL_CHAT_SELLER_ID", "seller-a");
      const sellerA = await POST(
        new Request("https://msl.local/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.14",
          },
          body: JSON.stringify({ message: "hola", sessionId: clientSessionId }),
        }) as NextRequest,
      );

      expect(sellerA.status).toBe(200);

      vi.stubEnv("MSL_CHAT_SELLER_ID", "seller-b");
      const sellerB = await POST(
        new Request("https://msl.local/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.15",
          },
          body: JSON.stringify({ message: "hola", sessionId: clientSessionId }),
        }) as NextRequest,
      );

      expect(sellerB.status).toBe(500);
      await expect(sellerB.json()).resolves.toEqual({
        error: "MSL_CHAT_SQLITE_PATH is already bound to a different seller id.",
      });

      const db = new Database(sqlitePath, { readonly: true });
      try {
        const rows = db.prepare("SELECT id FROM sessions ORDER BY id").all() as Array<{
          id: string;
        }>;
        expect(rows).toEqual([{ id: `seller-a:${clientSessionId}` }]);

        const namespace = db
          .prepare("SELECT seller_id FROM chat_seller_namespace WHERE id = 1")
          .get();
        expect(namespace).toEqual({ seller_id: "seller-a" });
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
