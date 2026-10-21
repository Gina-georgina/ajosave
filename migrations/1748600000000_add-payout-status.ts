import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("payouts", {
    status: { type: "varchar(20)", notNull: true, default: "'completed'" },
    retry_count: { type: "integer", notNull: true, default: 0 },
    last_error: { type: "text" },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("payouts", ["status", "retry_count", "last_error"]);
}
