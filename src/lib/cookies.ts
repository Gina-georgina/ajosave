/**
 * Central definition of the cookies Ajosave sets, so every route applies the
 * same security attributes (see docs/secure-cookies.md).
 *
 * `NextResponse` is only used as a type here so this module stays cheap to
 * import and easy to test.
 */
import type { NextResponse } from "next/server";

export const REFRESH_TOKEN_COOKIE = "refreshToken";
export const REFRESH_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export const LOCALE_COOKIE = "locale";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year

export interface SecureCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: "/";
}

/** Minimal structural type so both `NextResponse` and test doubles fit. */
type CookieResponse = Pick<NextResponse, "cookies" | "headers">;

/** `Secure` is enforced everywhere except local development over http. */
export function isSecureContext(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === "production";
}

/** Attributes for the session-bearing refresh token cookie. */
export function refreshTokenCookieOptions(
  maxAge: number = REFRESH_TOKEN_MAX_AGE_SECONDS,
): SecureCookieOptions {
  return {
    httpOnly: true,
    secure: isSecureContext(),
    sameSite: "lax",
    maxAge,
    path: "/",
  };
}

/**
 * Sets the refresh token cookie and marks the response uncacheable so a
 * shared cache can never store or replay a response carrying `Set-Cookie`.
 */
export function setRefreshTokenCookie(response: CookieResponse, token: string): void {
  response.cookies.set(REFRESH_TOKEN_COOKIE, token, refreshTokenCookieOptions());
  response.headers.set("Cache-Control", "no-store");
}

/** Expires the refresh token cookie (used on logout). */
export function clearRefreshTokenCookie(response: CookieResponse): void {
  response.cookies.set(REFRESH_TOKEN_COOKIE, "", refreshTokenCookieOptions(0));
  response.headers.set("Cache-Control", "no-store");
}

/**
 * `document.cookie` string for the (client-readable, non-sensitive) locale
 * preference. It cannot be HttpOnly because the language selector writes it
 * from the browser, but it still gets `SameSite=Lax` and, over https, `Secure`.
 */
export function buildLocaleCookie(locale: string, secure: boolean): string {
  const parts = [
    `${LOCALE_COOKIE}=${encodeURIComponent(locale)}`,
    "path=/",
    `max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join(";");
}
