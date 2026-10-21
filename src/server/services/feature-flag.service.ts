import { createHash } from "crypto";
import { query } from "@/lib/db";

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rolloutPercent: number;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export const FLAG_KEY_PATTERN = /^[a-z0-9_.-]+$/;

/** Stable 0-99 bucket so a user keeps the same result for a given flag. */
export function rolloutBucket(key: string, userId: string): number {
  return createHash("sha256").update(`${key}:${userId}`).digest().readUInt32BE(0) % 100;
}

export function evaluateFlag(
  flag: Pick<FeatureFlag, "key" | "enabled" | "rolloutPercent"> | undefined,
  userId?: string
): boolean {
  if (!flag || !flag.enabled) return false;
  if (flag.rolloutPercent >= 100) return true;
  if (flag.rolloutPercent <= 0 || !userId) return false;
  return rolloutBucket(flag.key, userId) < flag.rolloutPercent;
}

const FLAG_SELECT = `key, enabled, rollout_percent AS "rolloutPercent", description,
  updated_by AS "updatedBy", updated_at AS "updatedAt"`;

export async function listFeatureFlags(): Promise<FeatureFlag[]> {
  const { rows } = await query<FeatureFlag>(`SELECT ${FLAG_SELECT} FROM feature_flags ORDER BY key`);
  return rows;
}

/** Fails closed: a missing flag or a database error reads as disabled. */
export async function isFeatureEnabled(key: string, userId?: string): Promise<boolean> {
  try {
    const { rows } = await query<FeatureFlag>(`SELECT ${FLAG_SELECT} FROM feature_flags WHERE key = $1`, [key]);
    return evaluateFlag(rows[0], userId);
  } catch {
    return false;
  }
}

export async function upsertFeatureFlag(
  input: { key: string; enabled: boolean; rolloutPercent: number; description?: string },
  updatedBy: string
): Promise<FeatureFlag> {
  if (!FLAG_KEY_PATTERN.test(input.key)) throw new Error("Invalid flag key");
  if (!Number.isInteger(input.rolloutPercent) || input.rolloutPercent < 0 || input.rolloutPercent > 100) {
    throw new Error("rolloutPercent must be an integer between 0 and 100");
  }
  const { rows } = await query<FeatureFlag>(
    `INSERT INTO feature_flags (key, enabled, rollout_percent, description, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (key) DO UPDATE
       SET enabled = EXCLUDED.enabled, rollout_percent = EXCLUDED.rollout_percent,
           description = COALESCE(EXCLUDED.description, feature_flags.description),
           updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING ${FLAG_SELECT}`,
    [input.key, input.enabled, input.rolloutPercent, input.description ?? null, updatedBy]
  );
  return rows[0];
}
