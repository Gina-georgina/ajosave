/**
 * Slippage Guard — Issue #222
 *
 * Provides a quote-lock mechanism for NGN→USDC conversions.
 * A rate is "locked" for QUOTE_TTL_SECONDS at initiation time.
 * At settlement, if the live rate deviates more than SLIPPAGE_THRESHOLD_PCT
 * from the quoted rate, the transaction is aborted and the event is logged.
 */

import { getRedis } from "@/lib/redis";
import { getFiatPerUsdc } from "@/lib/fx";
import logger from "@/lib/logger";

/** Slippage threshold as a percentage (default 2 %). Overridable via env. */
const SLIPPAGE_THRESHOLD_PCT = parseFloat(
  process.env.FX_SLIPPAGE_THRESHOLD_PCT ?? "2"
);

/** How long (seconds) a quoted rate remains valid. */
const QUOTE_TTL_SECONDS = parseInt(
  process.env.FX_QUOTE_TTL_SECONDS ?? "60",
  10
);

const QUOTE_KEY_PREFIX = "fx:quote:";

export interface FxQuote {
  /** Unique reference tied to a single payment initiation. */
  reference: string;
  currency: string;
  /** Rate captured at initiation time (fiat units per 1 USDC). */
  quotedRate: number;
  /** Unix timestamp (ms) when this quote was created. */
  createdAt: number;
  /** Unix timestamp (ms) after which the quote expires. */
  expiresAt: number;
}

export class SlippageExceededError extends Error {
  public readonly quotedRate: number;
  public readonly liveRate: number;
  public readonly deviationPct: number;
  public readonly reference: string;

  constructor(opts: {
    reference: string;
    quotedRate: number;
    liveRate: number;
    deviationPct: number;
  }) {
    super(
      `Slippage guard triggered for ${opts.reference}: ` +
        `quoted=${opts.quotedRate}, live=${opts.liveRate}, ` +
        `deviation=${opts.deviationPct.toFixed(2)}% > threshold=${SLIPPAGE_THRESHOLD_PCT}%`
    );
    this.name = "SlippageExceededError";
    this.reference = opts.reference;
    this.quotedRate = opts.quotedRate;
    this.liveRate = opts.liveRate;
    this.deviationPct = opts.deviationPct;
  }
}

/**
 * Generates and stores a rate quote for a payment initiation.
 *
 * @param reference  Unique payment reference (e.g. Paystack reference).
 * @param currency   Fiat currency code (e.g. "NGN").
 * @returns          The locked FxQuote.
 */
export async function lockQuote(
  reference: string,
  currency: string
): Promise<FxQuote> {
  const redis = await getRedis();
  const quotedRate = await getFiatPerUsdc(currency);
  const now = Date.now();
  const quote: FxQuote = {
    reference,
    currency,
    quotedRate,
    createdAt: now,
    expiresAt: now + QUOTE_TTL_SECONDS * 1_000,
  };

  await redis.setEx(
    `${QUOTE_KEY_PREFIX}${reference}`,
    QUOTE_TTL_SECONDS,
    JSON.stringify(quote)
  );

  logger.info(
    { reference, currency, quotedRate, ttlSeconds: QUOTE_TTL_SECONDS },
    "[SlippageGuard] Quote locked"
  );

  return quote;
}

/**
 * Retrieves a previously locked quote.
 *
 * @returns FxQuote if still valid, or null if expired / not found.
 */
export async function getLockedQuote(
  reference: string
): Promise<FxQuote | null> {
  const redis = await getRedis();
  const raw = await redis.get(`${QUOTE_KEY_PREFIX}${reference}`);
  if (!raw) return null;
  return JSON.parse(raw) as FxQuote;
}

/**
 * Validates the live rate at settlement against the locked quote.
 * Throws SlippageExceededError if the deviation exceeds the configured threshold.
 * Aborted conversions are recorded in the application audit log.
 *
 * @param reference  Payment reference whose quote to validate.
 * @param currency   Fiat currency code (must match the locked quote).
 */
export async function assertSlippage(
  reference: string,
  currency: string
): Promise<{ quote: FxQuote; liveRate: number }> {
  const quote = await getLockedQuote(reference);

  if (!quote) {
    // Quote has expired — treat as a slippage abort to be safe.
    const expiredErr = new Error(
      `[SlippageGuard] Quote for reference ${reference} has expired or was not found.`
    );
    logger.warn({ reference, currency }, "[SlippageGuard] Quote expired or missing");
    throw expiredErr;
  }

  const liveRate = await getFiatPerUsdc(currency);
  const deviationPct =
    (Math.abs(liveRate - quote.quotedRate) / quote.quotedRate) * 100;

  if (deviationPct > SLIPPAGE_THRESHOLD_PCT) {
    // Log aborted conversion to audit trail.
    logger.warn(
      {
        reference,
        currency,
        quotedRate: quote.quotedRate,
        liveRate,
        deviationPct: deviationPct.toFixed(2),
        thresholdPct: SLIPPAGE_THRESHOLD_PCT,
        event: "SLIPPAGE_ABORT",
      },
      "[SlippageGuard] Conversion aborted — slippage threshold exceeded"
    );

    throw new SlippageExceededError({
      reference,
      quotedRate: quote.quotedRate,
      liveRate,
      deviationPct,
    });
  }

  logger.info(
    {
      reference,
      currency,
      quotedRate: quote.quotedRate,
      liveRate,
      deviationPct: deviationPct.toFixed(2),
    },
    "[SlippageGuard] Rate check passed"
  );

  return { quote, liveRate };
}
