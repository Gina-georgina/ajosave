import { MigrationBuilder } from "node-pg-migrate";

/**
 * Add emoji reactions and threaded replies to circle chat (issue #211).
 *
 * - message_reactions: one row per (message, user, emoji) — unique constraint
 *   prevents a user from reacting twice with the same emoji.
 * - circle_messages: add parent_message_id FK (NULL = top-level message,
 *   non-NULL = a reply in the thread of the parent).
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  // ── Thread replies: add parent_message_id to circle_messages ─────────────
  pgm.addColumn("circle_messages", {
    parent_message_id: {
      type: "uuid",
      references: "circle_messages(id)",
      referencesConstraintName: "fk_parent_message",
      onDelete: "CASCADE",
      default: null,
    },
  });
  pgm.createIndex("circle_messages", "parent_message_id");

  // ── Emoji reactions table ─────────────────────────────────────────────────
  pgm.createTable("message_reactions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    message_id: {
      type: "uuid",
      notNull: true,
      references: "circle_messages(id)",
      referencesConstraintName: "fk_reaction_message",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      referencesConstraintName: "fk_reaction_user",
      onDelete: "CASCADE",
    },
    emoji: { type: "varchar(8)", notNull: true },
    created_at: { type: "timestamp", notNull: true, default: pgm.func("NOW()") },
  });

  // Prevent duplicate reactions: one emoji per (message, user)
  pgm.addConstraint("message_reactions", "uq_reaction_per_user", {
    unique: ["message_id", "user_id", "emoji"],
  });

  pgm.createIndex("message_reactions", "message_id");
  pgm.createIndex("message_reactions", "user_id");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("message_reactions");
  pgm.dropIndex("circle_messages", "parent_message_id");
  pgm.dropColumn("circle_messages", "parent_message_id");
}
