import type { NextRequest } from "next/server";

import { POST as postChat } from "../chat/route";
import { validateConversationAccess } from "../conversation-access/auth";

export async function POST(request: NextRequest) {
  const access = validateConversationAccess(request);
  if (!access.authorized) {
    return Response.json({ error: access.error }, { status: 401 });
  }

  const headers = new Headers({
    "content-type": request.headers.get("content-type") ?? "application/json",
  });
  const apiKey = process.env.MSL_API_KEY?.trim();
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);

  const body = await request.text();
  return postChat(
    new Request(new URL("/api/chat", request.url), {
      method: "POST",
      headers,
      body,
    }) as NextRequest,
  );
}
