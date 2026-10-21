import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("reminder_preferences", {
    user_id: { type: "uuid", primaryKey: true, references: "users(id)", onDelete: "CASCADE" },
    enabled: { type: "boolean", notNull: true, default: true },
    lead_hours: {
      type: "integer[]",
      notNull: true,
      default: pgm.func("ARRAY[24, 2]"),
      check: "lead_hours <@ ARRAY[2, 24]",
    },
    channels: {
      type: "text[]",
      notNull: true,
      default: pgm.func("ARRAY['email', 'sms']"),
      check: "channels <@ ARRAY['email', 'sms']",
    },
    updated_at: { type: "timestamp", notNull: true, default: pgm.func("NOW()") },
  });

  pgm.createTable("feature_flags", {
    key: { type: "varchar(100)", primaryKey: true, check: "key ~ '^[a-z0-9_.-]+$'" },
    enabled: { type: "boolean", notNull: true, default: false },
    rollout_percent: { type: "integer", notNull: true, default: 100, check: "rollout_percent BETWEEN 0 AND 100" },
    description: { type: "text" },
    updated_by: { type: "varchar(255)" },
    updated_at: { type: "timestamp", notNull: true, default: pgm.func("NOW()") },
  });

  pgm.createTable("analytics_consents", {
    user_id: { type: "uuid", notNull: true, references: "users(id)", onDelete: "CASCADE" },
    category: {
      type: "varchar(20)",
      notNull: true,
      check: "category IN ('essential', 'performance', 'marketing')",
    },
    granted: { type: "boolean", notNull: true },
    updated_at: { type: "timestamp", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.addConstraint("analytics_consents", "analytics_consents_pk", "PRIMARY KEY (user_id, category)");
  pgm.addConstraint("analytics_consents", "essential_always_granted", "CHECK (category <> 'essential' OR granted)");

  pgm.createTable("dispute_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    dispute_id: { type: "uuid", notNull: true, references: "disputes(id)", onDelete: "CASCADE" },
    event_type: {
      type: "varchar(30)",
      notNull: true,
      check: "event_type IN ('created', 'evidence_added', 'status_changed', 'resolved')",
    },
    actor_id: { type: "varchar(255)" },
    detail: { type: "text" },
    created_at: { type: "timestamp", notNull: true, default: pgm.func("NOW()") },
  });
  pgm.createIndex("dispute_events", ["dispute_id", "created_at"], { name: "idx_dispute_events_timeline" });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("dispute_events");
  pgm.dropTable("analytics_consents");
  pgm.dropTable("feature_flags");
  pgm.dropTable("reminder_preferences");
}
