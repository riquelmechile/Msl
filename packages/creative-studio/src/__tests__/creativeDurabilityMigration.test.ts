import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  applyCreativeDurabilityMigration,
  creativeDurabilityMigration,
  isCreativeDurabilityMigrationApplied,
} from "../infrastructure/storage/creativeDurabilityMigration.js";

function openDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

describe("creative durability v4 migration", () => {
  it("applies canonical tables and indexes to fresh and legacy databases", () => {
    for (const legacy of [false, true]) {
      const db = openDb();
      if (legacy) db.exec("CREATE TABLE agent_messages(message_id TEXT PRIMARY KEY)");
      creativeDurabilityMigration.up(db);
      expect(creativeDurabilityMigration.version).toBe(4);
      expect(isCreativeDurabilityMigrationApplied(db)).toBe(true);
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name='agent_messages'").get(),
      ).toEqual(legacy ? { name: "agent_messages" } : undefined);
      db.close();
    }
  });

  it("is idempotent and rejects foreign or partial v4 ownership", () => {
    const db = openDb();
    applyCreativeDurabilityMigration(db);
    applyCreativeDurabilityMigration(db);
    expect(isCreativeDurabilityMigrationApplied(db)).toBe(true);
    db.exec("DROP INDEX cga_recovery");
    expect(isCreativeDurabilityMigrationApplied(db)).toBe(false);
    db.close();

    const foreign = openDb();
    foreign.exec("CREATE TABLE creative_budget_reservations(reservation_id TEXT PRIMARY KEY)");
    expect(() => applyCreativeDurabilityMigration(foreign)).toThrow();
    expect(isCreativeDurabilityMigrationApplied(foreign)).toBe(false);
    foreign.close();
  });

  it("enforces foreign keys and reservation/attempt state checks", () => {
    const db = openDb();
    applyCreativeDurabilityMigration(db);
    const attempt =
      "INSERT INTO creative_generation_attempts(attempt_id,seller_id,job_id,reservation_id,message_id,provider,model,idempotency_key,request_hash,state,estimated_cost_micros,request_evidence_json,created_at,updated_at) VALUES('a','s','j','r','m','p','model','key',?,'prepared',1,'{}',1,1)";
    expect(() => db.prepare(attempt).run("0".repeat(64))).toThrow(/FOREIGN KEY/);
    const reservation =
      "INSERT INTO creative_budget_reservations(reservation_id,seller_id,job_id,attempt_id,currency,utc_day,status,reserved_micros,expires_at,created_at,updated_at) VALUES('r','s','j','a','USD','2026-07-20',?,1,1,1,1)";
    expect(() => db.prepare(reservation).run("invalid")).toThrow(/CHECK/);
    db.close();
  });
});
