/**
 * Next.js instrumentation hook — runs once at server startup.
 *
 * Loads `.env` / `.env.local` from the monorepo root so they are
 * available to API routes, server components, and server-side logic
 * without the `apps/web/.env.local` symlink workaround.
 *
 * Uses Node.js built-ins only to avoid cross-package import issues
 * with Next.js webpack bundling.
 */
export async function register() {
  if (process.env.MSL_SKIP_ENV_FILE === "true") return;

  const fs = await import("node:fs");
  const path = await import("node:path");

  // Walk up from __dirname (or cwd) to find the repo root
  // (the directory containing package.json with "workspaces").
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    try {
      const pkgPath = path.join(dir, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.workspaces) break; // found repo root
    } catch {
      // package.json not readable — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  function loadEnvFile(filename: string) {
    try {
      const content = fs.readFileSync(path.join(dir, filename), "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const raw = trimmed.slice(eq + 1).trim();
        // Respect pre-existing process.env values
        if (process.env[key] !== undefined) continue;
        // Strip surrounding quotes
        const value =
          (raw.startsWith('"') && raw.endsWith('"')) ||
          (raw.startsWith("'") && raw.endsWith("'"))
            ? raw.slice(1, -1)
            : raw;
        process.env[key] = value;
      }
    } catch {
      // File missing — non-fatal
    }
  }

  loadEnvFile(".env");
  loadEnvFile(".env.local");
}
