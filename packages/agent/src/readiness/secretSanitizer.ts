/**
 * Sanitize a configuration value so that secrets are never exposed in output.
 *
 * Rules:
 * - undefined/empty → "[missing]"
 * - Placeholder patterns → "[placeholder]"
 * - Keys containing "key", "secret", "token", "password", "auth" → "[present]"
 * - Paths, URLs, modes, flags → shown as-is
 * - Everything else → shown as-is
 */
export function sanitizeSecret(key: string, value: string | undefined): string {
  if (value === undefined || value === "") return "[missing]";

  // Check for placeholder patterns
  if (/^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(value.trim())) {
    return "[placeholder]";
  }

  const lower = key.toLowerCase();

  // NEVER output raw values for secrets
  if (
    lower.includes("key") ||
    lower.includes("secret") ||
    lower.includes("token") ||
    lower.includes("password") ||
    lower.includes("auth")
  ) {
    return "[present]";
  }

  // Paths and non-secret configs can be shown (sanitized)
  if (
    lower.includes("path") ||
    lower.includes("dir") ||
    lower.includes("mode") ||
    lower.includes("enabled") ||
    lower.includes("url") ||
    lower.includes("host") ||
    lower.includes("model") ||
    lower.includes("name") ||
    lower.includes("id") ||
    lower.includes("timeout") ||
    lower.includes("usd") ||
    lower.includes("job") ||
    lower.includes("cooldown") ||
    lower.includes("profile")
  ) {
    // Strip embedded credentials from URLs before returning
    if ((lower.includes("url") || lower.includes("host")) && value.includes("@")) {
      try {
        const u = new URL(value);
        if (u.username || u.password) {
          u.username = "";
          u.password = "";
          return u.toString().replace("://@", "://");
        }
      } catch {
        // Not a valid URL — redact to avoid leaking credential-like values
        return "[redacted-url]";
      }
    }
    return value;
  }

  // Default: show value for non-sensitive
  return value;
}

/**
 * Sanitize a full env map for safe display. Returns a new Record with sanitized values.
 */
export function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = sanitizeSecret(key, value);
  }
  return result;
}
