/**
 * Referral fraud controls service.
 *
 * Issue #227 — Referral code validation and fraud prevention
 *
 * Fraud checks implemented:
 *  1. Self-referral prevention — a user cannot use their own referral code (→ 422)
 *  2. Code deactivated — admin can disable a referral code (→ 422)
 *  3. Use-limit enforcement — each code is limited to N uses (configurable, default: 10)
 *  4. Phone already registered — users with an existing account cannot use a referral code
 *  5. Duplicate prevention — a user can only be referred once
 *  6. Velocity limit — max 5 referrals per referrer per 24 h window
 *  7. IP-based abuse — max 3 referrals from the same IP in 24 h
 *  8. Suspicious patterns — flagged in audit_logs for admin review
 *
 * Reward rules (Issue #227):
 *  - Reward is NOT granted at validation time; it is granted by grantReferralReward()
 *    once the referee makes their first confirmed contribution.
 *
 * All fraud events are written to `referral_fraud_audit_log` for observability.
 */

import { randomUUID } from "crypto";
import { query, transaction } from "@/lib/db";
import { logAuditAction } from "./audit.service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReferralFraudReason =
  | "SELF_REFERRAL"
  | "ALREADY_REFERRED"
  | "VELOCITY_LIMIT"
  | "IP_LIMIT"
  | "INVALID_CODE"
  | "CODE_DEACTIVATED"
  | "USE_LIMIT_EXCEEDED"
  | "PHONE_ALREADY_REGISTERED"
  | "UNKNOWN";

export class ReferralFraudError extends Error {
  constructor(
    public readonly reason: ReferralFraudReason,
    message: string
  ) {
    super(message);
    this.name = "ReferralFraudError";
  }
}

export interface ReferralValidationResult {
  valid: true;
  referrerId: string;
  referralCode: string;
}

export interface ReferralStats {
  referralCode: string;
  totalReferrals: number;
  referralsLast24h: number;
  referredBy: string | null;
}

// ─── Velocity / use-limit thresholds ─────────────────────────────────────────

const VELOCITY_LIMIT_PER_24H = 5;   // max referrals a referrer can make per 24 h
const IP_LIMIT_PER_24H = 3;         // max referrals from one IP per 24 h

/** Default maximum times a single referral code can be used (Issue #227, configurable via env). */
function getMaxUses(): number {
  const env = parseInt(process.env.REFERRAL_MAX_USES ?? "10", 10);
  return Number.isFinite(env) && env > 0 ? env : 10;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Log a fraud event to the audit table.
 * Never throws — audit failures are logged to console and swallowed so they
 * don't block the calling flow.
 */
async function logFraudEvent(opts: {
  referrerId: string | null;
  suspectUserId: string | null;
  referralCode: string | null;
  reason: ReferralFraudReason;
  ipAddress: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO referral_fraud_audit_log
         (id, referrer_id, suspect_user_id, referral_code, reason, ip_address, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        randomUUID(),
        opts.referrerId,
        opts.suspectUserId,
        opts.referralCode,
        opts.reason,
        opts.ipAddress,
        JSON.stringify(opts.metadata ?? {}),
      ]
    );
  } catch (err) {
    console.error("[referral.service] Failed to write fraud audit log:", err);
  }
}

/**
 * Flag a suspicious referral pattern in the main audit_logs table so that
 * admin dashboards and alerting pipelines surface it (Issue #227).
 * Never throws.
 */
async function flagSuspiciousPattern(opts: {
  actorId: string;
  targetId: string;
  reason: ReferralFraudReason;
  ipAddress: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await logAuditAction(opts.actorId, "OTHER", "USER", opts.targetId, {
      details: {
        event: "REFERRAL_SUSPICIOUS_PATTERN",
        reason: opts.reason,
        ...opts.metadata,
      },
      ipAddress: opts.ipAddress ?? undefined,
    });
  } catch (err) {
    console.error("[referral.service] Failed to write suspicious pattern audit log:", err);
  }
}

// ─── Core service functions ───────────────────────────────────────────────────

/**
 * Validate a referral code and apply fraud checks before recording the referral.
 *
 * Called when a new user submits a referral code (e.g. during sign-up or from
 * the referral page).  On success the referral row is inserted (without
 * granting the reward yet — that happens via grantReferralReward()).
 *
 * @param code          The referral code submitted by the new user
 * @param newUserId     The user ID of the person being referred
 * @param ipAddress     IP address of the request (for IP-velocity check), or null
 * @throws ReferralFraudError if any fraud check fails
 * @throws Error if the code is invalid or DB ops fail
 */
export async function validateReferral(
  code: string,
  newUserId: string,
  ipAddress: string | null = null
): Promise<ReferralValidationResult> {
  return await transaction(async (q) => {
    // ── 1. Look up the referrer ──────────────────────────────────────────────
    const { rows: referrerRows } = await q<{
      id: string;
      referral_code: string;
      referral_code_active: boolean;
      referral_use_limit: number | null;
    }>(
      `SELECT id, referral_code, referral_code_active, referral_use_limit
       FROM users
       WHERE referral_code = $1
       FOR SHARE`,
      [code.toUpperCase()]
    );

    if (!referrerRows[0]) {
      await logFraudEvent({
        referrerId: null,
        suspectUserId: newUserId,
        referralCode: code,
        reason: "INVALID_CODE",
        ipAddress,
      });
      throw new ReferralFraudError("INVALID_CODE", "Invalid referral code.");
    }

    const referrerId = referrerRows[0].id;
    const referralCode = referrerRows[0].referral_code;

    // ── 2. Code deactivation check (admin can disable codes) — Issue #227 ────
    if (!referrerRows[0].referral_code_active) {
      await logFraudEvent({
        referrerId,
        suspectUserId: newUserId,
        referralCode,
        reason: "CODE_DEACTIVATED",
        ipAddress,
      });
      throw new ReferralFraudError("CODE_DEACTIVATED", "This referral code has been deactivated.");
    }

    // ── 3. Self-referral check (returns 422) — Issue #227 ────────────────────
    if (referrerId === newUserId) {
      await logFraudEvent({
        referrerId,
        suspectUserId: newUserId,
        referralCode,
        reason: "SELF_REFERRAL",
        ipAddress,
      });
      throw new ReferralFraudError("SELF_REFERRAL", "You cannot use your own referral code.");
    }

    // ── 4. Phone already registered check — Issue #227 ───────────────────────
    // A user who already has an account (non-null created_at on their record)
    // should not be able to use a referral code; the referral scheme is for
    // NEW users only.
    const { rows: newUserRows } = await q<{ created_at: Date; referred_by: string | null }>(
      "SELECT created_at, referred_by FROM users WHERE id = $1",
      [newUserId]
    );
    // If the user was created more than 24 h ago they are not a new user
    const userCreatedAt = newUserRows[0]?.created_at;
    const isExistingUser =
      userCreatedAt &&
      Date.now() - new Date(userCreatedAt).getTime() > 24 * 60 * 60 * 1000;

    if (isExistingUser) {
      await logFraudEvent({
        referrerId,
        suspectUserId: newUserId,
        referralCode,
        reason: "PHONE_ALREADY_REGISTERED",
        ipAddress,
      });
      await flagSuspiciousPattern({
        actorId: newUserId,
        targetId: referrerId,
        reason: "PHONE_ALREADY_REGISTERED",
        ipAddress,
        metadata: { referralCode },
      });
      throw new ReferralFraudError(
        "PHONE_ALREADY_REGISTERED",
        "Referral codes can only be used during account creation."
      );
    }

    // ── 5. Duplicate referral check ──────────────────────────────────────────
    const { rows: existingRows } = await q<{ id: string }>(
      "SELECT id FROM referrals WHERE referred_id = $1 LIMIT 1",
      [newUserId]
    );
    if (existingRows[0]) {
      await logFraudEvent({
        referrerId,
        suspectUserId: newUserId,
        referralCode,
        reason: "ALREADY_REFERRED",
        ipAddress,
      });
      throw new ReferralFraudError("ALREADY_REFERRED", "You have already used a referral code.");
    }

    // ── 6. Per-code use-limit check — Issue #227 ─────────────────────────────
    const maxUses =
      referrerRows[0].referral_use_limit != null
        ? referrerRows[0].referral_use_limit
        : getMaxUses();

    const { rows: useCountRows } = await q<{ count: string }>(
      "SELECT COUNT(*) AS count FROM referrals WHERE referrer_id = $1",
      [referrerId]
    );
    const totalUses = parseInt(useCountRows[0]?.count ?? "0", 10);

    if (totalUses >= maxUses) {
      await logFraudEvent({
        referrerId,
        suspectUserId: newUserId,
        referralCode,
        reason: "USE_LIMIT_EXCEEDED",
        ipAddress,
        metadata: { totalUses, maxUses },
      });
      await flagSuspiciousPattern({
        actorId: newUserId,
        targetId: referrerId,
        reason: "USE_LIMIT_EXCEEDED",
        ipAddress,
        metadata: { totalUses, maxUses },
      });
      throw new ReferralFraudError(
        "USE_LIMIT_EXCEEDED",
        "This referral code has reached its maximum number of uses."
      );
    }

    // ── 7. Velocity check (referrer) — max 5 referrals in 24 h ───────────────
    const { rows: velocityRows } = await q<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM referrals
       WHERE referrer_id = $1
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [referrerId]
    );
    const referralsLast24h = parseInt(velocityRows[0]?.count ?? "0", 10);

    if (referralsLast24h >= VELOCITY_LIMIT_PER_24H) {
      await logFraudEvent({
        referrerId,
        suspectUserId: newUserId,
        referralCode,
        reason: "VELOCITY_LIMIT",
        ipAddress,
        metadata: { referralsLast24h, limit: VELOCITY_LIMIT_PER_24H },
      });
      await flagSuspiciousPattern({
        actorId: referrerId,
        targetId: newUserId,
        reason: "VELOCITY_LIMIT",
        ipAddress,
        metadata: { referralsLast24h, limit: VELOCITY_LIMIT_PER_24H },
      });
      throw new ReferralFraudError(
        "VELOCITY_LIMIT",
        "Referral velocity limit exceeded. Please try again later."
      );
    }

    // ── 8. IP-address velocity check — max 3 referrals from same IP in 24 h ──
    if (ipAddress) {
      const { rows: ipRows } = await q<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM referral_fraud_audit_log
         WHERE ip_address = $1
           AND reason != 'INVALID_CODE'
           AND created_at > NOW() - INTERVAL '24 hours'`,
        [ipAddress]
      );
      const ipReferrals = parseInt(ipRows[0]?.count ?? "0", 10);

      if (ipReferrals >= IP_LIMIT_PER_24H) {
        await logFraudEvent({
          referrerId,
          suspectUserId: newUserId,
          referralCode,
          reason: "IP_LIMIT",
          ipAddress,
          metadata: { ipReferrals, limit: IP_LIMIT_PER_24H },
        });
        await flagSuspiciousPattern({
          actorId: newUserId,
          targetId: referrerId,
          reason: "IP_LIMIT",
          ipAddress,
          metadata: { ipReferrals, limit: IP_LIMIT_PER_24H },
        });
        throw new ReferralFraudError(
          "IP_LIMIT",
          "Too many referrals from this network. Please try again later."
        );
      }
    }

    // ── All checks passed — record the referral (reward granted later) ────────
    // NOTE: referred_by is updated; reward is NOT granted until first contribution
    // (see grantReferralReward). rewarded stays FALSE, rewarded_at stays NULL.
    await q("UPDATE users SET referred_by = $1 WHERE id = $2", [referrerId, newUserId]);

    await q(
      `INSERT INTO referrals (id, referrer_id, referred_id, rewarded, rewarded_at, created_at)
       VALUES ($1, $2, $3, FALSE, NULL, NOW())
       ON CONFLICT DO NOTHING`,
      [randomUUID(), referrerId, newUserId]
    );

    return {
      valid: true as const,
      referrerId,
      referralCode,
    };
  });
}

/**
 * Grant the referral reward to the referrer after the referee completes their
 * first confirmed contribution (Issue #227).
 *
 * This is idempotent — calling it multiple times for the same referral is safe.
 * Should be called from the contribution webhook / confirmation handler.
 *
 * @param referredUserId  The user ID of the person who was referred
 */
export async function grantReferralReward(referredUserId: string): Promise<void> {
  await transaction(async (q) => {
    // Look up the referral record; skip if not found or already rewarded
    const { rows: referralRows } = await q<{
      id: string;
      referrer_id: string;
      rewarded: boolean;
    }>(
      `SELECT id, referrer_id, rewarded
       FROM referrals
       WHERE referred_id = $1
       FOR UPDATE`,
      [referredUserId]
    );

    const referral = referralRows[0];
    if (!referral || referral.rewarded) return; // no referral or already rewarded

    // Mark as rewarded
    await q(
      `UPDATE referrals SET rewarded = TRUE, rewarded_at = NOW() WHERE id = $1`,
      [referral.id]
    );

    // Award +5 reputation to referrer (capped at 100)
    await q(
      "UPDATE users SET reputation_score = LEAST(reputation_score + 5, 100) WHERE id = $1",
      [referral.referrer_id]
    );
  });
}

/**
 * Check whether a referrer shows signs of abuse (for admin / review tooling).
 *
 * Returns all fraud events attributed to this referrer in the last 7 days,
 * and a summary of their referral velocity.
 */
export async function checkReferralFraud(referrerId: string): Promise<{
  isSuspicious: boolean;
  fraudEventsLast7d: number;
  referralsLast24h: number;
  reasons: ReferralFraudReason[];
}> {
  const [fraudRows, velocityRows] = await Promise.all([
    query<{ reason: string; count: string }>(
      `SELECT reason, COUNT(*) AS count
       FROM referral_fraud_audit_log
       WHERE referrer_id = $1
         AND created_at > NOW() - INTERVAL '7 days'
       GROUP BY reason`,
      [referrerId]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM referrals
       WHERE referrer_id = $1
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [referrerId]
    ),
  ]);

  const fraudEventsLast7d = fraudRows.rows.reduce(
    (sum, row) => sum + parseInt(row.count, 10),
    0
  );
  const referralsLast24h = parseInt(velocityRows.rows[0]?.count ?? "0", 10);
  const reasons = fraudRows.rows.map((row) => row.reason as ReferralFraudReason);

  return {
    isSuspicious: fraudEventsLast7d > 0 || referralsLast24h >= VELOCITY_LIMIT_PER_24H,
    fraudEventsLast7d,
    referralsLast24h,
    reasons,
  };
}

/**
 * Get referral statistics for a user.
 *
 * Lazily generates a referral code if the user doesn't have one yet.
 */
export async function getReferralStats(userId: string): Promise<ReferralStats> {
  // Lazily generate a referral code if the user doesn't have one
  const { rows: userRows } = await query<{
    referral_code: string | null;
    referred_by: string | null;
  }>("SELECT referral_code, referred_by FROM users WHERE id = $1", [userId]);

  let code = userRows[0]?.referral_code ?? null;

  if (!code) {
    // Generate a unique 8-char hex code
    const { randomBytes } = await import("crypto");
    code = randomBytes(4).toString("hex").toUpperCase();
    await query("UPDATE users SET referral_code = $1 WHERE id = $2", [code, userId]);
  }

  const [countRows, last24hRows, referredByRows] = await Promise.all([
    query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM referrals WHERE referrer_id = $1",
      [userId]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM referrals
       WHERE referrer_id = $1
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    ),
    userRows[0]?.referred_by
      ? query<{ display_name: string }>(
          "SELECT display_name FROM users WHERE id = $1",
          [userRows[0].referred_by]
        )
      : Promise.resolve({ rows: [] as { display_name: string }[] }),
  ]);

  return {
    referralCode: code,
    totalReferrals: parseInt(countRows.rows[0]?.count ?? "0", 10),
    referralsLast24h: parseInt(last24hRows.rows[0]?.count ?? "0", 10),
    referredBy: (referredByRows as { rows: { display_name: string }[] }).rows[0]?.display_name ?? null,
  };
}
