import {
  CONVERSATION_ACCESS_DENIAL_REASONS,
  validateConversationAccessToken,
  createConversationAccessCookie,
  checkConversationAccessLoginLimit,
  recordConversationAccessLoginFailure,
} from "./auth";

const LOGIN_DENIAL_REASONS = {
  tooManyAttempts: "too_many_attempts",
} as const;

type LoginBody = {
  token?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as LoginBody;
  const token = body.token?.trim() ?? "";
  const limit = checkConversationAccessLoginLimit();
  if (!limit.allowed) {
    return Response.json(
      {
        reason: LOGIN_DENIAL_REASONS.tooManyAttempts,
        error: "Too many invalid conversation access attempts.",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } },
    );
  }

  const access = validateConversationAccessToken(token);

  if (!access.authorized) {
    if (access.reason === CONVERSATION_ACCESS_DENIAL_REASONS.invalidToken) {
      recordConversationAccessLoginFailure();
    }
    return Response.json({ reason: access.reason, error: access.error }, { status: 401 });
  }

  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": createConversationAccessCookie(token),
      },
    },
  );
}
