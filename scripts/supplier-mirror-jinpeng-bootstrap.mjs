const DEFAULT_MODE = "dry-run";
const APPLY_SEED_FLAG = "--apply-seed";
const DRY_RUN_FLAG = "--dry-run";
const HELP_FLAGS = new Set(["--help", "-h"]);

export function parseJinpengBootstrapCliArgs(argv = []) {
  if (argv.some((arg) => HELP_FLAGS.has(arg))) {
    return { help: true, mode: DEFAULT_MODE };
  }

  const unknownFlags = argv.filter(
    (arg) => arg.startsWith("--") && arg !== APPLY_SEED_FLAG && arg !== DRY_RUN_FLAG,
  );
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown Jinpeng bootstrap flag(s): ${unknownFlags.join(", ")}`);
  }

  if (argv.includes(APPLY_SEED_FLAG) && argv.includes(DRY_RUN_FLAG)) {
    throw new Error("Choose either --dry-run or --apply-seed, not both.");
  }

  return {
    help: false,
    mode: argv.includes(APPLY_SEED_FLAG) ? "apply-seed" : DEFAULT_MODE,
  };
}

export function resolveSupplierMirrorDbPath(env = process.env) {
  const dbPath = env.MSL_SUPPLIER_MIRROR_DB_PATH;
  if (typeof dbPath !== "string" || dbPath.trim().length === 0) {
    throw new Error("MSL_SUPPLIER_MIRROR_DB_PATH is required; no default database path is opened.");
  }

  return dbPath;
}

export function redactJinpengBootstrapConfig(config) {
  return {
    mode: config.mode,
    supplierId: "jinpeng",
    mlSellerIdProvided: typeof config.mlSellerId === "string",
    mlNicknameProvided: typeof config.mlNickname === "string",
    mlProfileUrlProvided: typeof config.mlProfileUrl === "string",
    xkpUrlProvided: typeof config.xkpUrl === "string",
    maustianSellerIdProvided: typeof config.maustianSellerId === "string",
    plasticovSellerIdProvided: typeof config.plasticovSellerId === "string",
    mlAccessTokenPresent: config.mlAccessTokenPresent === true,
    mlClientIdPresent: config.mlClientIdPresent === true,
    mlClientSecretPresent: config.mlClientSecretPresent === true,
    secretsPersisted: false,
  };
}

export function formatJinpengBootstrapEvidence({ dbPath, config, result }) {
  return {
    command: "supplier-mirror:jinpeng:dry-run",
    dbPath,
    config: redactJinpengBootstrapConfig(config),
    readinessReport: result.readinessReport,
    safety: {
      noMutationExecuted: result.noMutationExecuted === true,
      workerEnabled: result.readinessReport.workerEnabled,
      externalApiCalled: false,
      secretsStored: false,
      publishCalled: false,
      pauseCalled: false,
      priceUpdateCalled: false,
    },
    ledgerIds: result.ledgerRecords.map((record) => record.id),
  };
}

function printHelp() {
  console.log(`Jinpeng Supplier Mirror bootstrap

Usage:
  npm run supplier-mirror:jinpeng:dry-run
  node scripts/supplier-mirror-jinpeng-bootstrap.mjs [--dry-run|--apply-seed]

Required:
  MSL_SUPPLIER_MIRROR_DB_PATH=/absolute/path/to/supplier-mirror.sqlite

Dry-run is the default. The command writes only local disabled seed/readiness evidence,
does not store secrets, does not enable the worker, and does not call external APIs.`);
}

async function loadRuntimeDependencies() {
  const [{ default: Database }, memory, workers] = await Promise.all([
    import("better-sqlite3"),
    import("@msl/memory"),
    import("@msl/workers"),
  ]);

  return {
    Database,
    createSqliteSupplierMirrorStore: memory.createSqliteSupplierMirrorStore,
    parseJinpengBootstrapConfig: workers.parseJinpengBootstrapConfig,
    runJinpengBootstrap: workers.runJinpengBootstrap,
  };
}

export async function runJinpengBootstrapCli({
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  const cli = parseJinpengBootstrapCliArgs(argv);
  if (cli.help) {
    printHelp();
    return { status: "help" };
  }

  const dbPath = resolveSupplierMirrorDbPath(env);
  const runtime = await loadRuntimeDependencies();
  const config = runtime.parseJinpengBootstrapConfig(
    env,
    cli.mode === "apply-seed" ? [APPLY_SEED_FLAG] : [],
  );
  const db = new runtime.Database(dbPath);

  try {
    const store = runtime.createSqliteSupplierMirrorStore(db);
    const result = await runtime.runJinpengBootstrap({ store, config });
    return {
      status: result.readinessReport.status,
      evidence: formatJinpengBootstrapEvidence({ dbPath, config, result }),
    };
  } finally {
    db.close();
  }
}

async function main() {
  try {
    const result = await runJinpengBootstrapCli();
    if (result.status !== "help") {
      console.log(JSON.stringify(result.evidence, null, 2));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Jinpeng bootstrap failure.";
    console.error(`Jinpeng Supplier Mirror bootstrap failed safely: ${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
