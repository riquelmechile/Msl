import Database from "better-sqlite3";
import { readEconomicDatabaseFence } from "./migrationRegistry.js";

/**
 * The only capability that permits an economic SQLite mutation.  The database
 * handle deliberately stays module-private: callers receive a session, not a
 * transaction or a raw better-sqlite3 instance.
 */
/** DDL is an explicit maintenance capability, never a product writer escape hatch. */
export type MaintenanceWriteAdmission = {
  readonly purpose: "migration" | "bootstrap";
  run<T>(operation: () => T): T;
};

export type ExecutionBudget = {
  readonly deadlineAt: number;
  remaining(now?: number): number;
  require(operation: string, minimumMs?: number): number;
};

export function createExecutionBudget(maxTimeMs: number, now = Date.now): ExecutionBudget {
  if (!Number.isSafeInteger(maxTimeMs) || maxTimeMs <= 0) {
    throw new Error("Execution budget must be a positive safe integer");
  }
  const deadlineAt = now() + maxTimeMs;
  return {
    deadlineAt,
    remaining: (at = now()) => Math.max(0, deadlineAt - at),
    require: (operation, minimumMs = 1) => {
      const remaining = Math.max(0, deadlineAt - now());
      if (remaining < minimumMs) throw new Error(`Execution budget insufficient for ${operation}`);
      return remaining;
    },
  };
}

function immediate<T>(db: Database.Database, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function admitMaintenanceWrite(
  db: Database.Database,
  purpose: MaintenanceWriteAdmission["purpose"],
  now = Date.now,
): MaintenanceWriteAdmission {
  const metadataExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'economic_database_metadata'",
    )
    .get();
  if (!metadataExists) {
    if (purpose !== "bootstrap")
      throw new Error("Only bootstrap may write before economic metadata exists");
  } else {
    const fence = readEconomicDatabaseFence(db, now());
    if (fence.ownerRunId !== null || fence.lifecycle === "active") {
      throw new Error("Maintenance blocked by an active economic database fence");
    }
    const activeLease = db
      .prepare("SELECT 1 FROM economic_seller_leases WHERE expires_at > ? LIMIT 1")
      .get(now());
    if (activeLease) throw new Error("Maintenance blocked by an active seller lease");
  }
  return { purpose, run: (operation) => immediate(db, operation) };
}
