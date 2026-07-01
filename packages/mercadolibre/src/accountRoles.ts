export type MlAccountRole = "source" | "target";

export type MlAccountRoleConfig = {
  sourceSellerId: string;
  targetSellerId: string;
  site: "MLC";
};

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getMlAccountRoleConfig(env: NodeJS.ProcessEnv = process.env): MlAccountRoleConfig {
  const sourceSellerId = nonEmpty(env.MERCADOLIBRE_SOURCE_SELLER_ID);
  const targetSellerId = nonEmpty(env.MERCADOLIBRE_TARGET_SELLER_ID);

  if (!sourceSellerId || !targetSellerId) {
    throw new Error(
      "MercadoLibre account roles are not configured. Set MERCADOLIBRE_SOURCE_SELLER_ID and MERCADOLIBRE_TARGET_SELLER_ID for the configured Plasticov to Maustian sync boundary before sync/write operations.",
    );
  }

  if (sourceSellerId === targetSellerId) {
    throw new Error("MercadoLibre source and target seller IDs must be different accounts.");
  }

  return { sourceSellerId, targetSellerId, site: "MLC" };
}

export function assertPlasticovToMaustianDirection(
  sourceSellerId: string,
  targetSellerId: string,
  env: NodeJS.ProcessEnv = process.env,
): MlAccountRoleConfig {
  const config = getMlAccountRoleConfig(env);
  if (sourceSellerId !== config.sourceSellerId || targetSellerId !== config.targetSellerId) {
    throw new Error(
      `Invalid MercadoLibre sync direction. Expected configured Plasticov -> Maustian sync boundary ${config.sourceSellerId} -> ${config.targetSellerId} on MLC.`,
    );
  }
  return config;
}

export function assertOAuthAccountMatchesRole(
  sellerId: string,
  returnedUserId: string | number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const config = getMlAccountRoleConfig(env);
  const expected = sellerId === config.sourceSellerId || sellerId === config.targetSellerId;
  if (!expected) {
    throw new Error(
      `Seller ${sellerId} is not configured as an allowed MercadoLibre account role for MSL.`,
    );
  }

  const actualUserId = returnedUserId === undefined ? "" : String(returnedUserId).trim();
  if (!actualUserId) {
    throw new Error(
      "MercadoLibre OAuth response did not include user_id; refusing to store token.",
    );
  }

  if (actualUserId !== sellerId) {
    throw new Error(
      `MercadoLibre OAuth identity mismatch. Expected seller ${sellerId}, received user_id ${actualUserId}.`,
    );
  }
}
