import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@msl/agent",
    "@msl/domain",
    "@msl/mercadolibre",
    "@msl/tools",
    "@msl/workers",
  ],
};

export default nextConfig;
