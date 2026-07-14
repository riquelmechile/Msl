import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const indexPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const memoryRoot = dirname(dirname(indexPath));
const workspaceRoot = dirname(dirname(memoryRoot));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "dist" ? [] : sourceFiles(path);
    return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

describe("public economic memory boundary", () => {
  it("does not export raw database, transaction, migration, or synchronous writer helpers", () => {
    const publicBarrel = readFileSync(indexPath, "utf8");
    expect(publicBarrel).not.toMatch(/\b(getDb|getSharedDb|closeSharedDb|getSharedManager)\b/);
    expect(publicBarrel).not.toMatch(/\bsync[A-Z]\w*InTx\b/);
    expect(publicBarrel).not.toMatch(
      /\b(?:read|acquire|renew|release)EconomicDatabaseFence\b|\b(?:issue|validate|consume|reject)EconomicWriteAdmissionReceipt\b/,
    );
    expect(publicBarrel).not.toMatch(
      /\b(createSqliteEconomic(?:Outcome|Evidence|IngestionRun)Store|migrateEconomic(?:Outcome|Evidence|IngestionRun)Store)\b/,
    );
    expect(publicBarrel).not.toMatch(
      /SellerLease|EconomicDatabaseFence|EconomicWriteAdmissionReceipt|EconomicLeaseOwnershipLostError/,
    );
  });

  it("enforces the economic architecture against real workspace files", () => {
    const packageManifest = JSON.parse(readFileSync(join(memoryRoot, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(packageManifest.exports)).toEqual(["."]);
    expect(existsSync(join(memoryRoot, "src", "internal.ts"))).toBe(false);

    const productSource = sourceFiles(join(workspaceRoot, "packages"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(productSource).not.toMatch(/@msl\/memory\/internal|memory\/src\/internal(?:\.js)?/);

    const pipeline = readFileSync(
      join(workspaceRoot, "packages", "agent", "src", "economics", "EconomicIngestionPipeline.ts"),
      "utf8",
    );
    expect(pipeline).not.toMatch(
      /syncUpdateRunInTx|syncUpdateCheckpointInTx|syncInsert|syncUpsert|getDb\(|\.transaction\(/,
    );
    expect(pipeline).toContain("writeSessionFactory");
    expect(pipeline.match(/await writeSession\.session\.commitIngestion\(/g)).toHaveLength(1);
    expect(pipeline).not.toMatch(
      /\b(?:lease|fence|generation|renewLease|renewFence|RenewalScheduler|lease-lost|fence-lost)\b/i,
    );

    const runtimeDeadline = readFileSync(
      join(workspaceRoot, "packages", "agent", "src", "economics", "runtimeDeadline.ts"),
      "utf8",
    );
    expect(runtimeDeadline).not.toMatch(
      /leaseAcquireTimeoutMs|leaseRenewTimeoutMs|fenceRenewTimeoutMs/,
    );

    const factory = readFileSync(
      join(workspaceRoot, "packages", "agent", "src", "economics", "factory.ts"),
      "utf8",
    );
    expect(factory).toContain("MaintenanceWriteAdmission");
    expect(factory).toContain("writeSessionRenewalIntervalMs");
    expect(factory).not.toMatch(/better-sqlite3|\bDatabase(?:\.Database)?\b|\bdb\??:/);
    const writeSession = readFileSync(join(memoryRoot, "src", "economicWriteSession.ts"), "utf8");
    expect(writeSession).toMatch(
      /commitIngestion\(command: EconomicIngestionCommit\): Promise<EconomicIngestionCommitResult>/,
    );
    expect(writeSession).toMatch(
      /recordFailure\(command: EconomicIngestionFailure\): Promise<EconomicIngestionRun>/,
    );
    const publicOptions = writeSession.match(
      /export type EconomicMemoryRuntimeOptions = \{(?<body>[\s\S]*?)\n\};/,
    )?.groups?.["body"];
    expect(publicOptions).toBeDefined();
    expect(publicOptions).not.toMatch(/Database|database\s*:/);
    const openedSession = writeSession.match(
      /export type OpenEconomicWriteSession = \{(?<body>[\s\S]*?)\n\};/,
    )?.groups?.["body"];
    expect(openedSession).toBeDefined();
    expect(openedSession).toMatch(/session: AdmittedEconomicWriteSession/);
    expect(openedSession).toMatch(/release\(\): Promise<void>/);
    expect(openedSession).not.toMatch(/\b(?:checkpoint|renew|lease|fence|receipt|generation)\b/i);
    expect(indexPath).toBeDefined();
    expect(readFileSync(indexPath, "utf8")).not.toMatch(
      /EconomicOutcomeStore|EconomicEvidenceStore|EconomicIngestionRunStore/,
    );
  });
});
