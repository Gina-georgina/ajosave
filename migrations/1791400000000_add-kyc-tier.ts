import { MigrationBuilder } from "node-pg-migrate";

/**
 * Migration: KYC tier system for contribution limits (Issue #223)
 *
 * Adds a `kyc_tier` column to users with three levels:
 *   unverified — default; max 50,000 NGN / cycle
 *   basic      — basic identity verification; max 500,000 NGN / cycle
 *   full       — full KYC approved; no limit
 *
 * The existing `kyc_status` column ('none'|'pending'|'approved'|'rejected') is
 * preserved and continues to be updated by the Smile Identity webhook.
 * Application code maps status → tier at startup; the `kyc_tier` column is the
 * authoritative value read by the contribution limits service.
 *
 * Backfill rule:
 *   kyc_status = 'approved'  → kyc_tier = 'full'
 *   kyc_status = 'pending'   → kyc_tier = 'basic'
 *   kyc_status IN ('none','rejected') → kyc_tier = 'unverified'
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("users", {
    kyc_tier: {
      type: "varchar(20)",
      notNull: true,
      default: "unverified",
      check: "kyc_tier IN ('unverified', 'basic', 'full')",
      comment:
        "KYC tier controlling contribution limits (Issue #223). " +
        "unverified: ≤50,000 NGN/cycle; basic: ≤500,000 NGN/cycle; full: unlimited.",
    },
  });

  // Backfill existing users from kyc_status
  pgm.sql(`
    UPDATE users SET kyc_tier = CASE
      WHEN kyc_status = 'approved' THEN 'full'
      WHEN kyc_status = 'pending'  THEN 'basic'
      ELSE 'unverified'
    END;
  `);

  pgm.createIndex("users", "kyc_tier", {
    name: "idx_users_kyc_tier",
    ifNotExists: true,
  });

  pgm.sql(`
    COMMENT ON COLUMN users.kyc_tier IS
      'Issue #223: Contribution tier. unverified=50k NGN/cycle, basic=500k NGN/cycle, full=unlimited. ' ||
      'Backfilled from kyc_status and kept in sync by the KYC webhook handler.';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("users", "kyc_tier", {
    name: "idx_users_kyc_tier",
    ifExists: true,
  });
  pgm.dropColumn("users", "kyc_tier");
}
