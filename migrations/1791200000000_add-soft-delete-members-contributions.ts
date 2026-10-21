import { MigrationBuilder } from "node-pg-migrate";

/**
 * Add soft-delete support to members and contributions tables so that
 * deleting a circle can cascade deleted_at to its child rows (issue #219).
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  // members
  pgm.addColumn("members", {
    deleted_at: { type: "timestamp", default: null },
  });
  pgm.createIndex("members", "deleted_at");

  // contributions
  pgm.addColumn("contributions", {
    deleted_at: { type: "timestamp", default: null },
  });
  pgm.createIndex("contributions", "deleted_at");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("contributions", "deleted_at");
  pgm.dropColumn("contributions", "deleted_at");

  pgm.dropIndex("members", "deleted_at");
  pgm.dropColumn("members", "deleted_at");
}
