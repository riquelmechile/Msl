export type MetricName =
  | "conversation.turn"
  | "conversation.duration_ms"
  | "tool.call"
  | "guardrail.block"
  | "sync.product"
  | "escribano.observation"
  | "autonomy.degradation"
  | "token.refresh";

export interface Metric {
  name: MetricName;
  value: number;
  tags?: Record<string, string> | undefined;
  timestamp: string;
}

/**
 * Simple in-memory metrics collector.
 *
 * Accumulates {@link Metric} records in a ring-free array for collection
 * by external agents (e.g. a Prometheus exporter or OpenTelemetry bridge).
 * Call `flush()` periodically to drain and forward to a sink.
 */
export function createMetrics() {
  const metrics: Metric[] = [];

  return {
    /** Record a single metric data point. */
    record(name: MetricName, value: number, tags?: Record<string, string>): void {
      metrics.push({ name, value, tags, timestamp: new Date().toISOString() });
    },

    /** Drain and return all accumulated metrics, resetting the internal store. */
    flush(): Metric[] {
      const snapshot = [...metrics];
      metrics.length = 0;
      return snapshot;
    },

    /**
     * Summarise accumulated metrics grouped by name.
     *
     * Returns count, total, and average per metric. Useful for live
     * /health or /metrics scraping without a full time-series DB.
     */
    summarize(): Record<string, { count: number; total: number; avg: number }> {
      const summary: Record<string, { count: number; total: number; avg: number }> = {};
      for (const m of metrics) {
        const entry = summary[m.name];
        if (entry) {
          entry.count++;
          entry.total += m.value;
          entry.avg = entry.total / entry.count;
        } else {
          summary[m.name] = { count: 1, total: m.value, avg: m.value };
        }
      }
      return summary;
    },
  };
}

export type MetricsCollector = ReturnType<typeof createMetrics>;

// ── Structured Logger ─────────────────────────────────────────────────

/**
 * Simple JSON-structured logger keyed by component name.
 *
 * Every log line is a single JSON object with `level`, `component`, `msg`,
 * contextual key-value pairs, and a UTC timestamp.  This format is
 * compatible with `jq`, Datadog, Grafana Loki, and other structured-log
 * ingestion pipelines without extra parsing.
 */
export function createLogger(component: string) {
  return {
    info(msg: string, ctx?: Record<string, unknown>): void {
      console.log(
        JSON.stringify({ level: "info", component, msg, ...ctx, ts: new Date().toISOString() }),
      );
    },
    warn(msg: string, ctx?: Record<string, unknown>): void {
      console.warn(
        JSON.stringify({ level: "warn", component, msg, ...ctx, ts: new Date().toISOString() }),
      );
    },
    error(msg: string, err?: Error, ctx?: Record<string, unknown>): void {
      console.error(
        JSON.stringify({
          level: "error",
          component,
          msg,
          error: err?.message,
          stack: err?.stack,
          ...ctx,
          ts: new Date().toISOString(),
        }),
      );
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
