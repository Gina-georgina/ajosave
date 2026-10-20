/** @type {import('next').NextConfig} */

// Security headers addressing OWASP ZAP HIGH/CRITICAL findings (issue #182)
const securityHeaders = [
  // Prevent clickjacking
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  // Stop browsers from MIME-sniffing
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  // Force HTTPS for 1 year, include sub-domains
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  // Referrer policy — never send origin cross-site
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  // Permissions / Feature Policy
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(self), interest-cohort=()",
  },
  // Content Security Policy
  // - default-src 'self'        – only load resources from same origin by default
  // - script-src 'self'         – no inline scripts, no eval (prevents XSS)
  // - style-src 'self' 'unsafe-inline' – Next.js injects inline styles; tighten further with nonces in a future pass
  // - img-src 'self' data: https: – allow data URIs and remote images (OG, avatars)
  // - connect-src 'self' wss:   – WebSocket connections on same host only
  // - font-src 'self' data:     – fonts from same origin and embedded data URIs
  // - frame-ancestors 'none'    – equivalent to DENY for X-Frame-Options
  // - form-action 'self'        – form submissions only to same origin
  // - base-uri 'self'           – prevent base tag injection
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval'",   // 'unsafe-eval' required by Next.js dev; remove in production once nonces are wired up
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self' wss: https:",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  // Block cross-origin embedding of this site (defence-in-depth alongside CSP)
  {
    key: "X-Permitted-Cross-Domain-Policies",
    value: "none",
  },
  // Remove fingerprinting header added by some proxies/CDNs
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  // Cross-Origin policies — lock down resource sharing and opener relationships
  {
    key: "Cross-Origin-Embedder-Policy",
    value: "require-corp",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "Cross-Origin-Resource-Policy",
    value: "same-origin",
  },
];

const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@stellar/stellar-sdk"],

  async headers() {
    return [
      {
        // Apply to all routes
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
