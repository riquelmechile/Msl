import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Walks up from `startDir` (default: `process.cwd()`) until it finds a
 * directory containing a `package.json` whose parsed content includes a
 * `workspaces` field.
 *
 * Returns the absolute path to the repository root, or `undefined` if no
 * monorepo root could be detected.
 */
export function getRepoRoot(startDir?: string): string | undefined {
  const dir = startDir ? resolve(startDir) : process.cwd();

  for (let current = dir; ; current = dirname(current)) {
    const pkgPath = join(current, "package.json");

    if (existsSync(pkgPath)) {
      try {
        const raw = readFileSync(pkgPath, "utf-8");
        const pkg = JSON.parse(raw) as Record<string, unknown>;
        if (Array.isArray(pkg.workspaces)) {
          return current;
        }
      } catch {
        // Corrupt or unparseable package.json — skip and keep walking.
      }
    }

    const parent = dirname(current);
    if (parent === current) break; // reached filesystem root
  }

  return undefined;
}

type LoadEnvOptions = {
  /** Skip the loader entirely when true (default: checks MSL_SKIP_ENV_FILE). */
  skip?: boolean;
};

/**
 * Reads a dotenv-style file and loads every key=value line into
 * `process.env`, skipping any key that is present in `protectedKeys`.
 *
 * Format rules (compatible with dotenv conventions but without the npm
 * dependency):
 *
 * - Blank lines are skipped.
 * - Lines starting with `#` are treated as comments and skipped.
 * - Each key-value line must contain at least one `=` character.
 * - Keys are trimmed of surrounding whitespace.
 * - Values are trimmed, and surrounding single or double quotes are
 *   stripped when present and balanced.
 * - Multi-line values and variable interpolation are **not** supported.
 */
function loadEnvFile(filePath: string, protectedKeys: ReadonlySet<string>): void {
  if (!existsSync(filePath)) return;

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return; // permission errors, etc. — graceful skip
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();

    // Never overwrite an externally-set (protected) env value.
    if (protectedKeys.has(key)) continue;

    process.env[key] = stripQuotes(rawValue);
  }
}

/**
 * Strips surrounding single or double quotes from an env value when both
 * ends are quoted with the same character.  Returns the original string
 * otherwise.
 */
function stripQuotes(value: string): string {
  if (value.length < 2) return value;

  const first = value[0];
  const last = value[value.length - 1];

  if (
    (first === '"' && last === '"') ||
    (first === "'" && last === "'")
  ) {
    return value.slice(1, -1);
  }

  return value;
}

/**
 * Detects the monorepo root and loads `.env` followed by `.env.local` from
 * that root, populating `process.env` only for keys that are not already
 * set.
 *
 * ## Behaviour
 *
 * 1. If `MSL_SKIP_ENV_FILE === "true"` or `options.skip === true`, the
 *    function returns immediately without touching the filesystem.
 * 2. The repository root is determined via {@link getRepoRoot} (walking up
 *    from `process.cwd()` for a `package.json` with a `workspaces` field).
 * 3. `.env` at the repo root is loaded first.
 * 4. `.env.local` at the repo root is loaded second — values defined there
 *    are applied only for keys not already present in `process.env`.
 *    **However**, because `.env` may have already populated a key, the
 *    `.env.local` override happens organically: `.env.local` is parsed
 *    *after* `.env`, so its values take effect *unless* the key was already
 *    set externally (which is never overwritten).
 * 5. If the repo root cannot be determined, the function returns without
 *    error (e.g. the caller is not inside the monorepo).
 * 6. Missing files are non-fatal — the loader silently skips them.
 *
 * ## Server-Only
 *
 * This function uses Node.js `fs` and `path` modules.  It **must not** be
 * imported in browser or Edge runtime bundles.
 */
export function loadRepositoryEnvironment(options: LoadEnvOptions = {}): void {
  if (options.skip || process.env.MSL_SKIP_ENV_FILE === "true") return;

  const root = getRepoRoot();
  if (!root) return;

  // Capture keys already present in process.env BEFORE loading any file.
  // These are protected — they came from the container/runtime/PM2.
  const protectedKeys = new Set(Object.keys(process.env));

  // Load .env first.  Keys from .env are NOT added to protectedKeys,
  // so .env.local can override them.
  loadEnvFile(join(root, ".env"), protectedKeys);

  // Load .env.local second.  It still respects the original protected set
  // but CAN override keys that .env set.
  loadEnvFile(join(root, ".env.local"), protectedKeys);
}
