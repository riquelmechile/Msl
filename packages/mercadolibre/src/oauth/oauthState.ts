import { createHmac, randomBytes } from "node:crypto";

/**
 * Payload embedded in every OAuth state token sent to MercadoLibre during the
 * authorization redirect flow.
 */
export type OAuthStatePayload = {
  /** The configured account role: "source" (Plasticov) or "target" (Maustian). */
  role: "source" | "target";
  /** The MercadoLibre seller/user ID that will authorize the app. */
  sellerId: string;
  /** Cryptographically random value to prevent state reuse / replay. */
  nonce: string;
  /** Unix-epoch milliseconds when this payload was created. */
  createdAt: number;
};

/**
 * A validated OAuth state payload — identical shape to {@link OAuthStatePayload}
 * but carries the semantic guarantee that HMAC verification and expiry checks
 * have both passed.
 */
export type ParsedState = OAuthStatePayload;

/** Default TTL for OAuth state tokens (10 minutes). */
export const DEFAULT_STATE_TTL_MS = 600_000;

/**
 * Encodes and signs an OAuth state payload.
 *
 * Format: `base64url(JSON(payload)).base64url(HMAC-SHA256)`
 *
 * @param payload  The state data to embed.
 * @param secret   Shared secret used for HMAC signing.
 * @returns The signed state string to include as the `state` query param.
 */
export function generateState(payload: OAuthStatePayload, secret: string): string {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64url");
  const hmac = createHmac("sha256", secret);
  hmac.update(payloadB64);
  const signature = hmac.digest("base64url");
  return `${payloadB64}.${signature}`;
}

/**
 * Validates and decodes an HMAC-signed OAuth state string.
 *
 * @param state  The state string received in the OAuth callback.
 * @param secret Shared secret used for HMAC verification.
 * @param ttlMs  Maximum age in milliseconds (default: 10 minutes).
 * @returns The parsed {@link OAuthStatePayload}.
 * @throws On malformed format, invalid signature, or expired state.
 */
export function validateState(
  state: string,
  secret: string,
  ttlMs = DEFAULT_STATE_TTL_MS,
): ParsedState {
  const lastDot = state.lastIndexOf(".");
  if (lastDot === -1) {
    throw new Error("Malformed state token: missing signature separator");
  }

  const payloadB64 = state.slice(0, lastDot);
  const signatureB64 = state.slice(lastDot + 1);

  if (!payloadB64 || !signatureB64) {
    throw new Error("Malformed state token: empty payload or signature");
  }

  // Verify HMAC signature.
  const hmac = createHmac("sha256", secret);
  hmac.update(payloadB64);
  const expectedSignature = hmac.digest("base64url");

  // Constant-time comparison to prevent timing attacks.
  if (
    expectedSignature.length !== signatureB64.length ||
    !timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signatureB64))
  ) {
    throw new Error("Invalid state: HMAC signature verification failed");
  }

  // Decode payload.
  let payload: OAuthStatePayload;
  try {
    const json = Buffer.from(payloadB64, "base64url").toString("utf8");
    payload = JSON.parse(json) as OAuthStatePayload;
  } catch {
    throw new Error("Malformed state token: invalid payload encoding");
  }

  if (typeof payload.role !== "string" || typeof payload.sellerId !== "string") {
    throw new Error("Malformed state token: missing required fields");
  }

  // Check expiry.
  const age = Date.now() - payload.createdAt;
  if (age > ttlMs) {
    throw new Error(
      `State token expired: age ${age}ms exceeds TTL ${ttlMs}ms`,
    );
  }

  return payload;
}

/**
 * Generates a cryptographically random nonce for state payloads.
 */
export function generateNonce(): string {
  return randomBytes(32).toString("base64url");
}

/** Timing-safe buffer comparison to prevent timing attacks. */
function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!;
  }
  return result === 0;
}
