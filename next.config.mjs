/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@stellar/stellar-sdk"],

  /**
   * Security headers applied to all routes.
   *
   * These address the HIGH/CRITICAL categories most commonly flagged by
   * OWASP ZAP (issue #195):
   *
   *  - Content-Security-Policy     (ZAP rule 10038 — FAIL threshold)
   *  - Strict-Transport-Security   (ZAP rule 10035)
   *  - X-Frame-Options             (ZAP rule 10020 — clickjacking)
   *  - X-Content-Type-Options      (ZAP rule 10021)
   *  - Referrer-Policy             (ZAP rule 10110)
   *  - Permissions-Policy          (ZAP rule 10063)
   *  - X-XSS-Protection            (legacy browsers — ZAP rule 10016)
   *
   * CSP notes:
   *  - 'unsafe-inline' on script-src is intentionally absent; Next.js
   *    nonces are handled server-side via middleware.
   *  - The connect-src directive explicitly allows the Stellar Horizon and
   *    Soroban RPC endpoints used by the app.
   *  - Report-only is left off here; a report-only header can be layered
   *    via middleware once a CSP reporting endpoint is available.
   */
  async headers() {
    const isDev = process.env.NODE_ENV === "development";

    const cspDirectives = [
      "default-src 'self'",
      // Next.js requires 'unsafe-eval' in dev for hot-reload; strip in prod
      isDev
        ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
        : "script-src 'self'",
      "style-src 'self' 'unsafe-inline'", // CSS-in-JS / CSS Modules need inline
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      [
        "connect-src 'self'",
        "https://horizon.stellar.org",
        "https://horizon-testnet.stellar.org",
        "wss://horizon.stellar.org",
        "wss://horizon-testnet.stellar.org",
        "https://soroban-testnet.stellar.org",
        process.env.NEXT_PUBLIC_APP_URL ?? "",
      ]
        .filter(Boolean)
        .join(" "),
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "manifest-src 'self'",
      "worker-src 'self' blob:",
      "upgrade-insecure-requests",
    ].join("; ");

    const securityHeaders = [
      {
        key: "Content-Security-Policy",
        value: cspDirectives,
      },
      {
        key: "Strict-Transport-Security",
        // max-age 1 year; includeSubDomains; preload-ready
        value: "max-age=31536000; includeSubDomains; preload",
      },
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Permissions-Policy",
        value: [
          "camera=()",
          "microphone=()",
          "geolocation=()",
          "interest-cohort=()",
          "payment=()",
          "usb=()",
        ].join(", "),
      },
      {
        key: "X-XSS-Protection",
        value: "1; mode=block",
      },
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin",
      },
      {
        key: "Cross-Origin-Resource-Policy",
        value: "same-origin",
      },
      {
        key: "Cross-Origin-Embedder-Policy",
        value: "require-corp",
      },
    ];

    return [
      {
        // Apply to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // API routes: add CORS-safe defaults and remove caching
        source: "/api/(.*)",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      {
        // Static assets: allow cross-origin reads (fonts, images) but keep COEP off
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
