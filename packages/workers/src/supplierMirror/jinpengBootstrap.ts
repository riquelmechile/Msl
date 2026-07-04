import type {
  SellerId,
  SupplierLearnedFallbackPolicy,
  SupplierMirrorLedgerRecord,
  SupplierRegistryEntry,
  SupplierTargetPolicy,
} from "@msl/domain";

export const jinpengSupplierId = "jinpeng";
export const jinpengDefaultLowStockThreshold = 2;

export type JinpengBootstrapMode = "dry-run" | "apply-seed";

export type JinpengBootstrapConfig = {
  mode: JinpengBootstrapMode;
  mlSellerId?: string;
  mlNickname?: string;
  mlProfileUrl?: string;
  xkpUrl?: string;
  maustianSellerId?: SellerId;
  plasticovSellerId?: SellerId;
  mlAccessTokenPresent: boolean;
  mlClientIdPresent: boolean;
  mlClientSecretPresent: boolean;
};

export type JinpengTargetProposal = {
  target: "maustian" | "plasticov";
  sellerId: SellerId;
  pricing: "x2.5" | "x2";
  contentPolicy: string;
  learnedFallbackPolicyId: string;
  requiresCeoConfirmation: true;
};

export type JinpengReadinessReport = {
  supplierId: typeof jinpengSupplierId;
  status: "ready-for-ceo-decision" | "blocked";
  mode: JinpengBootstrapMode;
  identity: {
    sellerId?: string;
    nickname?: string;
    profileUrl?: string;
    verified: boolean;
  };
  sources: {
    mlStockAuthority: "validated" | "missing" | "failed";
    xkpEnrichment: "validated" | "missing" | "failed";
  };
  targetProposals: readonly JinpengTargetProposal[];
  missingCredentials: readonly string[];
  missingSourceInfo: readonly string[];
  missingDecisions: readonly string[];
  ledgerIds: readonly string[];
  noMutationExecuted: true;
  workerEnabled: false;
};

export type JinpengBootstrapResult = {
  supplier: SupplierRegistryEntry;
  policy: SupplierTargetPolicy;
  targetProposals: readonly JinpengTargetProposal[];
  readinessReport: JinpengReadinessReport;
  ledgerRecords: readonly SupplierMirrorLedgerRecord[];
  noMutationExecuted: true;
};

export type JinpengBootstrapStore = {
  upsertSupplier(supplier: SupplierRegistryEntry): Promise<void>;
  upsertTargetPolicy(policy: SupplierTargetPolicy): Promise<void>;
  upsertLearnedFallbackPolicy(policy: SupplierLearnedFallbackPolicy): Promise<void>;
  appendLedger(record: SupplierMirrorLedgerRecord): Promise<SupplierMirrorLedgerRecord>;
};

export type RunJinpengBootstrapOptions = {
  store: JinpengBootstrapStore;
  config: JinpengBootstrapConfig;
  now?: () => Date;
};

export function parseJinpengBootstrapConfig(
  env: NodeJS.ProcessEnv,
  argv: readonly string[] = [],
): JinpengBootstrapConfig {
  return {
    mode: argv.includes("--apply-seed") ? "apply-seed" : "dry-run",
    ...optionalString("mlSellerId", env.MSL_JINPENG_ML_SELLER_ID),
    ...optionalString("mlNickname", env.MSL_JINPENG_ML_NICKNAME),
    ...optionalString("mlProfileUrl", env.MSL_JINPENG_ML_PROFILE_URL),
    ...optionalString("xkpUrl", env.MSL_JINPENG_XKP_URL),
    maustianSellerId: env.MSL_MAUSTIAN_SELLER_ID ?? "maustian",
    plasticovSellerId: env.MSL_PLASTICOV_SELLER_ID ?? "plasticov",
    mlAccessTokenPresent: hasValue(env.MELI_ACCESS_TOKEN),
    mlClientIdPresent: hasValue(env.MELI_CLIENT_ID),
    mlClientSecretPresent: hasValue(env.MELI_CLIENT_SECRET),
  };
}

export async function runJinpengBootstrap(
  options: RunJinpengBootstrapOptions,
): Promise<JinpengBootstrapResult> {
  const now = options.now ?? (() => new Date());
  const createdAt = now().toISOString();
  const missingCredentials = missingCredentialNames(options.config);
  const missingSourceInfo = missingSourceNames(options.config);
  const targetProposals = buildTargetProposals(options.config);
  const blocked = missingCredentials.length > 0 || missingSourceInfo.length > 0;
  const policyEvidenceId = stableKey(
    "supplier-mirror",
    jinpengSupplierId,
    "target-policy-proposal",
  );
  const reportEvidenceId = stableKey("supplier-mirror", jinpengSupplierId, "readiness-report");

  const supplier: SupplierRegistryEntry = {
    id: jinpengSupplierId,
    name: "Jinpeng / XKP",
    enabled: false,
    primarySource: "mercadolibre-api",
    metadata: {
      bootstrapMode: options.config.mode,
      runtimeEnabled: false,
      workerEnabled: false,
      secretsPersisted: false,
      mlIdentity: {
        ...(options.config.mlSellerId === undefined ? {} : { sellerId: options.config.mlSellerId }),
        ...(options.config.mlNickname === undefined ? {} : { nickname: options.config.mlNickname }),
        ...(options.config.mlProfileUrl === undefined
          ? {}
          : { profileUrl: options.config.mlProfileUrl }),
        verified: !blocked,
      },
      sources: {
        mlStockAuthority: missingCredentials.length === 0 ? "validated" : "missing",
        xkpEnrichment: options.config.xkpUrl === undefined ? "missing" : "validated",
        ...(options.config.xkpUrl === undefined ? {} : { xkpUrl: options.config.xkpUrl }),
      },
      defaultLowStockThreshold: jinpengDefaultLowStockThreshold,
      targetProposals,
      missingCredentials,
      missingSourceInfo,
      requiresCeoConfirmation: true,
    },
    createdAt,
    updatedAt: createdAt,
  };
  const policy: SupplierTargetPolicy = {
    scopeType: "supplier",
    scopeId: jinpengSupplierId,
    supplierId: jinpengSupplierId,
    targetSellerIds: targetProposals.map((proposal) => proposal.sellerId),
    lowStockThreshold: jinpengDefaultLowStockThreshold,
    autoPauseAllowed: false,
  };

  await options.store.upsertSupplier(supplier);
  await options.store.upsertTargetPolicy(policy);
  for (const proposal of targetProposals) {
    await options.store.upsertLearnedFallbackPolicy(
      toLearnedFallbackPolicy(proposal, policyEvidenceId),
    );
  }

  const requestedLedgerRecords = buildLedgerRecords({
    blocked,
    createdAt,
    missingCredentials,
    missingSourceInfo,
    reportEvidenceId,
    targetProposals,
  });
  const ledgerRecords: SupplierMirrorLedgerRecord[] = [];
  for (const record of requestedLedgerRecords) {
    ledgerRecords.push(await options.store.appendLedger(record));
  }

  const readinessReport: JinpengReadinessReport = {
    supplierId: jinpengSupplierId,
    status: blocked ? "blocked" : "ready-for-ceo-decision",
    mode: options.config.mode,
    identity: {
      ...(options.config.mlSellerId === undefined ? {} : { sellerId: options.config.mlSellerId }),
      ...(options.config.mlNickname === undefined ? {} : { nickname: options.config.mlNickname }),
      ...(options.config.mlProfileUrl === undefined
        ? {}
        : { profileUrl: options.config.mlProfileUrl }),
      verified: !blocked,
    },
    sources: {
      mlStockAuthority: missingCredentials.length === 0 ? "validated" : "missing",
      xkpEnrichment: options.config.xkpUrl === undefined ? "missing" : "validated",
    },
    targetProposals,
    missingCredentials,
    missingSourceInfo,
    missingDecisions: blocked
      ? ["confirm supplier identity and runtime credentials"]
      : ["CEO enablement approval"],
    ledgerIds: ledgerRecords.map((record) => record.id),
    noMutationExecuted: true,
    workerEnabled: false,
  };

  return {
    supplier,
    policy,
    targetProposals,
    readinessReport,
    ledgerRecords,
    noMutationExecuted: true,
  };
}

function buildTargetProposals(config: JinpengBootstrapConfig): readonly JinpengTargetProposal[] {
  return [
    {
      target: "maustian",
      sellerId: config.maustianSellerId ?? "maustian",
      pricing: "x2.5",
      contentPolicy: "owned/improved titles and descriptions",
      learnedFallbackPolicyId: stableKey(
        "supplier-mirror",
        "pricing",
        jinpengSupplierId,
        "maustian",
      ),
      requiresCeoConfirmation: true,
    },
    {
      target: "plasticov",
      sellerId: config.plasticovSellerId ?? "plasticov",
      pricing: "x2",
      contentPolicy: "supplier-derived titles and descriptions with CEO confirmation",
      learnedFallbackPolicyId: stableKey(
        "supplier-mirror",
        "pricing",
        jinpengSupplierId,
        "plasticov",
      ),
      requiresCeoConfirmation: true,
    },
  ];
}

function toLearnedFallbackPolicy(
  proposal: JinpengTargetProposal,
  evidenceId: string,
): SupplierLearnedFallbackPolicy {
  return {
    id: proposal.learnedFallbackPolicyId,
    policyType: "pricing",
    scope: {
      supplierId: jinpengSupplierId,
      scopeType: "supplier",
      scopeId: jinpengSupplierId,
      target: proposal.target,
      targetSellerId: proposal.sellerId,
    },
    decision: {
      kind: "multiplier",
      multiplier: proposal.pricing === "x2.5" ? 2.5 : 2,
      contentPolicy: proposal.contentPolicy,
      requiresCeoConfirmation: true,
      recordedFrom: "jinpeng-bootstrap",
    },
    confidence: "medium",
    evidenceIds: [evidenceId],
    status: "proposed",
  };
}

function buildLedgerRecords(input: {
  blocked: boolean;
  createdAt: string;
  missingCredentials: readonly string[];
  missingSourceInfo: readonly string[];
  reportEvidenceId: string;
  targetProposals: readonly JinpengTargetProposal[];
}): readonly SupplierMirrorLedgerRecord[] {
  const records: SupplierMirrorLedgerRecord[] = input.targetProposals.map((proposal) => ({
    id: stableKey(
      "supplier-mirror",
      "ledger",
      jinpengSupplierId,
      "target-proposal",
      proposal.target,
    ),
    actionType: "price-proposal",
    idempotencyKey: stableKey(
      "supplier-mirror",
      "jinpeng-bootstrap",
      "target-proposal",
      proposal.target,
    ),
    status: "planned",
    reason: "jinpeng-target-policy-proposal-requires-ceo-confirmation",
    supplierId: jinpengSupplierId,
    targetSellerId: proposal.sellerId,
    evidenceIds: [proposal.learnedFallbackPolicyId],
    before: null,
    after: {
      pricing: proposal.pricing,
      contentPolicy: proposal.contentPolicy,
      requiresCeoConfirmation: true,
    },
    createdAt: input.createdAt,
  }));

  if (input.missingCredentials.length > 0) {
    records.push({
      id: stableKey(
        "supplier-mirror",
        "ledger",
        jinpengSupplierId,
        "validation-skip",
        "credentials",
      ),
      actionType: "skip",
      idempotencyKey: stableKey(
        "supplier-mirror",
        "jinpeng-bootstrap",
        "validation-skip",
        "credentials",
      ),
      status: "skipped",
      reason: "missing-mercadolibre-runtime-credentials",
      supplierId: jinpengSupplierId,
      evidenceIds: [input.reportEvidenceId],
      before: null,
      after: { missingCredentials: input.missingCredentials },
      createdAt: input.createdAt,
    });
  }

  if (input.missingSourceInfo.length > 0) {
    records.push({
      id: stableKey(
        "supplier-mirror",
        "ledger",
        jinpengSupplierId,
        "validation-skip",
        "source-info",
      ),
      actionType: "skip",
      idempotencyKey: stableKey(
        "supplier-mirror",
        "jinpeng-bootstrap",
        "validation-skip",
        "source-info",
      ),
      status: "skipped",
      reason: "missing-jinpeng-source-information",
      supplierId: jinpengSupplierId,
      evidenceIds: [input.reportEvidenceId],
      before: null,
      after: { missingSourceInfo: input.missingSourceInfo },
      createdAt: input.createdAt,
    });
  }

  records.push({
    id: stableKey("supplier-mirror", "ledger", jinpengSupplierId, "enablement-block"),
    actionType: "defer",
    idempotencyKey: stableKey("supplier-mirror", "jinpeng-bootstrap", "enablement-block"),
    status: "deferred",
    reason: input.blocked
      ? "jinpeng-enable-blocked-by-readiness-gaps"
      : "jinpeng-awaits-ceo-confirmation",
    supplierId: jinpengSupplierId,
    evidenceIds: [input.reportEvidenceId],
    before: null,
    after: { enabled: false, workerEnabled: false, noMutationExecuted: true },
    createdAt: input.createdAt,
  });

  return records;
}

function missingCredentialNames(config: JinpengBootstrapConfig): readonly string[] {
  return [
    ...(!config.mlAccessTokenPresent ? ["MELI_ACCESS_TOKEN"] : []),
    ...(!config.mlClientIdPresent ? ["MELI_CLIENT_ID"] : []),
    ...(!config.mlClientSecretPresent ? ["MELI_CLIENT_SECRET"] : []),
  ];
}

function missingSourceNames(config: JinpengBootstrapConfig): readonly string[] {
  return [
    ...(config.mlSellerId === undefined && config.mlNickname === undefined
      ? ["MSL_JINPENG_ML_SELLER_ID or MSL_JINPENG_ML_NICKNAME"]
      : []),
    ...(config.xkpUrl === undefined ? ["MSL_JINPENG_XKP_URL"] : []),
  ];
}

function optionalString<TKey extends string>(
  key: TKey,
  value: string | undefined,
): Partial<Record<TKey, string>> {
  return hasValue(value) ? ({ [key]: value } as Partial<Record<TKey, string>>) : {};
}

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function stableKey(...parts: readonly string[]): string {
  return parts.map((part) => part.replace(/[^a-zA-Z0-9-]/g, "-")).join(":");
}
