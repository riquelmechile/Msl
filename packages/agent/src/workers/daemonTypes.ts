import type { AgentMessage, AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";
import type { GraphEngine } from "@msl/memory";
import type { OperationalReadModelReader } from "@msl/memory";

// ── Daemon Finding ──────────────────────────────────────────────────

export type DaemonFinding = {
  kind: "opportunity" | "alert" | "info";
  summary: string;
  /** Evidence identifiers (snapshot evidence IDs, Cortex node labels, etc.). */
  evidenceIds: string[];
  severity: "info" | "warning" | "critical";
}

// ── Daemon Result ───────────────────────────────────────────────────

export type DaemonResult = {
  findings: DaemonFinding[];
  /** Whether at least one CEO proposal was enqueued via the message bus. */
  proposalEnqueued: boolean;
  /** Message IDs of enqueued proposals on the bus. */
  messageIds: string[];
}

// ── Daemon Handler ──────────────────────────────────────────────────

export type DaemonHandler = (input: {
  claim: AgentMessage;
  reader: OperationalReadModelReader;
  cortex: GraphEngine;
  bus: AgentMessageBusStore;
  sellerIds: string[];
}) => Promise<DaemonResult>;
