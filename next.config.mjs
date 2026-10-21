/** @type {import('next').NextConfig} */

// Security headers applied to every response (issue #294).
// HSTS is browser-enforced once a user visits over HTTPS: the browser
// remembers for 2 years (63072000s), applies to the whole domain
// (includeSubDomains), and qualifies for browser preload lists.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@stellar/stellar-sdk"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
