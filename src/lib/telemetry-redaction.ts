/**
 * Telemetry redaction utilities (#106)
 *
 * Strips or masks sensitive fields before they leave the process via Sentry,
 * structured logs, or any other observability pipeline.
 *
 * Covered categories:
 *   - Financial: account numbers, card PANs, CVVs, IBAN, BVN, amounts in PII context
 *   - Identity:  phone numbers, full names in certain contexts, NIN/BVN, email
 *   - Operational: secret keys, tokens, passwords, OTP codes, wallet private keys
 */

/** Sentinel value written in place of a redacted field. */
export const REDACTED = "[REDACTED]";

// ── Field-name deny-list ─────────────────────────────────────────────────────
// Any object key matching one of these patterns will have its value replaced.
const SENSITIVE_KEYS = new Set([
  // auth / credentials
  "password",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "api_key",
  "apiKey",
  "authorization",
  "cookie",
  "otp",
  "otpCode",
  "otp_code",
  "pin",
  "private_key",
  "privateKey",
  "secretKey",
  "secret_key",
  "signing_key",
  "signingKey",
  "jwt",
  "sessionToken",
  "session_token",
  "csrfToken",
  "csrf_token",

  // identity / PII
  "phone",
  "phoneNumber",
  "phone_number",
  "email",
  "emailAddress",
  "email_address",
  "bvn",
  "nin",
  "name",          // redact free-form full-name fields
  "full_name",
  "fullName",
  "firstName",
  "first_name",
  "lastName",
  "last_name",
  "dateOfBirth",
  "date_of_birth",
  "dob",
  "address",
  "nationalId",
  "national_id",

  // financial
  "accountNumber",
  "account_number",
  "cardNumber",
  "card_number",
  "pan",
  "cvv",
  "iban",
  "sortCode",
  "sort_code",
  "paystackReference",
  "paystack_reference",
  "transactionPin",
  "transaction_pin",

  // Stellar / crypto
  "stellarSecret",
  "stellar_secret",
  "walletSecret",
  "wallet_secret",
  "mnemonic",
  "seed",
]);

// ── Value-pattern deny-list ──────────────────────────────────────────────────
// String values matching any of these patterns will be redacted regardless of key.
const SENSITIVE_PATTERNS: RegExp[] = [
  // Stellar secret key (S + 55 base32 chars)
  /\bS[A-Z2-7]{55}\b/,
  // Nigerian phone number patterns
  /\b(0|\+?234)[789]\d{9}\b/,
  // Generic E.164
  /\+\d{7,15}\b/,
  // BVN (11 digits, common in Nigerian fintech)
  /\b\d{11}\b/,
  // NIN (11 digits — same pattern; redact conservatively)
  // Email
  /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/,
];

// ── Core redaction function ──────────────────────────────────────────────────

/**
 * Deep-clone `value` replacing any sensitive fields/values with `REDACTED`.
 * Handles plain objects, arrays, and primitive strings.
 * Circular references are handled with a WeakSet guard.
 */
export function redact(value: unknown, _seen = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return redactString(value);
  }

  if (typeof value !== "object") return value;

  if (_seen.has(value as object)) return REDACTED;
  _seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, _seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = redact(val, _seen);
    }
  }
  return result;
}

/** Returns true when a field key should always be redacted. */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  // Exact match
  if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(lower)) return true;
  // Substring match for common suffixes/prefixes
  if (
    lower.includes("secret") ||
    lower.includes("password") ||
    lower.includes("token") ||
    lower.includes("private") ||
    lower.includes("apikey") ||
    lower.includes("api_key")
  ) {
    return true;
  }
  return false;
}

/** Masks sensitive sub-strings inside a plain string value. */
function redactString(s: string): string {
  for (const pattern of SENSITIVE_PATTERNS) {
    s = s.replace(pattern, REDACTED);
  }
  return s;
}

// ── HTTP header redaction ────────────────────────────────────────────────────

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
]);

/** Redact sensitive HTTP request/response headers for telemetry. */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [key, val] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : val;
  }
  return out;
}

// ── Sentry beforeSend hook helper ────────────────────────────────────────────
// Import this in sentry.server.config.ts / sentry.client.config.ts

import type { Event as SentryEvent } from "@sentry/core";

/**
 * Pass this as `beforeSend` in `Sentry.init()` to strip PII from every event.
 *
 * @example
 * Sentry.init({ beforeSend: redactSentryEvent });
 */
export function redactSentryEvent(event: SentryEvent): SentryEvent | null {
  // Redact request body
  if (event.request?.data) {
    event.request.data = redact(event.request.data);
  }

  // Redact query string
  if (typeof event.request?.query_string === "string") {
    event.request.query_string = redactString(event.request.query_string);
  } else if (
    event.request?.query_string &&
    typeof event.request.query_string === "object"
  ) {
    event.request.query_string = redact(event.request.query_string) as Record<
      string,
      string
    >;
  }

  // Redact headers
  if (event.request?.headers) {
    event.request.headers = redactHeaders(
      event.request.headers as Record<string, string>
    ) as Record<string, string>;
  }

  // Redact extra / contexts blobs
  if (event.extra) {
    event.extra = redact(event.extra) as Record<string, unknown>;
  }

  if (event.contexts) {
    event.contexts = redact(event.contexts) as Record<string, unknown>;
  }

  // Redact breadcrumb data
  if (event.breadcrumbs?.values) {
    event.breadcrumbs.values = event.breadcrumbs.values.map((b) => ({
      ...b,
      data: b.data ? (redact(b.data) as Record<string, unknown>) : b.data,
    }));
  }

  // Never send user email or IP to Sentry
  if (event.user) {
    const { id, segment } = event.user;
    event.user = { id, segment }; // strip email, ip_address, username, etc.
  }

  return event;
}
