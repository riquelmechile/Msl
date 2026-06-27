import {
  validateConversationAccessToken,
  createConversationAccessCookie,
  checkConversationAccessLoginLimit,
  recordConversationAccessLoginFailure,
} from "./auth";

type LoginBody = {
  token?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as LoginBody;
  const token = body.token?.trim() ?? "";
  const limit = checkConversationAccessLoginLimit();
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many invalid conversation access attempts." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } },
    );
  }

  const access = validateConversationAccessToken(token);

  if (!access.authorized) {
    if (access.error === "Invalid conversation access token.") {
      recordConversationAccessLoginFailure();
    }
    return Response.json({ error: access.error }, { status: 401 });
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
