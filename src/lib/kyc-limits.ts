/**
 * KYC tier-based contribution limits (Issue #223)
 *
 * Three tiers control the maximum NGN a user may contribute per cycle:
 *   unverified — max 50,000 NGN  (configurable via KYC_LIMIT_UNVERIFIED_NGN)
 *   basic      — max 500,000 NGN (configurable via KYC_LIMIT_BASIC_NGN)
 *   full       — no limit        (configurable via KYC_LIMIT_FULL_NGN; 0 = unlimited)
 *
 * Usage:
 *   1. Call getKycTier(userId) to fetch the user's tier from the DB.
 *   2. Call checkKycContributionLimit(tier, amountNgn) to check the limit.
 *   3. If the check fails, return 422 with the message from KycLimitError.
 *
 * Integrate with audit logging:
 *   When a contribution is blocked, call logAuditAction(...) before returning
 *   the 422 response (see the contribute route handler).
 */

import { query } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type KycTier = "unverified" | "basic" | "full";

export class KycLimitError extends Error {
  constructor(
    public readonly tier: KycTier,
    public readonly limitNgn: number,
    public readonly amountNgn: number
  ) {
    super(
      tier === "unverified"
        ? "Complete KYC to increase your limit"
        : tier === "basic"
          ? "Complete full KYC to increase your limit"
          : "Contribution limit exceeded"
    );
    this.name = "KycLimitError";
  }
}

// ─── Limit resolution ─────────────────────────────────────────────────────────

/** Returns the configured NGN limit for a tier (0 = unlimited). */
export function getKycLimitNgn(tier: KycTier): number {
  switch (tier) {
    case "unverified": {
      const v = parseInt(process.env.KYC_LIMIT_UNVERIFIED_NGN ?? "50000", 10);
      return Number.isFinite(v) && v >= 0 ? v : 50_000;
    }
    case "basic": {
      const v = parseInt(process.env.KYC_LIMIT_BASIC_NGN ?? "500000", 10);
      return Number.isFinite(v) && v >= 0 ? v : 500_000;
    }
    case "full": {
      const v = parseInt(process.env.KYC_LIMIT_FULL_NGN ?? "0", 10);
      return Number.isFinite(v) && v >= 0 ? v : 0; // 0 = unlimited
    }
  }
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Fetch the KYC tier for a user from the database.
 * Falls back to "unverified" if the user is not found or the column is missing.
 */
export async function getKycTier(userId: string): Promise<KycTier> {
  const { rows } = await query<{ kyc_tier: KycTier }>(
    "SELECT kyc_tier FROM users WHERE id = $1",
    [userId]
  );
  const tier = rows[0]?.kyc_tier;
  if (tier === "basic" || tier === "full") return tier;
  return "unverified";
}

/**
 * Check whether a contribution amount is within the KYC tier limit.
 *
 * @param tier       The user's KYC tier
 * @param amountNgn  The proposed contribution amount in NGN
 * @throws {KycLimitError} if the amount exceeds the tier's limit
 */
export function checkKycContributionLimit(tier: KycTier, amountNgn: number): void {
  const limitNgn = getKycLimitNgn(tier);
  if (limitNgn === 0) return; // full KYC or unlimited env override — no limit
  if (amountNgn > limitNgn) {
    throw new KycLimitError(tier, limitNgn, amountNgn);
  }
}

/**
 * Convenience: fetch tier and check in one call.
 * Audit logging must be done by the caller.
 *
 * @param userId     The ID of the contributing user
 * @param amountNgn  The proposed contribution amount in NGN
 * @returns          The user's tier (for use in audit logging)
 * @throws {KycLimitError} if the amount exceeds the limit
 */
export async function enforceKycContributionLimit(
  userId: string,
  amountNgn: number
): Promise<KycTier> {
  const tier = await getKycTier(userId);
  checkKycContributionLimit(tier, amountNgn);
  return tier;
}
