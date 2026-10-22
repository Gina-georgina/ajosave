import { MigrationBuilder } from "node-pg-migrate";

/**
 * Migration: add support_tickets table (#123 — Support Intake)
 *
 * Stores user-submitted support requests.
 *
 * Indexes:
 *   idx_support_tickets_user_id — list tickets per user efficiently
 *   idx_support_tickets_status  — allow admin dashboards to filter by status
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("support_tickets", {
    id: { type: "uuid", primaryKey: true },
    user_id: { type: "uuid", notNull: true, references: "users.id", onDelete: "CASCADE" },
    category: { type: "varchar(50)", notNull: true },
    subject: { type: "varchar(200)", notNull: true },
    description: { type: "text", notNull: true },
    status: { type: "varchar(20)", notNull: true, default: "'open'" },
    circle_id: { type: "uuid", references: "circles.id", onDelete: "SET NULL" },
    created_at: { type: "timestamp", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "timestamp", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("support_tickets", "user_id", { name: "idx_support_tickets_user_id" });
  pgm.createIndex("support_tickets", "status", { name: "idx_support_tickets_status" });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("support_tickets");
}
