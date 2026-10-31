import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this, Turbopack walks up looking for a
  // lockfile and can pick a parent directory (e.g. a stray ~/package-lock.json),
  // which breaks the RSC manifest in dev with cryptic "Invalid or unexpected
  // token" / missing-client-module errors.
  turbopack: { root: __dirname },
};

export default nextConfig;
