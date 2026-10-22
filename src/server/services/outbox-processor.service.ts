/**
 * Outbox Processor Service
 *
 * Polls the `outbox_events` table for pending events and dispatches each one
 * to the appropriate handler (SMS, email, webhook, …).
 *
 * Designed to be called by the cron endpoint at
 * POST /api/v1/cron/process-outbox
 *
 * Processing guarantees:
 *   - Each event is locked with FOR UPDATE SKIP LOCKED, so multiple concurrent
 *     invocations of processOutboxEvents() will each claim a disjoint set.
 *   - On success  → status transitions to 'delivered'.
 *   - On failure  → attempts++ / last_error stored; once maxAttempts is
 *                    exceeded the event moves to 'dead' (dead-letter).
 *   - Transient failures are not thrown — they are logged and the event will
 *     be retried on the next poll cycle.
 */

import logger from "@/lib/logger";
import {
  getPendingEvents,
  markEventProcessed,
  markEventFailed,
  requeueEvent,
  getDeadLetterCount,
  type OutboxEvent,
} from "@/lib/outbox";
import { getRedis } from "@/lib/redis";
import { notifyPayoutProcessed, notifyPayoutReminder, notifyContributionReminder, notifyMissedContribution } from "@/server/services/notification.service";
import { mintCertificate } from "@/server/services/certificate.service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessOutboxResult {
  /** How many events were attempted in this run. */
  processed: number;
  /** How many events were delivered successfully. */
  succeeded: number;
  /** How many events failed delivery (will be retried or moved to dead). */
  failed: number;
}

// ---------------------------------------------------------------------------
// Event handler dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a single outbox event to the correct handler.
 * Throws on unrecoverable errors; the caller catches and calls markEventFailed.
 */
async function dispatchEvent(event: OutboxEvent): Promise<void> {
  const { aggregate_type, event_type, payload } = event;

  switch (event_type) {
    // ── Payout events ────────────────────────────────────────────────────────
    case "payout.processed": {
      const { memberUserIds, circleName, amount, recipientName } = payload as {
        memberUserIds: string[];
        circleName: string;
        amount: string;
        recipientName: string;
      };
      await notifyPayoutProcessed(memberUserIds, circleName, amount, recipientName);
      break;
    }

    case "payout.reminder": {
      const { userId, circleName, amount, hoursUntilPayout } = payload as {
        userId: string;
        circleName: string;
        amount: string;
        hoursUntilPayout: number;
      };
      await notifyPayoutReminder(userId, circleName, amount, hoursUntilPayout);
      break;
    }

    // ── Contribution events ──────────────────────────────────────────────────
    case "contribution.reminder": {
      const { userId, circleName, amount, hoursLeft } = payload as {
        userId: string;
        circleName: string;
        amount: string;
        hoursLeft: number;
      };
      await notifyContributionReminder(userId, circleName, amount, hoursLeft);
      break;
    }

    case "contribution.missed": {
      const { userId, circleName, amount } = payload as {
        userId: string;
        circleName: string;
        amount: string;
      };
      await notifyMissedContribution(userId, circleName, amount);
      break;
    }

    // ── Certificate events ──────────────────────────────────────────────────
    case "certificate.mint": {
      const { circleId, memberStellarKey, circleName, cyclesCompleted, totalSavedUsdc } =
        payload as {
          circleId: string;
          memberStellarKey: string;
          circleName: string;
          cyclesCompleted: number;
          totalSavedUsdc: string;
        };

      if (!circleId || !memberStellarKey || !circleName) {
        throw new Error(
          `certificate.mint payload missing required fields (circleId=${circleId}, memberStellarKey=${memberStellarKey})`
        );
      }

      const result = await mintCertificate({
        memberStellarKey,
        circleId,
        circleName,
        cyclesCompleted: Number(cyclesCompleted),
        totalSavedUsdc: String(totalSavedUsdc),
      });

      // Throw so the event is retried on the next poll instead of being lost.
      if (!result.ok) {
        throw new Error(`certificate mint failed for circle ${circleId}: ${result.error}`);
      }
      break;
    }

    // ── Unknown event — log and skip (do not retry indefinitely) ────────────
    default: {
      logger.warn(
        { aggregate_type, event_type, eventId: event.id },
        "[outbox-processor] Unknown event type — marking as delivered to avoid infinite retry"
      );
      // Intentionally treated as success to avoid dead-letter flooding.
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BATCH_LIMIT = parseInt(process.env.OUTBOX_BATCH_LIMIT ?? "50", 10);
const MAX_ATTEMPTS = parseInt(process.env.OUTBOX_MAX_ATTEMPTS ?? "10", 10);

/** Redis key used as a distributed lock so only one processor runs at a time. */
const LOCK_KEY = "outbox:processor:lock";
const LOCK_TTL_MS = 55_000; // 55 s — slightly less than a 1-minute cron interval

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

/**
 * Fetch and process a batch of pending outbox events.
 *
 * Acquires a Redis distributed lock before processing to prevent race
 * conditions between multiple processor instances. Uses exponential backoff
 * (2^attempt seconds, capped at 3600s) for failed events.
 *
 * Errors from individual event handlers are caught and recorded without
 * aborting the rest of the batch.
 *
 * @returns Summary counts for observability / cron response bodies.
 */
export async function processOutboxEvents(): Promise<ProcessOutboxResult> {
  const result: ProcessOutboxResult = { processed: 0, succeeded: 0, failed: 0 };

  // Acquire distributed Redis lock to prevent concurrent processors.
  const redis = await getRedis();
  const lockAcquired = await redis.set(LOCK_KEY, "1", { NX: true, PX: LOCK_TTL_MS });
  if (!lockAcquired) {
    logger.debug("[outbox-processor] Lock held by another instance — skipping");
    return result;
  }

  try {
    const events = await getPendingEvents(BATCH_LIMIT);

    if (events.length === 0) {
      logger.debug("[outbox-processor] No pending events");
      return result;
    }

    logger.info({ count: events.length }, "[outbox-processor] Processing outbox batch");

    for (const event of events) {
      result.processed++;

      try {
        await dispatchEvent(event);
        await markEventProcessed(event.id);
        result.succeeded++;

        logger.info(
          { eventId: event.id, eventType: event.event_type, aggregateType: event.aggregate_type },
          "[outbox-processor] Event delivered"
        );
      } catch (err) {
        result.failed++;

        const errorMessage = err instanceof Error ? err.message : String(err);
        const nextAttempt = event.attempts + 1;

        logger.error(
          {
            eventId: event.id,
            eventType: event.event_type,
            aggregateType: event.aggregate_type,
            attempt: nextAttempt,
            error: errorMessage,
          },
          "[outbox-processor] Event delivery failed"
        );

        await markEventFailed(event.id, errorMessage, MAX_ATTEMPTS);

        // Reschedule with exponential backoff if not yet dead.
        if (nextAttempt < MAX_ATTEMPTS) {
          await requeueEvent(event.id, nextAttempt);
        }
      }
    }

    logger.info(result, "[outbox-processor] Batch complete");

    // Emit dead-letter count metric for monitoring.
    try {
      const deadCount = await getDeadLetterCount();
      logger.info({ deadLetterCount: deadCount }, "[outbox-processor] dead_letter_count");
    } catch {
      // Non-fatal — metric emission must not interrupt the processing result.
    }

    return result;
  } finally {
    // Always release the lock.
    await redis.del(LOCK_KEY);
  }
}
