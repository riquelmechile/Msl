import { NextRequest, NextResponse } from "next/server";
import { validateState } from "@msl/mercadolibre";
import { getOAuthManager } from "../oauth";

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function html(
  body: string,
  status: number,
): Response {
  return new Response(
    `<!DOCTYPE html><html><body>${body}</body></html>`,
    {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!code) {
    return html("Missing authorization code.", 400);
  }

  if (!state) {
    return html("Missing state parameter.", 400);
  }

  const secret = nonEmpty(process.env.MSL_OAUTH_STATE_SECRET);
  if (!secret) {
    return NextResponse.json(
      { error: "MSL_OAUTH_STATE_SECRET not configured." },
      { status: 500 },
    );
  }

  let parsed;
  try {
    parsed = validateState(state, secret);
  } catch (err) {
    return html(
      err instanceof Error ? err.message : "Invalid state.",
      400,
    );
  }

  const { role, sellerId } = parsed;

  // Validate role/sellerId match against configured env vars.
  const expectedSellerId = nonEmpty(
    role === "source"
      ? process.env.MERCADOLIBRE_SOURCE_SELLER_ID
      : process.env.MERCADOLIBRE_TARGET_SELLER_ID,
  );

  if (!expectedSellerId || expectedSellerId !== sellerId) {
    return html("Role/seller ID mismatch.", 400);
  }

  let tokens;
  try {
    tokens = await getOAuthManager().exchangeCodeForToken(sellerId, code);
  } catch (err) {
    console.error("OAuth code exchange failed:", err);
    return html("OAuth authorization failed. Please try again.", 500);
  }

  return html(
    `<h1>Cuenta MercadoLibre conectada correctamente</h1>` +
      `<p>Role: ${role}</p>` +
      `<p>Seller ID: ${sellerId}</p>` +
      `<p>User ID: ${tokens.user_id}</p>` +
      `<p>Nickname: ${tokens.nickname}</p>`,
    200,
  );
}
