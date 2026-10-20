import { z } from "zod";

// ─── Circle size / contribution bounds (Issue #226) ──────────────────────────
// All limits are configurable via environment variables so they can be adjusted
// without a code deploy. Defaults match the acceptance criteria in Issue #226.

/** Minimum number of circle members (hard floor). */
const MIN_MEMBERS = 2;

/** Maximum number of circle members — configurable, default 50 (Issue #226). */
function getMaxMembers(): number {
  const v = parseInt(process.env.CIRCLE_MAX_MEMBERS ?? "50", 10);
  return Number.isFinite(v) && v >= MIN_MEMBERS ? v : 50;
}

/** Minimum contribution amount in the circle's currency (default 1 USDC / 1 unit). */
const MIN_CONTRIBUTION_AMOUNT = 1;

/** Maximum contribution amount — configurable, default 10,000 (Issue #226, in USDC or fiat units). */
function getMaxContributionAmount(): number {
  const v = parseFloat(process.env.CIRCLE_MAX_CONTRIBUTION ?? "10000");
  return Number.isFinite(v) && v > 0 ? v : 10_000;
}

// Smart-contract cycle interval bounds (from contracts/ajo/src/lib.rs):
//   MIN_CYCLE_INTERVAL_SECS = 1
//   MAX_CYCLE_INTERVAL_SECS = 365 * 24 * 60 * 60
// The API uses named frequencies which map to fixed intervals:
//   weekly    = 604_800 s   (7 * 24 * 60 * 60)
//   biweekly  = 1_209_600 s (14 * 24 * 60 * 60)
//   monthly   = 2_592_000 s (30 * 24 * 60 * 60)
// All three are within [1, 31_536_000] so the enum is already contract-safe.
const CYCLE_FREQUENCY_CONTRACT_SECS: Record<string, number> = {
  weekly: 604_800,
  biweekly: 1_209_600,
  monthly: 2_592_000,
};
export const MIN_CYCLE_INTERVAL_SECS = 1;            // from contract
export const MAX_CYCLE_INTERVAL_SECS = 31_536_000;   // 365 days, from contract

/**
 * Build the createCircleSchema with runtime-configurable bounds.
 *
 * Called once at module-load time; the env vars are read at that point.
 * In test environments override CIRCLE_MAX_MEMBERS / CIRCLE_MAX_CONTRIBUTION
 * before importing this module.
 */
function buildCreateCircleSchema() {
  const maxMembers = getMaxMembers();
  const maxContrib = getMaxContributionAmount();

  return z.object({
    name: z.string().min(3, "Circle name must be at least 3 characters").max(60),
    contributionAmount: z
      .number()
      .min(
        MIN_CONTRIBUTION_AMOUNT,
        `Minimum contribution is ${MIN_CONTRIBUTION_AMOUNT} unit`
      )
      .max(
        maxContrib,
        `Maximum contribution is ${maxContrib.toLocaleString()} units`
      ),
    contributionCurrency: z.enum(["NGN", "GBP", "USD", "EUR"], {
      errorMap: () => ({ message: "Currency must be NGN, GBP, USD, or EUR" }),
    }),
    maxMembers: z
      .number()
      .int()
      .min(MIN_MEMBERS, `Minimum ${MIN_MEMBERS} members`)
      .max(maxMembers, `Maximum ${maxMembers} members`),
    cycleFrequency: z.enum(["weekly", "biweekly", "monthly"]).refine(
      (f) => {
        const secs = CYCLE_FREQUENCY_CONTRACT_SECS[f];
        return secs !== undefined && secs >= MIN_CYCLE_INTERVAL_SECS && secs <= MAX_CYCLE_INTERVAL_SECS;
      },
      {
        message: `cycleFrequency maps to an interval outside smart-contract bounds [${MIN_CYCLE_INTERVAL_SECS}, ${MAX_CYCLE_INTERVAL_SECS}] seconds`,
      }
    ),
    circleType: z.enum(["public", "private"]).default("public"),
    gracePeriodHours: z.number().int().min(0).max(168).default(24),
    payoutMethod: z.enum(["fixed", "randomized"]).default("fixed"),
    yieldStrategy: z.enum(["none", "blend"]).default("none"),
    penaltyPercent: z.number().int().min(0).max(100).default(10),
  });
}

export const createCircleSchema = buildCreateCircleSchema();

export const joinCircleSchema = z.object({
  circleId: z.string().uuid(),
  stellarPublicKey: z.string().length(56, "Invalid Stellar public key"),
  token: z.string().optional(),
});

export const verifyOtpSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{9,14}$/),
  otp: z.string().length(6),
});

export const sendOtpSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{9,14}$/, "Invalid phone number"),
});

export const smsPreferencesSchema = z.object({
  enabled: z.boolean({ invalid_type_error: "enabled must be a boolean" }),
});

export type CreateCircleInput = z.infer<typeof createCircleSchema>;
export type JoinCircleInput = z.infer<typeof joinCircleSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type SendOtpInput = z.infer<typeof sendOtpSchema>;
export type SmsPreferencesInput = z.infer<typeof smsPreferencesSchema>;
