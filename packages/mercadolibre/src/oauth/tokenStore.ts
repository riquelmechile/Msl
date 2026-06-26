import Database from "better-sqlite3";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
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

// ── AES-256-GCM Encryption ──────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const SALT = "msl-salt";

const KEY: Buffer = (() => {
  const secret = process.env.MSL_ENCRYPTION_KEY;
  if (!secret) {
    console.warn(
      "⚠️  MSL_ENCRYPTION_KEY not set — using development key. Tokens are NOT secure.",
    );
    return scryptSync("msl-dev-key-change-me", SALT, 32);
  }
  return scryptSync(secret, SALT, 32);
})();

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns `iv:authTag:ciphertext` (all base64-encoded).
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypts a ciphertext string produced by `encrypt()`.
 * Expects the format `iv:authTag:ciphertext`.
 */
export function decrypt(ciphertext: string): string {
  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(":");
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error("Invalid ciphertext format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export type TokenStore = {
  saveToken(sellerId: string, tokens: OAuthTokens): void;
  getToken(sellerId: string): StoredToken | undefined;
  deleteToken(sellerId: string): void;
  /** Execute fn while holding a per-seller lock to prevent concurrent refresh races. */
  withLock<T>(sellerId: string, fn: () => Promise<T>): Promise<T>;
  close(): void;
};

export function createTokenStore(dbPath = ":memory:"): TokenStore {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(TOKEN_STORE_TABLE);

  // ── Per-seller promise-based mutex ──────────────────────────────
  // Prevents concurrent token refresh for the same seller by
  // serialising refresh calls through a per-seller lock promise chain.
  const locks = new Map<string, Promise<unknown>>();

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
        access_token: encrypt(tokens.access_token),
        refresh_token: encrypt(tokens.refresh_token),
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
        access_token: decrypt(row.access_token as string),
        refresh_token: decrypt(row.refresh_token as string),
        expires_at: row.expires_at as string,
        user_id: row.user_id as string,
        nickname: row.nickname as string,
        account_level: row.account_level as string,
      };
    },

    deleteToken(sellerId: string): void {
      deleteStmt.run(sellerId);
    },

    async withLock<T>(sellerId: string, fn: () => Promise<T>): Promise<T> {
      // Chain this call onto the previous lock promise for this seller.
      // Each subsequent caller waits for the previous one to finish,
      // effectively serialising concurrent access to the same seller.
      const prev = locks.get(sellerId) ?? Promise.resolve();
      let release: () => void;
      const next = new Promise<void>((resolve) => { release = resolve; });
      locks.set(sellerId, prev.then(() => next));
      try {
        await prev;
        return await fn();
      } finally {
        release!();
      }
    },

    close(): void {
      locks.clear();
      db.close();
    },
  };
}
