import { MigrationBuilder } from "node-pg-migrate";

/**
 * Migration: Referral fraud hardening (Issue #227)
 *
 * 1. Add `referral_code_active` boolean to users — allows admin to deactivate a referral code.
 * 2. Add `referral_use_limit` to users — max times a referral code can be used (configurable,
 *    default 10; NULL = unlimited).
 * 3. Add `rewarded_at` to referrals — tracks when the reward was granted (after first contribution).
 * 4. Add phone-based duplicate index (already unique on users.phone, but add an index on
 *    referrals to quickly look up all referrals by the referred user's phone).
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  // Allow admin to deactivate a referral code without deleting the user
  pgm.addColumn("users", {
    referral_code_active: {
      type: "boolean",
      notNull: true,
      default: true,
      comment: "Set to false by admin to deactivate this referral code (Issue #227)",
    },
  });

  // Per-code use limit (NULL = use env default)
  pgm.addColumn("users", {
    referral_use_limit: {
      type: "integer",
      comment:
        "Max number of times this user's referral code can be used. NULL = use REFERRAL_MAX_USES env var.",
    },
  });

  // Track when reward was actually granted (after referee's first contribution)
  pgm.addColumn("referrals", {
    rewarded_at: {
      type: "timestamp",
      comment:
        "Timestamp when the referrer reward was granted (after referee first contribution). NULL = not yet rewarded.",
    },
  });

  // Index: quickly check how many active uses a code has received
  pgm.createIndex("referrals", ["referrer_id", "created_at"], {
    name: "idx_referrals_referrer_created_at",
    ifNotExists: true,
  });

  // Index: admin queries on active/inactive codes
  pgm.createIndex("users", ["referral_code_active"], {
    name: "idx_users_referral_code_active",
    ifNotExists: true,
  });

  pgm.sql(`
    COMMENT ON COLUMN users.referral_code_active IS
      'Admin-controlled flag. When false the code is rejected at validation time (Issue #227).';
    COMMENT ON COLUMN users.referral_use_limit IS
      'Per-code hard limit on successful referrals. Overrides the REFERRAL_MAX_USES env var when set.';
    COMMENT ON COLUMN referrals.rewarded_at IS
      'Set by grantReferralReward() after the referee makes their first confirmed contribution (Issue #227).';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("users", ["referral_code_active"], {
    name: "idx_users_referral_code_active",
    ifExists: true,
  });
  pgm.dropIndex("referrals", ["referrer_id", "created_at"], {
    name: "idx_referrals_referrer_created_at",
    ifExists: true,
  });
  pgm.dropColumn("referrals", "rewarded_at");
  pgm.dropColumn("users", "referral_use_limit");
  pgm.dropColumn("users", "referral_code_active");
}
