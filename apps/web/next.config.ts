import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Transfer Desk was renamed Integrations on 21 November 2026; the old
  // addresses redirect for one release, then these entries are removed.
  async redirects() {
    return [
      {
        source: "/t/:code/settings/integrations/transfer-desk",
        destination: "/t/:code/integrations/interfaces",
        permanent: true
      },
      {
        source: "/t/:code/settings/integrations/saf-import",
        destination: "/t/:code/integrations/saf-import",
        permanent: true
      },
      {
        source: "/t/:code/settings/integrations",
        destination: "/t/:code/integrations/connectors",
        permanent: true
      },
      {
        source: "/t/:code/transfer-desk/:path*",
        destination: "/t/:code/integrations/:path*",
        permanent: true
      }
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload"
          }
          // CSP is set dynamically in middleware.ts with per-request nonce
        ]
      }
    ];
  }
};

export default nextConfig;
