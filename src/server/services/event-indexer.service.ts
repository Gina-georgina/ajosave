/**
 * Soroban contract event indexer — Issue #132
 *
 * Polls the Soroban RPC every POLL_INTERVAL_MS, stores new events in
 * contract_events (deduped by tx_hash+topic), and reacts to each topic:
 *
 *   contribution_made  → confirm matching pending contribution
 *   payout_sent        → record payout + mark member as received
 *   member_defaulted   → mark member status = 'defaulted'
 *   circle_completed   → mark circle status = 'completed' + queue certificates
 *   member_joined      → stored for audit; no extra DB side-effect needed
 *
 * Checkpoint: last_indexed_ledger stored in indexer_state per contract.
 */

import { getContractEvents, type ContractEvent } from "@/lib/soroban";
import { serverConfig } from "@/server/config";
import { query } from "@/lib/db";
import { randomUUID } from "crypto";
import { incrementReputationOnContribution } from "./reputation.service";
import { queueCertificatesForCircle } from "./certificate.service";

const POLL_INTERVAL_MS = parseInt(process.env.EVENT_INDEXER_POLL_MS ?? "15000", 10);
const CONTRACT_ID = serverConfig.stellar.ajoContractId;

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

// ── Public control API ────────────────────────────────────────────────────────

export function startEventIndexer(): void {
  if (running || !CONTRACT_ID) {
    if (!CONTRACT_ID) console.warn("[event-indexer] No contract ID configured, skipping");
    return;
  }
  running = true;
  console.log(`[event-indexer] Starting (contract: ${CONTRACT_ID}, interval: ${POLL_INTERVAL_MS}ms)`);
  scheduleNext();
}

export function stopEventIndexer(): void {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  running = false;
  console.log("[event-indexer] Stopped");
}

export function getIndexerStatus(): { running: boolean; contractId: string } {
  return { running, contractId: CONTRACT_ID };
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

function scheduleNext(): void {
  pollTimer = setTimeout(async () => {
    try { await pollOnce(); } catch (err) {
      console.error("[event-indexer] Poll error:", err);
    }
    if (running) scheduleNext();
  }, POLL_INTERVAL_MS);
}

export async function pollOnce(): Promise<number> {
  const startLedger = await getLastIndexedLedger(CONTRACT_ID);
  const events = await getContractEvents(CONTRACT_ID, startLedger || undefined);
  if (events.length === 0) return 0;

  let processed = 0;
  let maxLedger = startLedger;

  for (const event of events) {
    const stored = await storeEvent(event);
    if (stored) {
      await reactToEvent(event);
      processed++;
    }
    if (event.ledger > maxLedger) maxLedger = event.ledger;
  }

  if (maxLedger > startLedger) await saveCheckpoint(CONTRACT_ID, maxLedger);
  if (processed > 0) console.log(`[event-indexer] Processed ${processed} new event(s) up to ledger ${maxLedger}`);
  return processed;
}

// ── Storage + dedup ───────────────────────────────────────────────────────────

async function storeEvent(event: ContractEvent): Promise<boolean> {
  const topic = event.topic?.[0] ?? "unknown";
  const { rowCount } = await query(
    `INSERT INTO contract_events
       (id, contract_id, tx_hash, topic, payload, ledger, ledger_timestamp, processed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false)
     ON CONFLICT (tx_hash, topic) DO NOTHING`,
    [
      randomUUID(),
      CONTRACT_ID,
      event.transactionHash,
      topic,
      JSON.stringify(event.value ?? {}),
      event.ledger,
      event.timestamp ? new Date(event.timestamp * 1000) : null,
    ]
  );
  return (rowCount ?? 0) > 0;
}

async function markProcessed(txHash: string, topic: string): Promise<void> {
  await query(
    "UPDATE contract_events SET processed = true WHERE tx_hash = $1 AND topic = $2",
    [txHash, topic]
  );
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

async function getLastIndexedLedger(contractId: string): Promise<number> {
  const { rows } = await query<{ last_indexed_ledger: number }>(
    "SELECT last_indexed_ledger FROM indexer_state WHERE contract_id = $1",
    [contractId]
  );
  return rows[0]?.last_indexed_ledger ?? 0;
}

async function saveCheckpoint(contractId: string, ledger: number): Promise<void> {
  await query(
    `INSERT INTO indexer_state (contract_id, last_indexed_ledger, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (contract_id) DO UPDATE
       SET last_indexed_ledger = EXCLUDED.last_indexed_ledger, updated_at = NOW()`,
    [contractId, ledger]
  );
}

// ── Event reactions ───────────────────────────────────────────────────────────

async function reactToEvent(event: ContractEvent): Promise<void> {
  const topic = event.topic?.[0];
  const txHash = event.transactionHash;
  const val = event.value ?? {};

  try {
    switch (topic) {
      case "contribution_made":
        await onContributionMade(val, txHash);
        break;
      case "payout_sent":
        await onPayoutSent(val, txHash);
        break;
      case "member_defaulted":
        await onMemberDefaulted(val);
        break;
      case "circle_completed":
        await onCircleCompleted(val);
        break;
      // member_joined — stored for audit; no extra action needed
    }
    await markProcessed(txHash, topic ?? "unknown");
  } catch (err) {
    console.error(`[event-indexer] Handler failed for topic=${topic} tx=${txHash}:`, err);
    // Leave processed=false so it can be retried
  }
}

/** Confirm the pending contribution that corresponds to this on-chain event. */
async function onContributionMade(val: any, txHash: string): Promise<void> {
  // val expected: { circle_id, member_address, amount, cycle }
  const { rows } = await query<{ id: string; user_id: string }>(
    `UPDATE contributions c
     SET status = 'confirmed', tx_hash = $1
     FROM members m
     WHERE c.member_id = m.id
       AND c.status = 'pending'
       AND (c.tx_hash = $1 OR (
             m.circle_id = $2
             AND c.cycle_number = $3
             AND c.amount_usdc = $4
           ))
     RETURNING c.id, m.user_id`,
    [txHash, val.circle_id ?? null, val.cycle ?? null, val.amount?.toString() ?? null]
  );
  for (const row of rows) {
    await incrementReputationOnContribution(row.user_id);
    console.log(`[event-indexer] contribution_made → confirmed contribution ${row.id}`);
  }
}

/** Record the payout and mark the recipient as having received it. */
async function onPayoutSent(val: any, txHash: string): Promise<void> {
  // val expected: { circle_id, recipient_address, amount, cycle }
  if (!val.circle_id || !val.cycle) return;

  const { rows: members } = await query<{ id: string }>(
    `SELECT m.id FROM members m
     JOIN users u ON u.id = m.user_id
     WHERE m.circle_id = $1
       AND u.stellar_public_key = $2`,
    [val.circle_id, val.recipient_address ?? null]
  );
  if (!members[0]) return;

  const memberId = members[0].id;

  await query(
    `INSERT INTO payouts (id, circle_id, recipient_member_id, cycle_number, amount_usdc, tx_hash, paid_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (tx_hash) DO NOTHING`,
    [randomUUID(), val.circle_id, memberId, val.cycle, val.amount?.toString() ?? "0", txHash]
  );

  await query(
    "UPDATE members SET has_received_payout = true WHERE id = $1",
    [memberId]
  );

  console.log(`[event-indexer] payout_sent → recorded payout for member ${memberId}`);
}

/** Mark the member as defaulted. */
async function onMemberDefaulted(val: any): Promise<void> {
  if (!val.circle_id || !val.member_address) return;
  await query(
    `UPDATE members m
     SET status = 'defaulted'
     FROM users u
     WHERE m.user_id = u.id
       AND m.circle_id = $1
       AND u.stellar_public_key = $2`,
    [val.circle_id, val.member_address]
  );
  console.log(`[event-indexer] member_defaulted → marked defaulted (circle: ${val.circle_id})`);
}

/** Mark the circle as completed. */
async function onCircleCompleted(val: any): Promise<void> {
  if (!val.circle_id) return;
  await query(
    "UPDATE circles SET status = 'completed', updated_at = NOW() WHERE id = $1 AND status != 'completed'",
    [val.circle_id]
  );
  // Queue on-chain completion certificates for every member (#241).
  await queueCertificatesForCircle(val.circle_id);
  console.log(`[event-indexer] circle_completed → circle ${val.circle_id} marked completed`);
}
