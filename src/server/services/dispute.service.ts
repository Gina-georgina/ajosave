import { query } from "@/lib/db";
import { randomUUID } from "crypto";
import type { Dispute, DisputeType, DisputeStatus } from "@/types";
import { recordDisputeEvent } from "./dispute-timeline.service";

const DISPUTE_SELECT = `
  id, contribution_id as "contributionId", member_id as "memberId",
  circle_id as "circleId", paystack_reference as "paystackReference",
  type, reason, evidence, status,
  resolution_notes as "resolutionNotes",
  resolved_by as "resolvedBy", created_at as "createdAt", resolved_at as "resolvedAt"
`;

export async function createDispute(
  contributionId: string | undefined,
  memberId: string,
  circleId: string,
  reason: string,
  type: DisputeType = "other",
  evidence?: string,
  paystackReference?: string
): Promise<Dispute> {
  const { rows } = await query<Dispute>(
    `INSERT INTO disputes (id, contribution_id, member_id, circle_id, paystack_reference, type, reason, evidence, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', NOW())
     RETURNING ${DISPUTE_SELECT}`,
    [randomUUID(), contributionId || null, memberId, circleId, paystackReference || null, type, reason, evidence || null]
  );

  await recordDisputeEvent(rows[0].id, "created", memberId, reason);
  if (evidence) await recordDisputeEvent(rows[0].id, "evidence_added", memberId, evidence);

  // Notify admins asynchronously
  notifyAdminsOfNewDispute(circleId, reason, type).catch((err) =>
    console.error("[dispute] Admin notification failed:", err)
  );

  return rows[0];
}

async function notifyAdminsOfNewDispute(circleId: string, reason: string, type: string): Promise<void> {
  const { rows: admins } = await query<{ email: string | null; phone: string | null }>(
    `SELECT email, phone FROM users WHERE role = 'admin' AND deleted_at IS NULL`
  );

  const { sendEmail } = await import("@/lib/email");
  const { sendSms } = await import("@/lib/sms");

  await Promise.allSettled(
    admins.map(async (admin) => {
      if (admin.email) {
        await sendEmail({
          to: admin.email,
          subject: "New Dispute Submitted",
          html: `<p>A new <strong>${type}</strong> dispute was submitted for circle <code>${circleId}</code>.</p><p>${reason}</p><p>Review it in the <a href="/admin">Admin Dashboard</a>.</p>`,
        });
      }
      if (admin.phone) {
        await sendSms(admin.phone, `Ajosave: New ${type} dispute on circle ${circleId}. Review in admin panel.`);
      }
    })
  );
}

export async function getDisputesByCircle(circleId: string): Promise<Dispute[]> {
  const { rows } = await query<Dispute>(
    `SELECT ${DISPUTE_SELECT} FROM disputes WHERE circle_id = $1 ORDER BY created_at DESC`,
    [circleId]
  );
  return rows;
}

export async function getDisputesByMember(memberId: string): Promise<Dispute[]> {
  const { rows } = await query<Dispute>(
    `SELECT ${DISPUTE_SELECT} FROM disputes WHERE member_id = $1 ORDER BY created_at DESC`,
    [memberId]
  );
  return rows;
}

export async function getAllDisputes(): Promise<Dispute[]> {
  const { rows } = await query<Dispute>(
    `SELECT ${DISPUTE_SELECT} FROM disputes ORDER BY created_at DESC`
  );
  return rows;
}

export async function updateDisputeStatus(
  disputeId: string,
  status: DisputeStatus
): Promise<Dispute> {
  const { rows } = await query<Dispute>(
    `UPDATE disputes SET status = $2 WHERE id = $1 RETURNING ${DISPUTE_SELECT}`,
    [disputeId, status]
  );
  if (rows[0]) await recordDisputeEvent(disputeId, "status_changed", null, status);
  return rows[0];
}

export async function resolveDispute(
  disputeId: string,
  status: "resolved" | "rejected",
  resolutionNotes: string,
  resolvedBy: string
): Promise<Dispute> {
  const { rows } = await query<Dispute>(
    `UPDATE disputes
     SET status = $2, resolution_notes = $3, resolved_by = $4, resolved_at = NOW()
     WHERE id = $1
     RETURNING ${DISPUTE_SELECT}`,
    [disputeId, status, resolutionNotes, resolvedBy]
  );
  if (rows[0]) await recordDisputeEvent(disputeId, "resolved", resolvedBy, `${status}: ${resolutionNotes}`);
  return rows[0];
}

export async function confirmContributionFromDispute(
  disputeId: string,
  contributionId: string,
  txHash: string
): Promise<void> {
  await query(
    `UPDATE contributions SET status = 'confirmed', tx_hash = $2 WHERE id = $3`,
    [disputeId, txHash, contributionId]
  );

  const { rows } = await query<{ user_id: string }>(
    `SELECT m.user_id FROM contributions c
     JOIN members m ON m.id = c.member_id
     WHERE c.id = $1`,
    [contributionId]
  );

  if (rows[0]?.user_id) {
    const { incrementReputationOnContribution } = await import("./reputation.service");
    await incrementReputationOnContribution(rows[0].user_id);
  }
}
