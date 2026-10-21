import { contract, Keypair, Networks } from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import { query } from "@/lib/db";
import { enqueueEvent } from "@/lib/outbox";
import { serverConfig } from "@/server/config";
import logger from "@/lib/logger";

export interface Certificate {
  circleId: string;
  circleName: string;
  memberAddress: string;
  tokenId: string;
  cyclesCompleted: number;
  totalSavedUsdc: string;
  txHash: string;
  verificationUrl: string | null;
  issuedAt: Date;
}

const networkPassphrase =
  serverConfig.stellar.network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

/** Explorer subdomain path for the configured Stellar network. */
const explorerNetwork =
  serverConfig.stellar.network === "mainnet" ? "mainnet" : "testnet";

/**
 * Deterministic certificate identifier derived from the same two values that
 * key the on-chain record: (member Stellar address, circle UUID). Stable
 * across retries, so a re-mint never produces a different token ID.
 */
export function deriveCertificateTokenId(
  memberStellarKey: string,
  circleId: string
): string {
  return createHash("sha256")
    .update(`${memberStellarKey}:${circleId}`)
    .digest("hex");
}

/**
 * Verification URL for a minted certificate. Prefers the mint transaction
 * hash; falls back to the contract page while the hash is not yet known.
 */
export function buildVerificationUrl(txHash: string | null): string | null {
  if (txHash) {
    return `https://stellar.expert/explorer/${explorerNetwork}/tx/${txHash}`;
  }
  const contractId = serverConfig.stellar.certificateContractId;
  if (contractId) {
    return `https://stellar.expert/explorer/${explorerNetwork}/contract/${contractId}`;
  }
  return null;
}

export interface MintCertificateResult {
  /** True when the on-chain mint succeeded (or the contract already had it). */
  ok: boolean;
  txHash: string | null;
  error?: string;
}

/**
 * Mint a completion certificate on-chain via the Soroban certificate contract,
 * then persist the record to PostgreSQL for fast profile queries.
 *
 * Idempotent: the contract ignores duplicate mints; the DB upsert only fills
 * in `tx_hash` when it is still NULL, so retries never duplicate a row or
 * clobber an earlier successful mint.
 *
 * Failures are reported in the result (never thrown) so callers — including
 * the outbox processor, which retries on `ok: false` — decide how to react.
 */
export async function mintCertificate(params: {
  memberStellarKey: string;
  circleId: string;
  circleName: string;
  cyclesCompleted: number;
  totalSavedUsdc: string;
}): Promise<MintCertificateResult> {
  const contractId = serverConfig.stellar.certificateContractId;
  if (!contractId) {
    logger.warn("STELLAR_CERTIFICATE_CONTRACT_ID not set — skipping certificate mint");
    return { ok: true, txHash: null };
  }

  const keypair = Keypair.fromSecret(serverConfig.stellar.serverSecretKey);
  const signer = contract.basicNodeSigner(keypair, networkPassphrase);

  const client = await contract.Client.from({
    contractId,
    networkPassphrase,
    rpcUrl: serverConfig.stellar.sorobanRpcUrl,
    publicKey: keypair.publicKey(),
    ...signer,
  });

  // circle_id on-chain is BytesN<32> — pad/hash the UUID to 32 bytes
  const circleIdBytes = Buffer.alloc(32);
  Buffer.from(params.circleId.replace(/-/g, ""), "hex").copy(circleIdBytes);

  // total_saved_usdc in stroops (multiply by 10^7)
  const totalSavedStroops = BigInt(
    Math.round(parseFloat(params.totalSavedUsdc) * 10_000_000)
  );

  const tokenId = deriveCertificateTokenId(params.memberStellarKey, params.circleId);

  let txHash = "";
  let mintOk = true;
  let mintError: string | undefined;
  try {
    // @ts-expect-error — method generated from contract ABI at runtime
    const assembled = await client.mint({
      member: params.memberStellarKey,
      circle_id: circleIdBytes,
      circle_name: params.circleName,
      cycles_completed: params.cyclesCompleted,
      total_saved_usdc: totalSavedStroops,
    });
    const sent = await assembled.send();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    txHash = (sent as any).hash ?? (sent as any).sendTransactionResponse?.hash ?? "";
    logger.info({ txHash, ...params }, "certificate minted on-chain");
  } catch (err) {
    mintOk = false;
    mintError = err instanceof Error ? err.message : String(err);
    logger.error({ err, ...params }, "certificate mint failed — persisting DB record only");
  }

  // Persist to DB regardless of on-chain result (allows retry / display without RPC).
  // DO UPDATE only fills tx_hash when it is still NULL so an outbox retry after
  // a chain failure completes the record without touching a good hash.
  await query(
    `INSERT INTO certificates
       (circle_id, circle_name, member_stellar_key, token_id,
        cycles_completed, total_saved_usdc, tx_hash, issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (circle_id, member_stellar_key)
       DO UPDATE SET tx_hash = EXCLUDED.tx_hash
       WHERE certificates.tx_hash IS NULL`,
    [
      params.circleId,
      params.circleName,
      params.memberStellarKey,
      tokenId,
      params.cyclesCompleted,
      params.totalSavedUsdc,
      txHash || null,
    ]
  );

  return mintOk ? { ok: true, txHash: txHash || null } : { ok: false, txHash: null, error: mintError };
}

/**
 * Enqueue certificate mints for every member of a circle that just completed.
 *
 * Called from the completion paths (final payout, on-chain event index). Each
 * member gets an outbox event so a failed on-chain mint is logged and retried
 * by the outbox processor instead of being lost. Never throws — certificate
 * delivery must not break circle completion.
 */
export async function queueCertificatesForCircle(circleId: string): Promise<void> {
  try {
    const circleRes = await query<{ name: string; contribution_usdc: string }>(
      `SELECT name, contribution_usdc FROM circles WHERE id = $1`,
      [circleId]
    );
    if (circleRes.rowCount === 0) return;
    const circleName = circleRes.rows[0].name;
    const contributionUsdc = parseFloat(circleRes.rows[0].contribution_usdc);

    const memberRes = await query<{ stellar_public_key: string | null }>(
      `SELECT u.stellar_public_key
         FROM members m
         JOIN users u ON u.id = m.user_id
        WHERE m.circle_id = $1
        ORDER BY m.position`,
      [circleId]
    );

    // One full cycle per member — the circle completed every cycle.
    const cyclesCompleted = memberRes.rowCount ?? 0;
    if (cyclesCompleted === 0) return;
    const totalSavedUsdc = (contributionUsdc * cyclesCompleted).toFixed(7);

    // Skip members who already hold a certificate for this circle.
    const issuedRes = await query<{ member_stellar_key: string }>(
      `SELECT member_stellar_key FROM certificates WHERE circle_id = $1`,
      [circleId]
    );
    const alreadyIssued = new Set(issuedRes.rows.map((r) => r.member_stellar_key));

    let queued = 0;
    let skippedNoKey = 0;
    for (const row of memberRes.rows) {
      const key = row.stellar_public_key;
      if (!key) {
        skippedNoKey += 1;
        continue;
      }
      if (alreadyIssued.has(key)) continue;

      await enqueueEvent("circle", circleId, "certificate.mint", {
        circleId,
        memberStellarKey: key,
        circleName,
        cyclesCompleted,
        totalSavedUsdc,
      });
      queued += 1;
    }

    logger.info(
      { circleId, queued, skippedNoKey, alreadyIssued: alreadyIssued.size },
      "queued certificate mints for completed circle"
    );
  } catch (err) {
    logger.error({ err, circleId }, "failed to queue certificate mints");
  }
}

/**
 * Fetch all certificates for a user by their Stellar public key.
 */
export async function getCertificatesByUser(stellarPublicKey: string): Promise<Certificate[]> {
  const { rows } = await query<{
    circle_id: string;
    circle_name: string;
    member_stellar_key: string;
    token_id: string;
    cycles_completed: number;
    total_saved_usdc: string;
    tx_hash: string | null;
    issued_at: Date;
  }>(
    `SELECT circle_id, circle_name, member_stellar_key, token_id,
            cycles_completed, total_saved_usdc, tx_hash, issued_at
     FROM certificates
     WHERE member_stellar_key = $1
     ORDER BY issued_at DESC`,
    [stellarPublicKey]
  );

  return rows.map((r) => ({
    circleId: r.circle_id,
    circleName: r.circle_name,
    memberAddress: r.member_stellar_key,
    tokenId: r.token_id,
    cyclesCompleted: r.cycles_completed,
    totalSavedUsdc: r.total_saved_usdc,
    txHash: r.tx_hash ?? "",
    verificationUrl: buildVerificationUrl(r.tx_hash),
    issuedAt: r.issued_at,
  }));
}
