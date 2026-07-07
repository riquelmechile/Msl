import { resolveOAuthConfigs, createMultiAppOAuthManager } from "@msl/mercadolibre";
import type { OAuthManager } from "@msl/mercadolibre";

let _manager: OAuthManager | undefined;

export function getOAuthManager(): OAuthManager {
  if (!_manager) {
    const configs = resolveOAuthConfigs(process.env);
    if (configs.size === 0) {
      throw new Error(
        "No OAuth configs resolved from environment. Set per-seller or legacy OAuth env vars.",
      );
    }
    _manager = createMultiAppOAuthManager(configs);
  }
  return _manager;
}
