import { MigrationBuilder } from "node-pg-migrate";

/**
 * Add privilege column to audit_logs to flag privileged events.
 * Backfills existing rows as 'STANDARD'.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE audit_logs
      ADD COLUMN IF NOT EXISTS privilege TEXT NOT NULL DEFAULT 'STANDARD'
        CHECK (privilege IN ('STANDARD', 'PRIVILEGED'))
  `);

  // Mark known privileged action types that already exist in the table
  pgm.sql(`
    UPDATE audit_logs
    SET privilege = 'PRIVILEGED'
    WHERE action IN (
      'ADMIN_OVERRIDE', 'PRIVILEGE_ESCALATION', 'SECRET_ACCESS',
      'KYC_OVERRIDE', 'FORCED_PAYOUT', 'BULK_OPERATION',
      'ACCOUNT_SUSPENSION', 'FEE_WAIVER'
    )
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_privilege
      ON audit_logs (privilege, created_at DESC)
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP INDEX IF EXISTS idx_audit_logs_privilege`);
  pgm.sql(`ALTER TABLE audit_logs DROP COLUMN IF EXISTS privilege`);
}
