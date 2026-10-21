import { query } from "@/lib/db";
import logger from "@/lib/logger";

export type DisputeEventType = "created" | "evidence_added" | "status_changed" | "resolved";

export interface DisputeEvent {
  id: string;
  disputeId: string;
  eventType: DisputeEventType;
  actorId: string | null;
  detail: string | null;
  createdAt: string;
}

/** Best-effort: a timeline write failure must never block the dispute action itself. */
export async function recordDisputeEvent(
  disputeId: string,
  eventType: DisputeEventType,
  actorId?: string | null,
  detail?: string | null
): Promise<void> {
  try {
    await query(
      `INSERT INTO dispute_events (dispute_id, event_type, actor_id, detail) VALUES ($1, $2, $3, $4)`,
      [disputeId, eventType, actorId ?? null, detail ?? null]
    );
  } catch (err) {
    logger.error({ msg: "dispute.timeline_write_failed", disputeId, eventType, err });
  }
}

export async function getDisputeTimeline(disputeId: string): Promise<DisputeEvent[]> {
  const { rows } = await query<DisputeEvent>(
    `SELECT id, dispute_id AS "disputeId", event_type AS "eventType", actor_id AS "actorId",
            detail, created_at AS "createdAt"
     FROM dispute_events WHERE dispute_id = $1 ORDER BY created_at ASC, id ASC`,
    [disputeId]
  );
  return rows;
}

export async function canViewDispute(disputeId: string, userId: string, role: string): Promise<boolean> {
  if (role === "admin") return true;
  const { rows } = await query(
    `SELECT 1 FROM disputes d JOIN members m ON m.id = d.member_id WHERE d.id = $1 AND m.user_id = $2`,
    [disputeId, userId]
  );
  return rows.length > 0;
}
