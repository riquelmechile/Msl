import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// ── Helpers ────────────────────────────────────────────────────────────────

const CLI_PATH = resolve(import.meta.dirname, "economicCli.ts");

type CliJsonOutput = {
  status: string;
  command: string;
  sellerId: string;
  timestamp: string;
  result?: Record<string, unknown>;
  error?: string;
};

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number | null } {
  const result = spawnSync("npx", ["tsx", CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, NODE_ENV: "test" },
    timeout: 30_000,
  });

  return {
    stdout: result.stdout?.trim() ?? "",
    stderr: (result.stderr ?? result.stdout ?? "").trim(),
    exitCode: result.status,
  };
}

function parseJsonOutput(raw: string): CliJsonOutput {
  return JSON.parse(raw) as CliJsonOutput;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("economicCli", () => {
  describe("command routing", () => {
    it("exits with error for invalid commands", () => {
      const result = runCli(["invalid-command"]);
      expect(result.exitCode).toBe(1);
    });

    it("exits with error when no command is given", () => {
      const result = runCli([]);
      expect(result.exitCode).toBe(1);
    });

    it("runs ingest command successfully", () => {
      const result = runCli(["ingest", "--seller=plasticov", "--json"]);
      expect(result.exitCode).toBe(0);
    });

    it("runs status command successfully", () => {
      const result = runCli(["status", "--seller=plasticov", "--json"]);
      expect(result.exitCode).toBe(0);
    });

    it("runs coverage command successfully", () => {
      const result = runCli(["coverage", "--seller=plasticov", "--json"]);
      expect(result.exitCode).toBe(0);
    });

    it("runs reconcile command successfully", () => {
      const result = runCli(["reconcile", "--seller=plasticov", "--json"]);
      expect(result.exitCode).toBe(0);
    });

    it("runs missing command successfully", () => {
      const result = runCli(["missing", "--seller=plasticov", "--json"]);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("--json flag", () => {
    it("outputs valid JSON with --json flag", () => {
      const result = runCli(["ingest", "--seller=plasticov", "--json"]);

      expect(result.exitCode).toBe(0);
      const parsed = parseJsonOutput(result.stdout);
      expect(parsed.status).toBe("ok");
      expect(parsed.command).toBe("ingest");
      expect(parsed.sellerId).toBe("plasticov");
      expect(parsed.result).toBeDefined();
      expect(parsed.timestamp).toBeDefined();
    });

    it("--json output includes result object for ingest", () => {
      const result = runCli(["ingest", "--seller=plasticov", "--json"]);

      const parsed = parseJsonOutput(result.stdout);
      expect(parsed.result?.runId).toBeDefined();
      expect(parsed.result?.mode).toBeDefined();
    });

    it("--json output includes result object for status", () => {
      const result = runCli(["status", "--json"]);

      const parsed = parseJsonOutput(result.stdout);
      expect(parsed.result?.lastRun).toBe(null);
      expect(parsed.result?.totalRuns).toBe(0);
    });

    it("--json output includes result object for coverage", () => {
      const result = runCli(["coverage", "--json"]);

      const parsed = parseJsonOutput(result.stdout);
      expect(parsed.result?.overallStatus).toBe("partial");
      expect(parsed.result?.dimensions).toBeDefined();
    });

    it("--json output includes result object for reconcile", () => {
      const result = runCli(["reconcile", "--json"]);

      const parsed = parseJsonOutput(result.stdout);
      expect(parsed.result?.status).toBe("incomplete");
    });

    it("--json output includes result object for missing", () => {
      const result = runCli(["missing", "--json"]);

      const parsed = parseJsonOutput(result.stdout);
      const missingInputs = parsed.result?.missingInputs;
      expect(Array.isArray(missingInputs)).toBe(true);
      expect(parsed.result?.count).toBeGreaterThan(0);
    });

    it("produces error output for invalid commands", () => {
      // Running with invalid command exits with code 1, so stderr
      const result = runCli(["bad", "--json"]);
      expect(result.exitCode).toBe(1);
    });
  });

  describe("--seller flag", () => {
    it("defaults to plasticov when --seller is not set", () => {
      const result = runCli(["ingest", "--json"]);

      const parsed = parseJsonOutput(result.stdout);
      expect(parsed.sellerId).toBe("plasticov");
    });

    it("uses provided seller when --seller is set", () => {
      const result = runCli(["ingest", "--seller=maustian", "--json"]);

      const parsed = parseJsonOutput(result.stdout);
      expect(parsed.sellerId).toBe("maustian");
    });

    it("accepts --seller with space-separated value", () => {
      const result = runCli(["ingest", "--seller", "maustian", "--json"]);

      const parsed = parseJsonOutput(result.stdout);
      expect(parsed.sellerId).toBe("maustian");
    });
  });

  describe("--dry-run flag", () => {
    it("enables dry-run mode", { timeout: 15_000 }, () => {
      const result = runCli(["ingest", "--dry-run", "--json"]);

      const parsed = parseJsonOutput(result.stdout);
      expect(parsed.result?.mode).toBe("dry-run");
    });

    it("uses incremental mode when --dry-run is not set", { timeout: 15_000 }, () => {
      const result = runCli(["ingest", "--json"]);

      const parsed = parseJsonOutput(result.stdout);
      expect(parsed.result?.mode).toBe("incremental");
    });
  });

  describe("output format", () => {
    it("produces human-readable output without --json (ingest)", () => {
      const result = runCli(["ingest", "--seller=plasticov"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("ingest");
    });

    it("produces human-readable output without --json (status)", () => {
      const result = runCli(["status"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("status");
    });
  });
});
