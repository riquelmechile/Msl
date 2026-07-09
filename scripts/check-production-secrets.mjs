#!/usr/bin/env node

/**
 * Production secrets checklist — validates environment variables for
 * production deployment readiness.
 *
 * Usage:
 *   npm run check:production-secrets
 *
 * Exit codes:
 *   0 — all required secrets present (or not in production mode)
 *   1 — missing required secrets in production mode
 */

async function main() {
  const { validateProductionSecrets, formatProductionValidation } = await import("@msl/agent");

  const env = /** @type {Record<string, string | undefined>} */ (process.env);
  const validation = validateProductionSecrets(env);
  const output = formatProductionValidation(validation, env);

  console.log(output);

  if (!validation.valid) {
    process.exit(1);
  }
}

await main();
