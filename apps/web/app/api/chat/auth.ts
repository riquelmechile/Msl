function allowUnauthenticatedLocal(): boolean {
  return process.env.MSL_ALLOW_UNAUTHENTICATED_LOCAL === "true" || process.env.NODE_ENV === "test";
}

/**
 * Validates the request's Authorization header against the configured API key.
 *
 * When `MSL_API_KEY` is not set, requests are rejected unless explicit
 * local/demo unauthenticated mode is enabled.
 * Otherwise the caller must provide `Authorization: Bearer <key>`.
 */
export function validateAuth(request: Request): { authorized: boolean; error?: string } {
  const API_KEY = process.env.MSL_API_KEY;
  if (!API_KEY) {
    if (allowUnauthenticatedLocal()) return { authorized: true };
    return {
      authorized: false,
      error:
        "MSL_API_KEY is required. Set MSL_ALLOW_UNAUTHENTICATED_LOCAL=true only for local demo/development.",
    };
  }
  const auth = request.headers.get("authorization");
  if (!auth) return { authorized: false, error: "Missing Authorization header" };
  if (auth !== `Bearer ${API_KEY}`) return { authorized: false, error: "Invalid API key" };
  return { authorized: true };
}
