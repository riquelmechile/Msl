import { describe, expect, it, vi, afterEach } from "vitest";

import { sanitizeContext, createDaemonLogger, createStoreLogger } from "./observabilityPipeline.js";

// ── Helpers ──────────────────────────────────────────────────────────

/** Parse the last JSON line written to a console spy. */
function lastJson(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const calls = spy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const raw = calls[calls.length - 1]?.[0];
  return JSON.parse(raw as string) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ── sanitizeContext ──────────────────────────────────────────────────

describe("sanitizeContext", () => {
  it("passes primitives through unchanged", () => {
    expect(sanitizeContext(null)).toBe(null);
    expect(sanitizeContext(undefined)).toBe(undefined);
    expect(sanitizeContext(42)).toBe(42);
    expect(sanitizeContext("hello")).toBe("hello");
    expect(sanitizeContext(true)).toBe(true);
  });

  it("passes arrays through with recursive sanitisation", () => {
    const input = [{ apiKey: "sk-abc" }, { name: "ok" }];
    const result = sanitizeContext(input) as Array<Record<string, unknown>>;
    expect(result[0]!.apiKey).toBe("[REDACTED]");
    expect(result[1]!.name).toBe("ok");
  });

  it("passes non-sensitive flat objects through", () => {
    const input = { name: "market-catalog", count: 42 };
    expect(sanitizeContext(input)).toEqual(input);
  });

  // ── Secret redaction ─────────────────────────────────────────────

  it("redacts apiKey fields", () => {
    const input = { apiKey: "sk-abc123xyz" };
    expect(sanitizeContext(input)).toEqual({ apiKey: "[REDACTED]" });
  });

  it("redacts API_KEY (snake_case) fields", () => {
    const input = { api_key: "secret-value" };
    expect(sanitizeContext(input)).toEqual({ api_key: "[REDACTED]" });
  });

  it("redacts accessToken fields", () => {
    const input = { accessToken: "tok-xxx" };
    expect(sanitizeContext(input)).toEqual({ accessToken: "[REDACTED]" });
  });

  it("redacts clientSecret fields", () => {
    const input = { clientSecret: "cs-001122" };
    expect(sanitizeContext(input)).toEqual({ clientSecret: "[REDACTED]" });
  });

  it("redacts password fields", () => {
    const input = { password: "hunter2" };
    expect(sanitizeContext(input)).toEqual({ password: "[REDACTED]" });
  });

  it("redacts authorization headers", () => {
    const input = { authorization: "Bearer xyz-token" };
    expect(sanitizeContext(input)).toEqual({ authorization: "[REDACTED]" });
  });

  it("redacts credential fields", () => {
    const input = { credentials: { user: "admin", pass: "s3cret" } };
    expect(sanitizeContext(input)).toEqual({ credentials: "[REDACTED]" });
  });

  it("redacts auth-related fields", () => {
    const input = { authToken: "abc", auth_key: "xyz" };
    expect(sanitizeContext(input)).toEqual({
      authToken: "[REDACTED]",
      auth_key: "[REDACTED]",
    });
  });

  it("redacts AccessKey (PascalCase suffix)", () => {
    const input = { AccessKey: "AKIA12345" };
    expect(sanitizeContext(input)).toEqual({ AccessKey: "[REDACTED]" });
  });

  it("redacts secretKey (camelCase Key suffix)", () => {
    const input = { secretKey: "xyz-secret" };
    expect(sanitizeContext(input)).toEqual({ secretKey: "[REDACTED]" });
  });

  // ── Prompt / content exclusion ───────────────────────────────────

  it("redacts prompt fields to [REDACTED: prompt]", () => {
    const input = { prompt: "You are a helpful assistant..." };
    expect(sanitizeContext(input)).toEqual({ prompt: "[REDACTED: prompt]" });
  });

  it("redacts content fields to [REDACTED: prompt]", () => {
    const input = { content: "The sky is blue..." };
    expect(sanitizeContext(input)).toEqual({ content: "[REDACTED: prompt]" });
  });

  it("excludes prompt and content but preserves other fields", () => {
    const input = { prompt: "big text", content: "bigger text", name: "daemon" };
    expect(sanitizeContext(input)).toEqual({
      prompt: "[REDACTED: prompt]",
      content: "[REDACTED: prompt]",
      name: "daemon",
    });
  });

  // ── Nested objects ───────────────────────────────────────────────

  it("recursively sanitises nested objects", () => {
    const input = {
      config: {
        apiKey: "sk-nested",
        nested: { token: "bearer-123", safe: "keep-me" },
      },
    };
    expect(sanitizeContext(input)).toEqual({
      config: {
        apiKey: "[REDACTED]",
        nested: { token: "[REDACTED]", safe: "keep-me" },
      },
    });
  });

  it("redacts secrets inside array elements", () => {
    const input = {
      items: [
        { id: 1, apiKey: "a" },
        { id: 2, token: "b" },
        { id: 3, name: "safe" },
      ],
    };
    expect(sanitizeContext(input)).toEqual({
      items: [
        { id: 1, apiKey: "[REDACTED]" },
        { id: 2, token: "[REDACTED]" },
        { id: 3, name: "safe" },
      ],
    });
  });
});

// ── createDaemonLogger ───────────────────────────────────────────────

describe("createDaemonLogger", () => {
  // ── JSON structure ───────────────────────────────────────────────

  it("emits JSON with { level, component, msg, ts, correlationId }", () => {
    vi.stubEnv("MSL_STRUCTURED_LOGGING_ENABLED", "true");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = createDaemonLogger("market-catalog", "uuid-001");
    logger.info("listing count", { count: 42 });

    const entry = lastJson(logSpy);
    expect(entry.level).toBe("info");
    expect(entry.component).toBe("market-catalog");
    expect(entry.msg).toBe("listing count");
    expect(entry.ts).toBeTypeOf("string");
    expect(entry.correlationId).toBe("uuid-001");
    expect(entry.count).toBe(42);

    logSpy.mockRestore();
  });

  it("warn level emits via console.warn", () => {
    vi.stubEnv("MSL_STRUCTURED_LOGGING_ENABLED", "true");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const logger = createDaemonLogger("test", "id-1");
    logger.warn("something fishy", { hint: "check" });

    expect(warnSpy).toHaveBeenCalledOnce();
    const entry = lastJson(warnSpy);
    expect(entry.level).toBe("warn");
    expect(entry.correlationId).toBe("id-1");
    expect(entry.hint).toBe("check");

    warnSpy.mockRestore();
  });

  it("error level emits via console.error with error details", () => {
    vi.stubEnv("MSL_STRUCTURED_LOGGING_ENABLED", "true");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = createDaemonLogger("test", "id-1");
    const err = new Error("boom");
    logger.error("db failure", err, { retry: 3 });

    expect(errSpy).toHaveBeenCalledOnce();
    const entry = lastJson(errSpy);
    expect(entry.level).toBe("error");
    expect(entry.msg).toBe("db failure");
    expect(entry.error).toBe("boom");
    expect(entry.stack).toBeTypeOf("string");
    expect(entry.correlationId).toBe("id-1");
    expect(entry.retry).toBe(3);

    errSpy.mockRestore();
  });

  // ── Feature-flag gating ──────────────────────────────────────────

  it("returns no-op logger when MSL_STRUCTURED_LOGGING_ENABLED is false", () => {
    vi.stubEnv("MSL_STRUCTURED_LOGGING_ENABLED", "false");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = createDaemonLogger("test", "id-1");
    logger.info("should not appear");
    logger.warn("also silent");
    logger.error("still silent");

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("returns no-op logger when env var is unset", () => {
    vi.stubEnv("MSL_STRUCTURED_LOGGING_ENABLED", undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = createDaemonLogger("test", "id-1");
    logger.info("nope");
    logger.warn("nope");
    logger.error("nope");

    expect(logSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  // ── Sanitisation in log calls ────────────────────────────────────

  it("redacts apiKey in log context", () => {
    vi.stubEnv("MSL_STRUCTURED_LOGGING_ENABLED", "true");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = createDaemonLogger("test", "id-1");
    logger.info("msg", { apiKey: "sk-secret" });

    const entry = lastJson(logSpy);
    expect(entry.apiKey).toBe("[REDACTED]");

    logSpy.mockRestore();
  });

  it("redacts prompt in log context", () => {
    vi.stubEnv("MSL_STRUCTURED_LOGGING_ENABLED", "true");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = createDaemonLogger("test", "id-1");
    logger.info("msg", { prompt: "big text" });

    const entry = lastJson(logSpy);
    expect(entry.prompt).toBe("[REDACTED: prompt]");

    logSpy.mockRestore();
  });

  it("does not mutate the original context object", () => {
    vi.stubEnv("MSL_STRUCTURED_LOGGING_ENABLED", "true");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const ctx = { apiKey: "sk-original", name: "daemon" };
    const originalCtx = { ...ctx };

    const logger = createDaemonLogger("test", "id-1");
    logger.info("msg", ctx);

    // Original object should be untouched
    expect(ctx).toEqual(originalCtx);

    logSpy.mockRestore();
  });
});

// ── createStoreLogger ────────────────────────────────────────────────

describe("createStoreLogger", () => {
  it("behaves identically to createDaemonLogger for the same inputs", () => {
    vi.stubEnv("MSL_STRUCTURED_LOGGING_ENABLED", "true");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Both loggers share the same correlationId
    const daemonLog = createDaemonLogger("ops-mgr", "uuid-aaa");
    const storeLog = createStoreLogger("economic-outcome-store", "uuid-aaa");

    daemonLog.info("daemon msg", { x: 1 });
    storeLog.info("store msg", { y: 2 });

    expect(logSpy).toHaveBeenCalledTimes(2);

    const calls = logSpy.mock.calls;
    const dEntry = JSON.parse(calls[0]![0] as string) as Record<string, unknown>;
    const sEntry = JSON.parse(calls[1]![0] as string) as Record<string, unknown>;

    // Both carry the same correlationId (inherited from handler)
    expect(dEntry.correlationId).toBe("uuid-aaa");
    expect(sEntry.correlationId).toBe("uuid-aaa");

    // Different component names
    expect(dEntry.component).toBe("ops-mgr");
    expect(sEntry.component).toBe("economic-outcome-store");

    // Same JSON shape: level, component, msg, ts, correlationId
    for (const key of ["level", "component", "msg", "ts", "correlationId"]) {
      expect(dEntry).toHaveProperty(key);
      expect(sEntry).toHaveProperty(key);
    }

    logSpy.mockRestore();
  });
});

// ── Correlation ID propagation (spec L36-L48) ────────────────────────

describe("correlation ID propagation", () => {
  it("propagates the same correlationId from daemon to store", () => {
    vi.stubEnv("MSL_STRUCTURED_LOGGING_ENABLED", "true");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const corrId = "prop-001";

    // Simulate: daemon handler creates logger for itself and its store
    const daemonLogger = createDaemonLogger("ops-manager", corrId);
    const storeLogger = createStoreLogger("operational-read-model", corrId);

    daemonLogger.info("scanning listings");
    storeLogger.info("querying snapshots");

    const dEntry = JSON.parse(logSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    const sEntry = JSON.parse(logSpy.mock.calls[1]![0] as string) as Record<string, unknown>;

    // Core assertion: both entries share the same correlationId
    expect(dEntry.correlationId).toBe(corrId);
    expect(sEntry.correlationId).toBe(corrId);

    logSpy.mockRestore();
  });

  it("produces distinct correlation IDs across separate invocations", () => {
    vi.stubEnv("MSL_STRUCTURED_LOGGING_ENABLED", "true");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Two separate daemon runs should have different IDs
    const run1 = createDaemonLogger("daemon", "run-uuid-111");
    const run2 = createDaemonLogger("daemon", "run-uuid-222");

    run1.info("first invocation");
    run2.info("second invocation");

    const e1 = JSON.parse(logSpy.mock.calls[0]![0] as string) as Record<string, unknown>;
    const e2 = JSON.parse(logSpy.mock.calls[1]![0] as string) as Record<string, unknown>;

    expect(e1.correlationId).toBe("run-uuid-111");
    expect(e2.correlationId).toBe("run-uuid-222");
    expect(e1.correlationId).not.toBe(e2.correlationId);

    logSpy.mockRestore();
  });
});
