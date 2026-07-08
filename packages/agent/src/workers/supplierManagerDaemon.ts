import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Supplier Manager daemon handler.
 *
 * Reads SupplierMirrorStore data (supplier items, stock observations,
 * item mappings, sync ledger) and cross-references Cortex listing
 * snapshots to detect three signals:
 *
 * 1. Cross-account stock discrepancy (critical)
 * 2. Supplier price change >5% (warning)
 * 3. Unfilled mirror items (warning)
 *
 * Enqueues grouped CEO proposals with `noMutationExecuted: true`.
 * Deduplicates via sync_ledger idempotency keys.
 *
 * Graceful degrade: if `supplierMirrorStore` is undefined, returns
 * empty findings without error.
 */
export const supplierManagerDaemon: DaemonHandler = async ({
  claim: _claim,
  reader: _reader,
  cortex: _cortex,
  bus,
  sellerIds: _sellerIds,
  supplierMirrorStore,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];
  const now = new Date();
  const capturedAt = now.toISOString();

  // ── Graceful degrade ─────────────────────────────────────────
  if (!supplierMirrorStore) {
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── TODO: Full implementation in next work unit ────────────────
  // This scaffold establishes the handler contract, graceful degrade,
  // and wiring. The three signals (stock discrepancy, price change,
  // unfilled mirror) will be implemented in the follow-up commit.

  return { findings, proposalEnqueued: false, messageIds };
};
