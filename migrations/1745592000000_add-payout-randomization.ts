import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Add payout_method and randomization_seed columns to circles table
  pgm.addColumn("circles", {
    payout_method: { type: "varchar(20)", notNull: true, default: "'fixed'" },
    randomization_seed: { type: "varchar(255)" },
  });

  // Add updated_at column to members table
  pgm.addColumn("members", {
    updated_at: { type: "timestamp", notNull: true, default: pgm.func("NOW()") },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("members", "updated_at");
  pgm.dropColumn("circles", "payout_method");
  pgm.dropColumn("circles", "randomization_seed");
}
