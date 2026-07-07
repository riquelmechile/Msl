import { NextRequest, NextResponse } from "next/server";
import { generateState } from "@msl/mercadolibre";
import { getOAuthManager } from "../oauth";

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function GET(request: NextRequest) {
  const role = request.nextUrl.searchParams.get("role");

  if (role !== "source" && role !== "target") {
    return NextResponse.json(
      { error: "Unknown role. Use 'source' or 'target'." },
      { status: 400 },
    );
  }

  const sellerId = nonEmpty(
    role === "source"
      ? process.env.MERCADOLIBRE_SOURCE_SELLER_ID
      : process.env.MERCADOLIBRE_TARGET_SELLER_ID,
  );

  if (!sellerId) {
    return NextResponse.json(
      { error: `Seller ID not configured for role '${role}'` },
      { status: 500 },
    );
  }

  const secret = nonEmpty(process.env.MSL_OAUTH_STATE_SECRET);
  if (!secret) {
    return NextResponse.json(
      { error: "MSL_OAUTH_STATE_SECRET not configured." },
      { status: 500 },
    );
  }

  const state = generateState(
    {
      role: role as "source" | "target",
      sellerId,
      nonce: crypto.randomUUID(),
      createdAt: Date.now(),
    },
    secret,
  );

  const authUrl = getOAuthManager().getAuthorizationUrl(sellerId, state);
  return NextResponse.redirect(authUrl, 302);
}
