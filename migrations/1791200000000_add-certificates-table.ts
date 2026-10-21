import { MigrationBuilder } from "node-pg-migrate";

/**
 * Issue #241: Add certificates table for on-chain completion certificates.
 *
 * One row per (circle, member) — matching the idempotent key used by the
 * `contracts/certificate` Soroban contract (DataKey::Cert(member, circle_id)).
 * `tx_hash` is NULL until the on-chain mint succeeds, which lets the outbox
 * retry fill it in without creating a duplicate row.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    "certificates",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      circle_id: { type: "varchar(255)", notNull: true },
      circle_name: { type: "varchar(255)", notNull: true },
      member_stellar_key: { type: "varchar(56)", notNull: true },
      token_id: { type: "varchar(64)", notNull: true },
      cycles_completed: { type: "integer", notNull: true },
      total_saved_usdc: { type: "numeric(20,7)", notNull: true },
      tx_hash: { type: "varchar(64)" },
      issued_at: { type: "timestamp", notNull: true, default: pgm.func("NOW()") },
    },
    { ifNotExists: true }
  );

  // Single-use contract key: the contract itself treats (member, circle_id)
  // as idempotent, and the upsert relies on this uniqueness.
  pgm.addConstraint("certificates", "certificates_circle_member_unique", {
    unique: ["circle_id", "member_stellar_key"],
  });

  // GET /api/v1/users/me/certificates looks certificates up by member key.
  pgm.createIndex("certificates", ["member_stellar_key"], {
    name: "idx_certificates_member_key",
    ifNotExists: true,
  });

  // Retention / admin queries ordered by issue time.
  pgm.createIndex("certificates", ["issued_at"], {
    name: "idx_certificates_issued_at",
    ifNotExists: true,
  });

  pgm.sql(`
    COMMENT ON TABLE certificates IS
      'On-chain completion certificates minted via contracts/certificate (#241)';
    COMMENT ON COLUMN certificates.token_id IS
      'Deterministic certificate identifier derived from (member_stellar_key, circle_id)';
    COMMENT ON COLUMN certificates.tx_hash IS
      'On-chain mint transaction hash — NULL until the mint succeeds';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("certificates", { ifExists: true });
}
