import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable server-side instrumentation hook for shared env loading.
  // instrumentation.ts runs `loadRepositoryEnvironment()` at server startup.
  instrumentationHook: true,
  transpilePackages: [
    "@msl/agent",
    "@msl/domain",
    "@msl/mercadolibre",
    "@msl/tools",
    "@msl/workers",
  ],
};

export default nextConfig;
