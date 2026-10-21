import { MigrationBuilder } from "node-pg-migrate";

/**
 * Add min_reputation column to circles table for reputation gating
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE circles
    ADD COLUMN IF NOT EXISTS min_reputation INTEGER DEFAULT 0 CHECK (min_reputation >= 0 AND min_reputation <= 100)
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE circles DROP COLUMN IF EXISTS min_reputation`);
}
