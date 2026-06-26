import Database from "better-sqlite3";
import type { OAuthTokens, StoredToken } from "../types.js";

const TOKEN_STORE_TABLE = `
CREATE TABLE IF NOT EXISTS oauth_tokens (
  seller_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_id TEXT,
  nickname TEXT,
  account_level TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

function encode(data: string): string {
  return Buffer.from(data, "utf-8").toString("base64");
}

function decode(data: string): string {
  return Buffer.from(data, "base64").toString("utf-8");
}

export type TokenStore = {
  saveToken(sellerId: string, tokens: OAuthTokens): void;
  getToken(sellerId: string): StoredToken | undefined;
  deleteToken(sellerId: string): void;
  close(): void;
};

export function createTokenStore(dbPath = ":memory:"): TokenStore {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(TOKEN_STORE_TABLE);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO oauth_tokens
      (seller_id, access_token, refresh_token, expires_at, user_id, nickname, account_level, updated_at)
    VALUES
      (@seller_id, @access_token, @refresh_token, @expires_at, @user_id, @nickname, @account_level, datetime('now'))
  `);

  const selectStmt = db.prepare(
    "SELECT * FROM oauth_tokens WHERE seller_id = ?",
  );

  const deleteStmt = db.prepare("DELETE FROM oauth_tokens WHERE seller_id = ?");

  function expiresAt(expiresIn: number): string {
    return new Date(Date.now() + expiresIn * 1000).toISOString();
  }

  return {
    saveToken(sellerId: string, tokens: OAuthTokens): void {
      insertStmt.run({
        seller_id: sellerId,
        access_token: encode(tokens.access_token),
        refresh_token: encode(tokens.refresh_token),
        expires_at: tokens.expires_in
          ? expiresAt(tokens.expires_in)
          : expiresAt(21600),
        user_id: tokens.user_id ?? "",
        nickname: tokens.nickname ?? "",
        account_level: tokens.account_level ?? "classic",
      });
    },

    getToken(sellerId: string): StoredToken | undefined {
      const row = selectStmt.get(sellerId) as Record<string, unknown> | undefined;
      if (!row) return undefined;

      return {
        seller_id: row.seller_id as string,
        access_token: decode(row.access_token as string),
        refresh_token: decode(row.refresh_token as string),
        expires_at: row.expires_at as string,
        user_id: row.user_id as string,
        nickname: row.nickname as string,
        account_level: row.account_level as string,
      };
    },

    deleteToken(sellerId: string): void {
      deleteStmt.run(sellerId);
    },

    close(): void {
      db.close();
    },
  };
}
