import { query } from "@/lib/db";

/**
 * Consent taxonomy:
 *  - essential:   required for the service to operate (auth, payments, fraud); always granted.
 *  - performance: aggregate usage and error analytics.
 *  - marketing:   campaign attribution and referral analytics.
 * Non-essential categories default to NOT granted until the user opts in.
 */
export const CONSENT_CATEGORIES = ["essential", "performance", "marketing"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
export type ConsentState = Record<ConsentCategory, boolean>;

export const DEFAULT_CONSENT: ConsentState = { essential: true, performance: false, marketing: false };

/** Merges stored rows over the defaults; `essential` can never be revoked. */
export function resolveConsent(rows: { category: string; granted: boolean }[]): ConsentState {
  const state: ConsentState = { ...DEFAULT_CONSENT };
  for (const row of rows) {
    if ((CONSENT_CATEGORIES as readonly string[]).includes(row.category)) {
      state[row.category as ConsentCategory] = row.granted;
    }
  }
  state.essential = true;
  return state;
}

export async function getConsent(userId: string): Promise<ConsentState> {
  const { rows } = await query<{ category: string; granted: boolean }>(
    `SELECT category, granted FROM analytics_consents WHERE user_id = $1`,
    [userId]
  );
  return resolveConsent(rows);
}

export async function hasConsent(userId: string, category: ConsentCategory): Promise<boolean> {
  return (await getConsent(userId))[category];
}

export async function setConsent(userId: string, updates: Partial<Record<ConsentCategory, boolean>>): Promise<ConsentState> {
  if (updates.essential === false) throw new Error("Essential consent cannot be revoked");
  for (const category of CONSENT_CATEGORIES) {
    const granted = updates[category];
    if (category === "essential" || granted === undefined) continue;
    await query(
      `INSERT INTO analytics_consents (user_id, category, granted, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, category) DO UPDATE SET granted = EXCLUDED.granted, updated_at = NOW()`,
      [userId, category, granted]
    );
  }
  return getConsent(userId);
}
