/**
 * Invite token helpers — DB-backed, single-use, 48h expiry.
 *
 * Each invite token is a cryptographically random 32-byte hex string stored
 * in the `invite_tokens` table.  Tokens are:
 *   - Single-use: consumed (marked used) on first successful validation
 *   - Time-limited: expire 48 hours after creation by default
 *   - Scoped: each token is bound to a specific circle and creator
 *
 * JWT-based tokens (legacy) are retained for backward compatibility but new
 * code should use the DB-backed helpers below.
 */

import { randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { query, transaction } from "@/lib/db";
import { serverConfig } from "@/server/config";

const SECRET = new TextEncoder().encode(serverConfig.authSecret);

// Default token lifetime, overridable via INVITE_TOKEN_EXPIRY_HOURS (issue #239)
const DEFAULT_EXPIRY_HOURS = Number(process.env.INVITE_TOKEN_EXPIRY_HOURS) > 0
  ? Number(process.env.INVITE_TOKEN_EXPIRY_HOURS)
  : 48;

/** Why an invite token could not be consumed. */
export type InviteTokenFailure = "not_found" | "expired" | "already_used";

/** Result of consuming an invite token, distinguishing each failure reason. */
export type ConsumeInviteTokenResult =
  | { ok: true; record: InviteTokenRecord }
  | { ok: false; reason: InviteTokenFailure };

// ─── DB-backed invite tokens ──────────────────────────────────────────────────

export interface InviteTokenRecord {
  token: string;
  circleId: string;
  createdBy: string;
  expiresAt: Date;
  usedAt: Date | null;
  usedBy: string | null;
}

/**
 * Generate a new invite token for a circle and persist it to the DB.
 *
 * @param circleId      Circle the invite is for
 * @param createdBy     User ID of the circle creator generating the link
 * @param expiresInHours Token lifetime in hours (default: 48)
 * @returns The raw token string to embed in an invite URL
 */
export async function generateInviteToken(
  circleId: string,
  createdBy: string,
  expiresInHours: number = DEFAULT_EXPIRY_HOURS
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  await query(
    `INSERT INTO invite_tokens (token, circle_id, created_by, expires_at, used_at, used_by)
     VALUES ($1, $2, $3, $4, NULL, NULL)`,
    [token, circleId, createdBy, expiresAt]
  );

  return token;
}

/**
 * Validate a raw invite token without consuming it.
 *
 * Returns the token record if valid (not expired, not already used), or null
 * if the token is invalid, expired, or already consumed.
 *
 * @param token Raw token string from the invite URL
 */
export async function validateInviteToken(token: string): Promise<InviteTokenRecord | null> {
  if (!token || typeof token !== "string") return null;

  try {
    const { rows } = await query<{
      token: string;
      circle_id: string;
      created_by: string;
      expires_at: Date;
      used_at: Date | null;
      used_by: string | null;
    }>(
      `SELECT token, circle_id, created_by, expires_at, used_at, used_by
       FROM invite_tokens
       WHERE token = $1`,
      [token]
    );

    const row = rows[0];
    if (!row) return null;

    // Already used
    if (row.used_at !== null) return null;

    // Expired
    if (new Date() > new Date(row.expires_at)) return null;

    return {
      token: row.token,
      circleId: row.circle_id,
      createdBy: row.created_by,
      expiresAt: new Date(row.expires_at),
      usedAt: null,
      usedBy: null,
    };
  } catch (err) {
    console.error("[tokens] validateInviteToken DB error:", err);
    return null;
  }
}

/**
 * Consume (mark as used) an invite token atomically.
 *
 * Performs a single atomic UPDATE that simultaneously validates expiry / single-
 * use constraints and marks the token as consumed.  Returns the token record on
 * success, or null if the token was invalid, already used, or expired.
 *
 * Returns a discriminated result so callers can tell an expired token (410)
 * apart from one that was already redeemed (409).
 *
 * This is the function to call when a user actually accepts an invite link.
 *
 * @param token   Raw token string from the invite URL
 * @param usedBy  User ID of the person accepting the invite
 */
export async function consumeInviteToken(
  token: string,
  usedBy: string
): Promise<ConsumeInviteTokenResult> {
  if (!token || typeof token !== "string") return { ok: false, reason: "not_found" };

  try {
    const record = await transaction(async (q) => {
      // Lock the row to prevent concurrent consumption
      const { rows } = await q<{
        token: string;
        circle_id: string;
        created_by: string;
        expires_at: Date;
        used_at: Date | null;
        used_by: string | null;
      }>(
        `SELECT token, circle_id, created_by, expires_at, used_at, used_by
         FROM invite_tokens
         WHERE token = $1
         FOR UPDATE`,
        [token]
      );

      const row = rows[0];
      if (!row) return null;

      // Already used — single-use enforced here
      if (row.used_at !== null) return "already_used" as const;

      // Expired
      if (new Date() > new Date(row.expires_at)) return "expired" as const;

      const now = new Date();

      // Mark as consumed
      await q(
        `UPDATE invite_tokens
         SET used_at = $1, used_by = $2
         WHERE token = $3`,
        [now, usedBy, token]
      );

      return {
        token: row.token,
        circleId: row.circle_id,
        createdBy: row.created_by,
        expiresAt: new Date(row.expires_at),
        usedAt: now,
        usedBy,
      };
    });

    if (record === null) return { ok: false, reason: "not_found" };
    if (record === "expired" || record === "already_used") {
      return { ok: false, reason: record };
    }
    return { ok: true, record };
  } catch (err) {
    console.error("[tokens] consumeInviteToken DB error:", err);
    return { ok: false, reason: "not_found" };
  }
}

// ─── Legacy JWT-based helpers (kept for backward compatibility) ───────────────

/**
 * @deprecated Use generateInviteToken() for new invite flows.
 * Creates a short-lived JWT invite token (not single-use, not DB-backed).
 */
export async function createInviteToken(circleId: string): Promise<string> {
  return await new SignJWT({ circleId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SECRET);
}

/**
 * @deprecated Use validateInviteToken() for new invite flows.
 * Verifies a legacy JWT invite token.
 */
export async function verifyInviteToken(token: string): Promise<{ circleId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as { circleId: string };
  } catch (err) {
    console.error("[verifyInviteToken] Invalid or expired token:", err);
    return null;
  }
}
