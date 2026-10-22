/**
 * Payout Randomisation Seeding Service
 *
 * Sources entropy from verifiable on-chain Stellar ledger hashes via Horizon
 * for initial payout order randomisation. The seed is stored in the DB and
 * included in the contract initialize call for on-chain verification.
 *
 * Issue: #232
 */

import { query } from "@/lib/db";
import logger from "@/lib/logger";

interface HorizonLedgerResponse {
  hash: string;
  sequence: number;
  closed_at: string;
}

const HORIZON_URL = process.env.STELLAR_HORIZON_URL ?? "https://horizon.stellar.org";

/**
 * Fetch the most recent closed ledger hash from Horizon.
 * Returns the ledger hash and sequence number.
 */
export async function fetchLatestLedgerHash(): Promise<{
  ledgerHash: string;
  ledgerSequence: number;
}> {
  try {
    const response = await fetch(`${HORIZON_URL}/ledgers?order=desc&limit=1`);
    if (!response.ok) {
      throw new Error(`Horizon returned ${response.status}`);
    }
    const data = await response.json();
    const ledger: HorizonLedgerResponse = data._embedded.records[0];

    if (!ledger.hash) {
      throw new Error("No ledger hash returned from Horizon");
    }

    logger.info(
      { ledgerHash: ledger.hash, ledgerSequence: ledger.sequence },
      "[payout-randomization] Fetched ledger hash from Horizon"
    );

    return {
      ledgerHash: ledger.hash,
      ledgerSequence: ledger.sequence,
    };
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      "[payout-randomization] Failed to fetch ledger hash from Horizon"
    );
    throw err;
  }
}

/**
 * Store the ledger hash as the randomization seed for a circle.
 */
export async function storeRandomizationSeed(
  circleId: string,
  ledgerHash: string,
  ledgerSequence: number
): Promise<void> {
  await query(
    `UPDATE circles
       SET randomization_seed = $1,
           payout_method = 'randomized'
     WHERE id = $2`,
    [ledgerHash, circleId]
  );

  logger.info(
    { circleId, ledgerHash, ledgerSequence },
    "[payout-randomization] Stored randomization seed for circle"
  );
}

/**
 * Get the stored randomization seed for a circle.
 */
export async function getRandomizationSeed(circleId: string): Promise<{ ledgerHash: string | null; ledgerSequence: number | null }> {
  const { rows } = await query<{ randomization_seed: string | null }>(
    `SELECT randomization_seed FROM circles WHERE id = $1`,
    [circleId]
  );
  return {
    ledgerHash: rows[0]?.randomization_seed ?? null,
    ledgerSequence: null,
  };
}

/**
 * Shuffle payout order using the stored seed as entropy.
 * The shuffle is deterministic: identical seeds produce identical orders.
 *
 * Uses Fisher-Yates shuffle seeded by the ledger hash.
 */
export function shufflePayoutOrder<T>(
  items: T[],
  seed: string
): T[] {
  const shuffled = [...items];
  // Simple deterministic hash-based seed
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Fisher-Yates shuffle using the hash-derived seed
  for (let i = shuffled.length - 1; i > 0; i--) {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    const j = hash % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Verify that a given seed matches the stored randomization seed for a circle.
 * Used for on-chain verification in the contract initialize call.
 */
export async function verifyRandomizationSeed(
  circleId: string,
  providedSeed: string
): Promise<boolean> {
  const { ledgerHash } = await getRandomizationSeed(circleId);
  return ledgerHash === providedSeed;
}
