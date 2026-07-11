import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { getRepoRoot, loadRepositoryEnvironment } from "./env.js";

// ── Helpers ────────────────────────────────────────────────────────

function createTempRepo(): string {
  const dir = join(tmpdir(), `msl-env-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePkg(dir: string, workspaces?: string[]): void {
  const pkg = workspaces
    ? JSON.stringify({ name: "test-monorepo", workspaces })
    : JSON.stringify({ name: "test-pkg" });
  writeFileSync(join(dir, "package.json"), pkg);
}

const SAVED_ENV = { ...process.env };

function clearEnvKeys(keys: string[]): void {
  for (const k of keys) {
    delete process.env[k];
  }
}

beforeEach(() => {
  // Restore process.env to a known baseline — but preserve NODE_ENV
  // since vitest uses it internally.
  const nodeEnv = process.env.NODE_ENV;
  for (const k of Object.keys(process.env)) {
    if (k === "NODE_ENV") continue;
    delete process.env[k];
  }
  if (nodeEnv) process.env.NODE_ENV = nodeEnv;
  delete process.env.MSL_SKIP_ENV_FILE;
});

afterEach(() => {
  // Restore original env for subsequent test files.
  for (const k of Object.keys(process.env)) {
    delete process.env[k];
  }
  Object.assign(process.env, SAVED_ENV);
});

// ── getRepoRoot ────────────────────────────────────────────────────

describe("getRepoRoot", () => {
  it("finds the real monorepo root from this test file's directory", () => {
    const root = getRepoRoot(__dirname);
    expect(root).toBeDefined();
    expect(existsSync(join(root!, "package.json"))).toBe(true);
    const pkg = JSON.parse(
      require("node:fs").readFileSync(join(root!, "package.json"), "utf-8"),
    );
    expect(Array.isArray(pkg.workspaces)).toBe(true);
  });

  it("returns undefined when no parent has workspaces", () => {
    const dir = createTempRepo();
    writePkg(dir); // no workspaces field
    mkdirSync(join(dir, "deep", "nested"), { recursive: true });
    expect(getRepoRoot(join(dir, "deep", "nested"))).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the closest parent with workspaces", () => {
    const root = createTempRepo();
    writePkg(root, ["packages/*"]);
    mkdirSync(join(root, "packages", "foo"), { recursive: true });
    writePkg(join(root, "packages", "foo")); // no workspaces here
    expect(getRepoRoot(join(root, "packages", "foo"))).toBe(root);
    rmSync(root, { recursive: true, force: true });
  });

  it("defaults to process.cwd() when no startDir is given", () => {
    // Just verify it doesn't throw and returns something (or undefined).
    const result = getRepoRoot();
    expect(typeof result === "string" || result === undefined).toBe(true);
  });
});

// ── loadRepositoryEnvironment ──────────────────────────────────────

describe("loadRepositoryEnvironment", () => {
  it("skips when MSL_SKIP_ENV_FILE=true", () => {
    process.env.MSL_SKIP_ENV_FILE = "true";
    // Call should return immediately — no side effects.
    loadRepositoryEnvironment();
    // Just verifying it didn't throw is enough for skip mode.
  });

  it("skips when options.skip is true", () => {
    loadRepositoryEnvironment({ skip: true });
    // Should return immediately.
  });

  it("loads .env correctly in a temp monorepo", () => {
    const root = createTempRepo();
    writePkg(root, ["packages/*"]);
    writeFileSync(join(root, ".env"), "# comment\nKEY_ONE=value1\nKEY_TWO=value2\n");
    const cwd = process.cwd();
    try {
      process.chdir(root);
      loadRepositoryEnvironment();
      expect(process.env.KEY_ONE).toBe("value1");
      expect(process.env.KEY_TWO).toBe("value2");
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it(".env.local overrides .env", () => {
    const root = createTempRepo();
    writePkg(root, ["packages/*"]);
    writeFileSync(join(root, ".env"), "KEY=from_dotenv\nOTHER=shared\n");
    writeFileSync(join(root, ".env.local"), "KEY=from_local\n");
    const cwd = process.cwd();
    try {
      process.chdir(root);
      loadRepositoryEnvironment();
      // .env loads first ("from_dotenv"), then .env.local sets "from_local"
      // BUT: .env.local only sets if process.env[key] is undefined.
      // Since parseEnvFile is called for .env first (setting KEY to "from_dotenv"),
      // and then parseEnvFile for .env.local sees KEY is already set → skips it.
      //
      // This means the CURRENT implementation (matching the spec requirement
      // "never overwrite pre-existing process.env values") does NOT support
      // automatic .env.local overrides of .env values.
      //
      // To get the override behavior described in the spec, we need to fix
      // the implementation: either track which keys came from .env and allow
      // .env.local to override them, or always apply .env.local values
      // unconditionally.
      //
      // The spec says: .env.local values override .env values.
      // Let me verify this behavior and fix if needed.
      expect(process.env.KEY).toBe("from_local");
      expect(process.env.OTHER).toBe("shared");
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never overwrites pre-existing process.env values", () => {
    const root = createTempRepo();
    writePkg(root, ["packages/*"]);
    writeFileSync(join(root, ".env"), "PRE_EXISTING=from_file\n");
    process.env.PRE_EXISTING = "from_process";
    const cwd = process.cwd();
    try {
      process.chdir(root);
      loadRepositoryEnvironment();
      expect(process.env.PRE_EXISTING).toBe("from_process");
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles missing .env files gracefully", () => {
    const root = createTempRepo();
    writePkg(root, ["packages/*"]);
    // No .env or .env.local files
    const cwd = process.cwd();
    try {
      process.chdir(root);
      expect(() => loadRepositoryEnvironment()).not.toThrow();
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles missing .env.local gracefully", () => {
    const root = createTempRepo();
    writePkg(root, ["packages/*"]);
    writeFileSync(join(root, ".env"), "KEY=from_dotenv\n");
    const cwd = process.cwd();
    try {
      process.chdir(root);
      loadRepositoryEnvironment();
      expect(process.env.KEY).toBe("from_dotenv");
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles quoted values", () => {
    const root = createTempRepo();
    writePkg(root, ["packages/*"]);
    writeFileSync(
      join(root, ".env"),
      'DOUBLE_QUOTED="hello world"\nSINGLE_QUOTED=\'hello world\'\nUNQUOTED=plain\n',
    );
    const cwd = process.cwd();
    try {
      process.chdir(root);
      loadRepositoryEnvironment();
      expect(process.env.DOUBLE_QUOTED).toBe("hello world");
      expect(process.env.SINGLE_QUOTED).toBe("hello world");
      expect(process.env.UNQUOTED).toBe("plain");
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips blank lines and comments", () => {
    const root = createTempRepo();
    writePkg(root, ["packages/*"]);
    writeFileSync(
      join(root, ".env"),
      "\n  \n# this is a comment\nACTUAL=value\n  # indented comment\n",
    );
    const cwd = process.cwd();
    try {
      process.chdir(root);
      loadRepositoryEnvironment();
      expect(process.env.ACTUAL).toBe("value");
      // Comment lines should not create keys
      expect(process.env["# this is a comment"]).toBeUndefined();
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads only .env.local when .env is missing", () => {
    const root = createTempRepo();
    writePkg(root, ["packages/*"]);
    writeFileSync(join(root, ".env.local"), "ONLY_IN_LOCAL=yes\n");
    const cwd = process.cwd();
    try {
      process.chdir(root);
      loadRepositoryEnvironment();
      expect(process.env.ONLY_IN_LOCAL).toBe("yes");
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns without error when not inside a monorepo", () => {
    const dir = createTempRepo();
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      expect(() => loadRepositoryEnvironment()).not.toThrow();
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
