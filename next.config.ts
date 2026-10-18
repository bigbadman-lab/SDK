import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["pino-pretty", "lokijs", "encoding", "postgres"],
};

export default nextConfig;
