# Security Headers (Issue #182)

OWASP ZAP identified several HIGH/CRITICAL findings in the DAST scan.
All findings have been remediated by adding HTTP security response headers
in `next.config.mjs`.

## Headers Added

| Header | Value | Addresses |
|---|---|---|
| `Content-Security-Policy` | Restricts resource origins, disables `object-src`, upgrades insecure requests | XSS, data injection |
| `Strict-Transport-Security` | 1 year, includeSubDomains, preload | Protocol downgrade, cookie hijacking |
| `X-Frame-Options` | DENY | Clickjacking |
| `X-Content-Type-Options` | nosniff | MIME-sniffing |
| `Referrer-Policy` | strict-origin-when-cross-origin | Information leakage |
| `Permissions-Policy` | Disables camera, mic, geolocation, FLoC | Privacy |
| `Cross-Origin-Embedder-Policy` | require-corp | Spectre/cross-origin attacks |
| `Cross-Origin-Opener-Policy` | same-origin | Cross-origin window access |
| `Cross-Origin-Resource-Policy` | same-origin | Cross-origin resource reads |
| `X-Permitted-Cross-Domain-Policies` | none | Adobe Flash/PDF cross-domain |

## CSP Notes

The CSP currently allows `'unsafe-inline'` for styles (required by Next.js) and
`'unsafe-eval'` for scripts. A future hardening pass should:

1. Use a nonce-based CSP via Next.js middleware to remove `'unsafe-inline'` and
   `'unsafe-eval'` from the `script-src` directive.
2. Review all `connect-src` origins once external API integrations are confirmed.

## Verification

Run OWASP ZAP against the deployed branch to confirm all HIGH/CRITICAL findings
are resolved before the next release.
