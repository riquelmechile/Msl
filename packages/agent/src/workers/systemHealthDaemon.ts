import type { GraphEngine } from "@msl/memory";
import type { AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";

export type SystemHealthCheck = {
  ok: boolean;
  checks: { name: string; status: "ok" | "warning" | "critical"; detail: string }[];
};

/**
 * Run a system health check across the agent message bus and Cortex.
 *
 * Checks:
 * 1. Message bus backlog (pending messages)
 * 2. Failed messages (DLQ)
 * 3. Cortex node count (approximate)
 *
 * Returns a summary of all checks and an overall `ok` status.
 */
export function runSystemHealthCheck(
  bus: AgentMessageBusStore,
  cortex: GraphEngine,
): SystemHealthCheck {
  const checks: SystemHealthCheck["checks"] = [];

  // 1. Check message bus backlog
  try {
    const pendingCount = bus.getPendingCount?.() ?? 0;
    if (pendingCount > 100) {
      checks.push({
        name: "bus-backlog",
        status: "critical",
        detail: `${pendingCount} pending messages`,
      });
    } else if (pendingCount > 20) {
      checks.push({
        name: "bus-backlog",
        status: "warning",
        detail: `${pendingCount} pending messages`,
      });
    } else {
      checks.push({ name: "bus-backlog", status: "ok", detail: `${pendingCount} pending` });
    }
  } catch (e) {
    checks.push({
      name: "bus-backlog",
      status: "warning",
      detail: `could not check: ${String(e)}`,
    });
  }

  // 2. Check failed messages
  try {
    const failed = bus.getFailedMessages?.(100) ?? [];
    if (failed.length > 0) {
      checks.push({
        name: "bus-failed",
        status: "warning",
        detail: `${failed.length} failed messages`,
      });
    } else {
      checks.push({ name: "bus-failed", status: "ok", detail: "0 failed" });
    }
  } catch (e) {
    checks.push({ name: "bus-failed", status: "warning", detail: `could not check: ${String(e)}` });
  }

  // 3. Check Cortex node count (approximate via queryByMetadata)
  try {
    const nodes = cortex.queryByMetadata({});
    if (nodes.length > 100000) {
      checks.push({
        name: "cortex-size",
        status: "warning",
        detail: `${nodes.length}+ nodes — consider pruning`,
      });
    } else {
      checks.push({ name: "cortex-size", status: "ok", detail: `${nodes.length}+ nodes` });
    }
  } catch (e) {
    checks.push({
      name: "cortex-size",
      status: "warning",
      detail: `could not check: ${String(e)}`,
    });
  }

  const ok = checks.every((c) => c.status === "ok");
  return { ok, checks };
}
