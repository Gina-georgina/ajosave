/**
 * Transactional Outbox — core data-access layer.
 *
 * Outbox events are inserted in the same DB transaction as the business
 * operation that produces them. A background processor polls for pending
 * events and delivers them to external systems (SMS, email, webhooks).
 *
 * All writes MUST use parameterised queries. Never interpolate user input.
 *
 * Usage inside a transaction:
 *   await transaction(async (q) => {
 *     await q("UPDATE circles SET ...", [...]);
 *     await enqueueEvent("circle", circleId, "payout.processed", payload, q);
 *   });
 *
 * Usage outside a transaction (fire-and-forget, best-effort):
 *   await enqueueEvent("user", userId, "user.registered", payload);
 */

import { query as defaultQuery } from "@/lib/db";
import type { QueryResult, QueryResultRow } from "pg";

/** Matches the columns of the `outbox_events` table. */
export interface OutboxEvent {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "dead";
  attempts: number;
  last_error: string | null;
  scheduled_at: Date;
  processed_at: Date | null;
  created_at: Date;
}

/** The query function signature exported from `@/lib/db`. */
type QueryFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) => Promise<QueryResult<T>>;

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_LIMIT = 100;
const BACKOFF_CAP_SECONDS = 3600; // 2^attempt seconds, capped at 1 hour

/**
 * Insert an outbox event, optionally within an existing transaction.
 *
 * @param aggregateType - Domain entity type (e.g. "circle", "user")
 * @param aggregateId   - ID of the entity
 * @param eventType     - Event name (e.g. "payout.processed")
 * @param payload       - Arbitrary JSON payload for the handler
 * @param q             - Optional bound query function from `transaction(fn)`.
 *                        Pass this to ensure the insert shares the caller's
 *                        transaction — if the transaction rolls back, the event
 *                        is never stored.
 */
export async function enqueueEvent(
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown>,
  q: QueryFn = defaultQuery
): Promise<OutboxEvent> {
  const { rows } = await q<OutboxEvent>(
    `INSERT INTO outbox_events
       (aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [aggregateType, aggregateId, eventType, JSON.stringify(payload)]
  );
  return rows[0];
}

/**
 * Fetch pending events ordered by `scheduled_at` ASC (oldest first).
 *
 * Uses `FOR UPDATE SKIP LOCKED` so that concurrent processors each claim
 * a distinct set of rows without contention.
 *
 * @param limit - Maximum number of rows to return (default: 100)
 */
export async function getPendingEvents(limit = DEFAULT_LIMIT): Promise<OutboxEvent[]> {
  const { rows } = await defaultQuery<OutboxEvent>(
    `SELECT *
       FROM outbox_events
      WHERE status = 'pending'
        AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit]
  );
  return rows;
}

/**
 * Mark an event as successfully delivered.
 *
 * @param id - UUID of the outbox event
 */
export async function markEventProcessed(id: string): Promise<void> {
  await defaultQuery(
    `UPDATE outbox_events
        SET status = 'delivered',
            processed_at = NOW()
      WHERE id = $1`,
    [id]
  );
}

/**
 * Record a delivery failure.
 *
 * Increments `attempts` and stores the error message. If the event has
 * reached `maxAttempts`, it is moved to status `'dead'` (dead-letter queue)
 * so it no longer blocks the processor loop.
 *
 * @param id          - UUID of the outbox event
 * @param error       - Human-readable error description
 * @param maxAttempts - Attempt ceiling before marking dead (default: 5)
 */
export async function markEventFailed(
  id: string,
  error: string,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<void> {
  await defaultQuery(
    `UPDATE outbox_events
        SET attempts   = attempts + 1,
            last_error = $2,
            status     = CASE
                           WHEN attempts + 1 >= $3 THEN 'dead'
                           ELSE status
                         END
      WHERE id = $1`,
    [id, error, maxAttempts]
  );
}

/**
 * Compute exponential backoff delay in milliseconds.
 *
 * Delay = min(2^attempt, BACKOFF_CAP_SECONDS) seconds.
 * Example: attempt 1 → 2s, 2 → 4s, 3 → 8s … capped at 3600s.
 *
 * @param attempt - Current attempt count (1-based)
 */
export function computeBackoffMs(attempt: number): number {
  const seconds = Math.min(Math.pow(2, attempt), BACKOFF_CAP_SECONDS);
  return seconds * 1_000;
}

/**
 * Reschedule a failed event for a future retry using exponential backoff.
 *
 * Resets the status to `'pending'` and pushes `scheduled_at` forward by
 * `2^attempt` seconds (capped at 3600s). Pass `delayMs` to override.
 *
 * @param id      - UUID of the outbox event
 * @param attempt - Current attempt number (used to compute backoff)
 * @param delayMs - Optional override; if omitted, computed from `attempt`
 */
export async function requeueEvent(id: string, attempt: number, delayMs?: number): Promise<void> {
  const delay = delayMs ?? computeBackoffMs(attempt);
  await defaultQuery(
    `UPDATE outbox_events
        SET status       = 'pending',
            scheduled_at = NOW() + ($2 * INTERVAL '1 millisecond')
      WHERE id = $1`,
    [id, delay]
  );
}

/**
 * List dead-letter events for admin review.
 *
 * @param limit  - Max rows (default: 50)
 * @param offset - Pagination offset (default: 0)
 */
export async function getDeadLetterEvents(
  limit = 50,
  offset = 0
): Promise<OutboxEvent[]> {
  const { rows } = await defaultQuery<OutboxEvent>(
    `SELECT *
       FROM outbox_events
      WHERE status = 'dead'
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

/**
 * Replay a dead-letter event by resetting it to `'pending'` with attempts
 * cleared so it gets a fresh backoff sequence.
 *
 * @param id - UUID of the outbox event to replay
 */
export async function replayDeadLetterEvent(id: string): Promise<OutboxEvent | null> {
  const { rows } = await defaultQuery<OutboxEvent>(
    `UPDATE outbox_events
        SET status       = 'pending',
            attempts     = 0,
            last_error   = NULL,
            scheduled_at = NOW()
      WHERE id = $1 AND status = 'dead'
      RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Count of events currently in dead-letter state (for metrics).
 */
export async function getDeadLetterCount(): Promise<number> {
  const { rows } = await defaultQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM outbox_events WHERE status = 'dead'`
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}
