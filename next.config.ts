import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Browser-side hardening. No nonces: they would force every page dynamic
// just to carry a token, and the app loads no third-party scripts to
// allow-list — so a static policy is simpler and still strict where it
// counts: nothing can frame us, no plugins, forms only post to us.
const csp = [
  "default-src 'self'",
  // React itself needs 'unsafe-eval' in dev for source-mapped error stacks.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  // Dev: Turbopack's HMR socket.
  `connect-src 'self'${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]),
];

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this, Turbopack walks up looking for a
  // lockfile and can pick a parent directory (e.g. a stray ~/package-lock.json),
  // which breaks the RSC manifest in dev with cryptic "Invalid or unexpected
  // token" / missing-client-module errors.
  turbopack: { root: __dirname },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
