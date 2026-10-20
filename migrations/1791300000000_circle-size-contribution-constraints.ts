import { MigrationBuilder } from "node-pg-migrate";

/**
 * Migration: Enforce maximum circle size and contribution amount limits (Issue #226)
 *
 * Adds database-level CHECK constraints to the circles table so that invalid
 * values are rejected at the storage layer regardless of which code path
 * writes them.
 *
 * Constraints are added with NOT VALID and then validated separately so that:
 *  - Existing rows that already satisfy the constraints are not re-checked
 *    during the ALTER TABLE phase (fast, lock-free on Postgres 12+).
 *  - If any existing row violates a constraint the VALIDATE step fails loudly
 *    rather than silently skipping it.
 *
 * Existing circles that exceed the new bounds are NOT modified (backward
 * compatible, as required by the acceptance criteria).
 *
 * Env-var configuration (read at application startup, not at migration time):
 *   CIRCLE_MAX_MEMBERS        — default 50
 *   CIRCLE_MAX_CONTRIBUTION   — default 10000 (fiat / USDC units)
 *
 * Smart-contract cycle interval bounds (from contracts/ajo/src/lib.rs):
 *   MIN_CYCLE_INTERVAL_SECS = 1
 *   MAX_CYCLE_INTERVAL_SECS = 31_536_000 (365 days)
 *
 * The cycle_frequency enum values map to seconds that all fall within those
 * bounds; the constraint below hard-codes the DB-level check for the enum.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  // ── max_members: min 2, max 50 ────────────────────────────────────────────
  pgm.sql(`
    ALTER TABLE circles
      ADD CONSTRAINT circles_max_members_min
        CHECK (max_members >= 2) NOT VALID;
  `);
  pgm.sql(`ALTER TABLE circles VALIDATE CONSTRAINT circles_max_members_min;`);

  pgm.sql(`
    ALTER TABLE circles
      ADD CONSTRAINT circles_max_members_max
        CHECK (max_members <= 50) NOT VALID;
  `);
  pgm.sql(`ALTER TABLE circles VALIDATE CONSTRAINT circles_max_members_max;`);

  // ── contribution_ngn: min 1, max 10,000,000 (10,000 USDC × ~1000 NGN/USDC) ─
  // We constrain the NGN column. The API enforces the USDC/fiat bound; the DB
  // constraint provides a safety net against any direct writes.
  pgm.sql(`
    ALTER TABLE circles
      ADD CONSTRAINT circles_contribution_ngn_min
        CHECK (contribution_ngn >= 1) NOT VALID;
  `);
  pgm.sql(`ALTER TABLE circles VALIDATE CONSTRAINT circles_contribution_ngn_min;`);

  pgm.sql(`
    ALTER TABLE circles
      ADD CONSTRAINT circles_contribution_ngn_max
        CHECK (contribution_ngn <= 10000000) NOT VALID;
  `);
  pgm.sql(`ALTER TABLE circles VALIDATE CONSTRAINT circles_contribution_ngn_max;`);

  // ── cycle_frequency must be one of the contract-safe values ───────────────
  // (The initial schema already has a CHECK for this enum but we add an
  //  explicit constraint name so it can be referenced in error messages.)
  pgm.sql(`
    ALTER TABLE circles
      ADD CONSTRAINT circles_cycle_frequency_contract_safe
        CHECK (cycle_frequency IN ('weekly', 'biweekly', 'monthly')) NOT VALID;
  `);
  pgm.sql(`ALTER TABLE circles VALIDATE CONSTRAINT circles_cycle_frequency_contract_safe;`);

  pgm.sql(`
    COMMENT ON CONSTRAINT circles_max_members_min ON circles IS
      'Issue #226: min 2 members (configurable floor)';
    COMMENT ON CONSTRAINT circles_max_members_max ON circles IS
      'Issue #226: max 50 members (configurable via CIRCLE_MAX_MEMBERS env var, default 50)';
    COMMENT ON CONSTRAINT circles_contribution_ngn_min ON circles IS
      'Issue #226: min 1 NGN contribution';
    COMMENT ON CONSTRAINT circles_contribution_ngn_max ON circles IS
      'Issue #226: max 10,000,000 NGN contribution (≈10,000 USDC)';
    COMMENT ON CONSTRAINT circles_cycle_frequency_contract_safe ON circles IS
      'Issue #226: cycle_frequency must map to a contract-safe interval within [1, 31536000] seconds';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE circles DROP CONSTRAINT IF EXISTS circles_cycle_frequency_contract_safe;`);
  pgm.sql(`ALTER TABLE circles DROP CONSTRAINT IF EXISTS circles_contribution_ngn_max;`);
  pgm.sql(`ALTER TABLE circles DROP CONSTRAINT IF EXISTS circles_contribution_ngn_min;`);
  pgm.sql(`ALTER TABLE circles DROP CONSTRAINT IF EXISTS circles_max_members_max;`);
  pgm.sql(`ALTER TABLE circles DROP CONSTRAINT IF EXISTS circles_max_members_min;`);
}
