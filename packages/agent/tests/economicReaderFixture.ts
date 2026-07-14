import type { EconomicCostComponent, EconomicOutcome, UnitEconomicsSnapshot } from "@msl/domain";
import { createEconomicMemoryRuntime, type EconomicOutcomeReader } from "@msl/memory";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type EconomicOutcomeReaderFixture = EconomicOutcomeReader & {
  insertOutcome(outcome: EconomicOutcome): EconomicOutcome;
  insertUnitEconomicsSnapshot(snapshot: UnitEconomicsSnapshot): UnitEconomicsSnapshot;
  insertCostComponent(
    component: Omit<EconomicCostComponent, "id" | "currency"> & {
      readonly id?: string;
      readonly currency?: EconomicCostComponent["currency"];
    },
  ): EconomicCostComponent;
};

let nextComponentId = 0;
const fixtureDirectories = new Set<string>();
const fixtureRuntimes: Array<ReturnType<typeof createEconomicMemoryRuntime>> = [];
const fixtureDatabases = new Set<Database.Database>();

export function createEconomicFixtureDatabase(): Database.Database {
  const directory = mkdtempSync(join(tmpdir(), "msl-economic-reader-"));
  fixtureDirectories.add(directory);
  const db = new Database(join(directory, "economic.sqlite"));
  fixtureDatabases.add(db);
  return db;
}

export function cleanupEconomicFixtureDatabases(): void {
  for (const runtime of fixtureRuntimes.splice(0)) runtime.close();
  for (const db of fixtureDatabases) {
    try {
      db.close();
    } catch {
      // Some tests explicitly close their fixture before cleanup.
    }
  }
  fixtureDatabases.clear();
  for (const directory of fixtureDirectories) rmSync(directory, { recursive: true, force: true });
  fixtureDirectories.clear();
}

export function createEconomicOutcomeReaderFixture(
  db: Database.Database,
): EconomicOutcomeReaderFixture {
  const runtime = createEconomicMemoryRuntime({ databasePath: db.name });
  fixtureRuntimes.push(runtime);
  const reader = runtime.readers.outcomes;
  return {
    ...reader,
    insertOutcome(outcome) {
      db.prepare(
        `INSERT INTO economic_outcomes
         (outcome_id, seller_id, account_id, channel, proposal_id, prepared_action_id,
          execution_id, correlation_id, work_session_id, originating_agent_id, order_id,
          item_id, sku, expected_economic_impact, observed_economic_impact_id,
          observation_window_start, observation_window_end, baseline_reference, status,
          confidence, completeness, evidence_ids_json, created_at, observed_at, verified_at,
          disputed_at, invalidated_at, verification_reason, no_mutation_executed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(
        outcome.outcomeId,
        outcome.sellerId,
        outcome.accountId ?? null,
        outcome.channel ?? null,
        outcome.proposalId ?? null,
        outcome.preparedActionId ?? null,
        outcome.executionId ?? null,
        outcome.correlationId ?? null,
        outcome.workSessionId ?? null,
        outcome.originatingAgentId ?? null,
        outcome.orderId ?? null,
        outcome.itemId ?? null,
        outcome.sku ?? null,
        outcome.expectedEconomicImpact ?? null,
        outcome.observedEconomicImpactId ?? null,
        outcome.observationWindow?.start ?? null,
        outcome.observationWindow?.end ?? null,
        outcome.baselineReference ?? null,
        outcome.status,
        outcome.confidence,
        outcome.completeness,
        JSON.stringify(outcome.evidenceIds),
        outcome.createdAt,
        outcome.observedAt ?? null,
        outcome.verifiedAt ?? null,
        outcome.disputedAt ?? null,
        outcome.invalidatedAt ?? null,
        outcome.verificationReason ?? null,
      );
      return outcome;
    },
    insertUnitEconomicsSnapshot(snapshot) {
      db.prepare(
        `INSERT OR IGNORE INTO unit_economics_snapshots
         (snapshot_id, seller_id, account_id, channel, order_id, item_id, sku, product,
          period, currency, snapshot_json, calculated_at, ingestion_run_id, source_version,
          economic_algorithm_version, economic_checksum)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        snapshot.snapshotId,
        snapshot.sellerId,
        snapshot.accountId ?? null,
        snapshot.channel ?? null,
        snapshot.orderId ?? null,
        snapshot.itemId ?? null,
        snapshot.sku ?? null,
        snapshot.product ?? null,
        snapshot.period === undefined ? null : JSON.stringify(snapshot.period),
        snapshot.currency,
        JSON.stringify(snapshot),
        snapshot.calculatedAt,
        snapshot.ingestionRunId ?? null,
        snapshot.sourceVersion ?? null,
        snapshot.economicAlgorithmVersion ?? null,
        snapshot.economicChecksum ?? null,
      );
      return snapshot;
    },
    insertCostComponent(component) {
      const id = component.id ?? `fixture-cost-${++nextComponentId}`;
      db.prepare(
        `INSERT INTO economic_cost_components
         (id, seller_id, type, amount_minor, currency, source, source_record_id,
          economic_meaning, source_version, occurred_at, observed_at, verification,
          confidence, metadata_json, ingestion_run_id, identity_enforced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(
        id,
        component.sellerId,
        component.type,
        component.amount.amountMinor,
        component.amount.currency,
        component.source,
        component.sourceRecordId ?? null,
        component.economicMeaning ?? component.type,
        component.sourceVersion ?? null,
        component.occurredAt,
        component.observedAt,
        component.verification,
        component.confidence,
        component.metadata === undefined ? null : JSON.stringify(component.metadata),
        component.ingestionRunId ?? null,
      );
      return { ...component, id, currency: component.currency ?? component.amount.currency };
    },
  };
}
