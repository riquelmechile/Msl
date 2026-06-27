import { createHash, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "msl_conversation_access";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8;
const INVALID_LOGIN_KEY = "conversation-access";
const INVALID_LOGIN_MAX = 5;
const INVALID_LOGIN_WINDOW_MS = 60_000;
const INVALID_LOGIN_LOCKOUT_MS = 60_000;

export const CONVERSATION_ACCESS_DENIAL_REASONS = {
  unconfigured: "unconfigured",
  missingToken: "missing_token",
  invalidToken: "invalid_token",
} as const;

type ConversationAccessDenialReason =
  (typeof CONVERSATION_ACCESS_DENIAL_REASONS)[keyof typeof CONVERSATION_ACCESS_DENIAL_REASONS];

const CONVERSATION_ACCESS_DENIAL_MESSAGES: Record<ConversationAccessDenialReason, string> = {
  [CONVERSATION_ACCESS_DENIAL_REASONS.unconfigured]:
    "MSL_CONVERSATION_ACCESS_TOKEN is required for browser conversation access outside local/test mode.",
  [CONVERSATION_ACCESS_DENIAL_REASONS.missingToken]: "Conversation access is required.",
  [CONVERSATION_ACCESS_DENIAL_REASONS.invalidToken]: "Invalid conversation access token.",
};

type ConversationAccessResult =
  | { authorized: true }
  | { authorized: false; reason: ConversationAccessDenialReason; error: string };

type InvalidLoginState = {
  count: number;
  resetAt: number;
  lockedUntil: number;
};

const invalidLoginAttempts = new Map<string, InvalidLoginState>();

function allowUnauthenticatedLocal(): boolean {
  return process.env.MSL_ALLOW_UNAUTHENTICATED_LOCAL === "true" || process.env.NODE_ENV === "test";
}

function getAccessToken(): string | null {
  const token = process.env.MSL_CONVERSATION_ACCESS_TOKEN?.trim();
  return token || null;
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

function createCookieValue(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function denyConversationAccess(reason: ConversationAccessDenialReason): ConversationAccessResult {
  return { authorized: false, reason, error: CONVERSATION_ACCESS_DENIAL_MESSAGES[reason] };
}

export function validateConversationAccessToken(candidate: string): ConversationAccessResult {
  const accessToken = getAccessToken();
  if (!accessToken) {
    if (allowUnauthenticatedLocal()) return { authorized: true };
    return denyConversationAccess(CONVERSATION_ACCESS_DENIAL_REASONS.unconfigured);
  }

  if (!safeEqual(candidate, accessToken)) {
    return denyConversationAccess(CONVERSATION_ACCESS_DENIAL_REASONS.invalidToken);
  }

  return { authorized: true };
}

export function validateConversationAccess(request: Request): ConversationAccessResult {
  if (allowUnauthenticatedLocal()) return { authorized: true };

  const accessToken = getAccessToken();
  if (!accessToken) {
    return denyConversationAccess(CONVERSATION_ACCESS_DENIAL_REASONS.unconfigured);
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const accessCookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);

  if (!accessCookie) return denyConversationAccess(CONVERSATION_ACCESS_DENIAL_REASONS.missingToken);

  let decodedCookie: string;
  try {
    decodedCookie = decodeURIComponent(accessCookie);
  } catch {
    return denyConversationAccess(CONVERSATION_ACCESS_DENIAL_REASONS.invalidToken);
  }

  if (!safeEqual(decodedCookie, createCookieValue(accessToken))) {
    return denyConversationAccess(CONVERSATION_ACCESS_DENIAL_REASONS.invalidToken);
  }

  return { authorized: true };
}

export function createConversationAccessCookie(token: string): string {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(createCookieValue(token))}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function checkConversationAccessLoginLimit(): { allowed: boolean; retryAfter?: number } {
  if (!getAccessToken()) return { allowed: true };

  const now = Date.now();
  const entry = invalidLoginAttempts.get(INVALID_LOGIN_KEY);
  if (!entry) return { allowed: true };

  if (entry.lockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
  }

  if (now > entry.resetAt) invalidLoginAttempts.delete(INVALID_LOGIN_KEY);
  return { allowed: true };
}

export function recordConversationAccessLoginFailure(): void {
  if (!getAccessToken()) return;

  const now = Date.now();
  const current = invalidLoginAttempts.get(INVALID_LOGIN_KEY);
  const entry =
    !current || now > current.resetAt
      ? { count: 0, resetAt: now + INVALID_LOGIN_WINDOW_MS, lockedUntil: 0 }
      : current;

  entry.count += 1;
  if (entry.count >= INVALID_LOGIN_MAX) entry.lockedUntil = now + INVALID_LOGIN_LOCKOUT_MS;
  invalidLoginAttempts.set(INVALID_LOGIN_KEY, entry);

  console.warn("Invalid conversation access token attempt", {
    count: entry.count,
    locked: entry.lockedUntil > now,
  });
}

export function resetConversationAccessLoginLimitForTests(): void {
  invalidLoginAttempts.clear();
}
