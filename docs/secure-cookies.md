# Secure Cookie Headers

All cookies Ajosave sets are defined in `src/lib/cookies.ts` so every route applies the same
attributes. Do not call `response.cookies.set` / write `document.cookie` for new cookies
without going through (or extending) that module.

## Cookies

| Cookie | Set by | Purpose | HttpOnly | Secure | SameSite | Lifetime |
|---|---|---|---|---|---|---|
| `refreshToken` | `POST /api/auth/refresh`, `POST /api/v1/auth/refresh` | Rotating refresh token (session) | yes | production | `Lax` | 7 days |
| `refreshToken` (cleared) | `POST /api/auth/logout`, `POST /api/v1/auth/logout` | Logout | yes | production | `Lax` | `Max-Age=0` |
| `locale` | `LanguageSelector` (browser) | Language preference, non-sensitive | no (written by client JS) | when served over https | `Lax` | 1 year |

## Attributes and why

- **`HttpOnly`** (refresh token): page JavaScript, including an XSS payload, cannot read the token.
- **`Secure`**: the browser never sends the cookie over plain http. It is off only when
  `NODE_ENV !== "production"` so local development over `http://localhost` still works. The
  `locale` cookie follows the page protocol.
- **`SameSite=Lax`**: the cookie is not sent on cross-site sub-requests or cross-site POSTs,
  which blocks CSRF against the refresh and logout endpoints while keeping normal link
  navigation working. `Strict` was not chosen because it drops the cookie on the first
  navigation from an external link (e.g. an invite shared over WhatsApp/SMS).
- **`Path=/`**, no `Domain`: the cookie is host-only and is not shared with sibling subdomains.
- **`Cache-Control: no-store`** on every response that sets or clears the refresh token, so no
  shared cache can store or replay a response containing `Set-Cookie`.
- **Value encoding** for the client-written `locale` cookie prevents attribute injection
  (`en; Domain=evil.com`).

## Not done (and why)

- **`__Host-` name prefix**: would require renaming `refreshToken`, which invalidates every
  active session on deploy. Track it as a follow-up with a migration window.
- **`SameSite=Strict`** for the refresh token: see above.

## Tests

`src/lib/__tests__/cookies.test.ts` covers the attribute set, production vs development
`Secure`, the logout expiry, `no-store`, and locale value encoding. The legacy refresh route test
(`src/app/api/auth/refresh/__tests__`) also asserts `HttpOnly`, `SameSite=Lax` and `Secure` end to end.
