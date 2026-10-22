import { query } from "@/lib/db";

export const ALLOWED_LEAD_HOURS = [2, 24] as const;
export const ALLOWED_CHANNELS = ["email", "sms"] as const;

export interface ReminderPreferences {
  enabled: boolean;
  leadHours: number[];
  channels: string[];
}

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  enabled: true,
  leadHours: [24, 2],
  channels: ["email", "sms"],
};

/** Normalises to a sorted, de-duplicated list; throws on values outside the allowed set. */
export function normalizePreferences(input: ReminderPreferences): ReminderPreferences {
  const leadHours = [...new Set(input.leadHours)].sort((a, b) => b - a);
  const channels = [...new Set(input.channels)].sort();
  if (leadHours.some((h) => !(ALLOWED_LEAD_HOURS as readonly number[]).includes(h))) {
    throw new Error("leadHours must only contain 2 or 24");
  }
  if (channels.some((c) => !(ALLOWED_CHANNELS as readonly string[]).includes(c))) {
    throw new Error("channels must only contain email or sms");
  }
  if (input.enabled && (leadHours.length === 0 || channels.length === 0)) {
    throw new Error("Enabled reminders need at least one lead time and one channel");
  }
  return { enabled: input.enabled, leadHours, channels };
}

export async function getReminderPreferences(userId: string): Promise<ReminderPreferences> {
  const { rows } = await query<ReminderPreferences>(
    `SELECT enabled, lead_hours AS "leadHours", channels FROM reminder_preferences WHERE user_id = $1`,
    [userId]
  );
  return rows[0] ?? DEFAULT_REMINDER_PREFERENCES;
}

export async function saveReminderPreferences(userId: string, input: ReminderPreferences): Promise<ReminderPreferences> {
  const prefs = normalizePreferences(input);
  await query(
    `INSERT INTO reminder_preferences (user_id, enabled, lead_hours, channels, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET enabled = EXCLUDED.enabled, lead_hours = EXCLUDED.lead_hours,
           channels = EXCLUDED.channels, updated_at = NOW()`,
    [userId, prefs.enabled, prefs.leadHours, prefs.channels]
  );
  return prefs;
}
