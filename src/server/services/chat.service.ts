import { query, transaction } from "@/lib/db";
import type { CircleMessage, MessageReaction, ReactionCount, ReactionEmoji } from "@/types";
import { ALLOWED_REACTIONS } from "@/types";

export interface GetMessagesOptions {
  limit?: number;  // 1–100, default 50
  before?: string; // ISO 8601 timestamp cursor
}

export async function postMessage(
  circleId: string,
  userId: string,
  content: string,
  parentMessageId?: string
): Promise<CircleMessage> {
  // If this is a reply, verify the parent exists and belongs to the same circle
  if (parentMessageId) {
    const { rows: parentRows } = await query<{ id: string }>(
      `SELECT id FROM circle_messages WHERE id = $1 AND circle_id = $2 AND parent_message_id IS NULL`,
      [parentMessageId, circleId]
    );
    if (parentRows.length === 0) {
      throw new Error("Parent message not found or is itself a reply");
    }
  }

  const insertResult = await query<{ id: string }>(
    `INSERT INTO circle_messages (id, circle_id, user_id, content, parent_message_id, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
     RETURNING id`,
    [circleId, userId, content, parentMessageId ?? null]
  );

  const messageId = insertResult.rows[0].id;

  const { rows } = await query<{
    id: string;
    circleId: string;
    userId: string;
    displayName: string;
    content: string;
    createdAt: Date;
    parentMessageId: string | null;
  }>(
    `SELECT
       cm.id,
       cm.circle_id        AS "circleId",
       cm.user_id          AS "userId",
       u.display_name      AS "displayName",
       cm.content,
       cm.created_at       AS "createdAt",
       cm.parent_message_id AS "parentMessageId"
     FROM circle_messages cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.id = $1`,
    [messageId]
  );

  return { ...rows[0], reactions: [], replyCount: 0 };
}

/**
 * Deletes a circle chat message — the moderation boundary for #41.
 *
 * Authorization boundary: only the message author or the circle's creator
 * (circle admin) may delete a message. Anyone else is rejected, including
 * other active members of the circle.
 *
 * Throws:
 *   - "Message not found" if the message (or circle) does not exist
 *   - "Forbidden" if the requesting user is neither the author nor the creator
 */
export async function deleteMessage(
  circleId: string,
  messageId: string,
  requestingUserId: string
): Promise<void> {
  const { rows: messageRows } = await query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM circle_messages WHERE id = $1 AND circle_id = $2`,
    [messageId, circleId]
  );
  if (messageRows.length === 0) {
    throw new Error("Message not found");
  }
  const message = messageRows[0];

  const { rows: circleRows } = await query<{ creator_id: string }>(
    `SELECT creator_id FROM circles WHERE id = $1`,
    [circleId]
  );
  if (circleRows.length === 0) {
    throw new Error("Message not found");
  }
  const isAuthor = message.user_id === requestingUserId;
  const isCircleAdmin = circleRows[0].creator_id === requestingUserId;

  if (!isAuthor && !isCircleAdmin) {
    throw new Error("Forbidden");
  }

  await query(`DELETE FROM circle_messages WHERE id = $1 AND circle_id = $2`, [
    messageId,
    circleId,
  ]);
}

export async function getMessages(
  circleId: string,
  options?: GetMessagesOptions,
  currentUserId?: string
): Promise<CircleMessage[]> {
  const rawLimit = options?.limit ?? 50;
  const limit = Math.min(Math.max(rawLimit, 1), 100);
  const before = options?.before ?? null;

  // Fetch only top-level messages (parent_message_id IS NULL)
  const { rows } = await query<{
    id: string;
    circleId: string;
    userId: string;
    displayName: string;
    content: string;
    createdAt: Date;
    parentMessageId: string | null;
    replyCount: string;
  }>(
    `SELECT
       cm.id,
       cm.circle_id        AS "circleId",
       cm.user_id          AS "userId",
       u.display_name      AS "displayName",
       cm.content,
       cm.created_at       AS "createdAt",
       cm.parent_message_id AS "parentMessageId",
       COUNT(r.id)::text    AS "replyCount"
     FROM circle_messages cm
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN circle_messages r ON r.parent_message_id = cm.id
     WHERE cm.circle_id = $1
       AND cm.parent_message_id IS NULL
       AND ($2::timestamp IS NULL OR cm.created_at < $2::timestamp)
     GROUP BY cm.id, u.display_name
     ORDER BY cm.created_at ASC
     LIMIT $3`,
    [circleId, before, limit]
  );

  if (rows.length === 0) return [];

  // Hydrate reactions for all returned messages in a single query
  const messageIds = rows.map((r) => r.id);
  const reactions = await getReactionsForMessages(messageIds, currentUserId);

  return rows.map((row) => ({
    id: row.id,
    circleId: row.circleId,
    userId: row.userId,
    displayName: row.displayName,
    content: row.content,
    createdAt: row.createdAt,
    parentMessageId: row.parentMessageId,
    replyCount: parseInt(row.replyCount, 10),
    reactions: reactions[row.id] ?? [],
  }));
}

/**
 * Fetch threaded replies for a parent message.
 */
export async function getThreadReplies(
  circleId: string,
  parentMessageId: string,
  currentUserId?: string
): Promise<CircleMessage[]> {
  // Verify parent exists and belongs to this circle
  const { rows: parentRows } = await query<{ id: string }>(
    `SELECT id FROM circle_messages WHERE id = $1 AND circle_id = $2 AND parent_message_id IS NULL`,
    [parentMessageId, circleId]
  );
  if (parentRows.length === 0) throw new Error("Parent message not found");

  const { rows } = await query<{
    id: string;
    circleId: string;
    userId: string;
    displayName: string;
    content: string;
    createdAt: Date;
    parentMessageId: string;
  }>(
    `SELECT
       cm.id,
       cm.circle_id        AS "circleId",
       cm.user_id          AS "userId",
       u.display_name      AS "displayName",
       cm.content,
       cm.created_at       AS "createdAt",
       cm.parent_message_id AS "parentMessageId"
     FROM circle_messages cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.circle_id = $1
       AND cm.parent_message_id = $2
     ORDER BY cm.created_at ASC`,
    [circleId, parentMessageId]
  );

  if (rows.length === 0) return [];

  const replyIds = rows.map((r) => r.id);
  const reactions = await getReactionsForMessages(replyIds, currentUserId);

  return rows.map((row) => ({
    ...row,
    replyCount: 0,
    reactions: reactions[row.id] ?? [],
  }));
}

// ─── Reactions ────────────────────────────────────────────────────────────────

/**
 * Fetch aggregated reaction counts for a set of message IDs.
 * Returns a map of messageId → ReactionCount[].
 */
async function getReactionsForMessages(
  messageIds: string[],
  currentUserId?: string
): Promise<Record<string, ReactionCount[]>> {
  if (messageIds.length === 0) return {};

  const { rows } = await query<{
    message_id: string;
    emoji: string;
    count: string;
    user_reacted: boolean;
  }>(
    `SELECT
       mr.message_id,
       mr.emoji,
       COUNT(*)::text AS count,
       bool_or(mr.user_id = $2) AS user_reacted
     FROM message_reactions mr
     WHERE mr.message_id = ANY($1::uuid[])
     GROUP BY mr.message_id, mr.emoji
     ORDER BY mr.message_id, count DESC`,
    [messageIds, currentUserId ?? null]
  );

  const result: Record<string, ReactionCount[]> = {};
  for (const row of rows) {
    if (!result[row.message_id]) result[row.message_id] = [];
    result[row.message_id].push({
      emoji: row.emoji as ReactionEmoji,
      count: parseInt(row.count, 10),
      reacted: row.user_reacted,
    });
  }
  return result;
}

/**
 * Add an emoji reaction to a message.
 * Returns the updated reaction counts for that message.
 * Throws if:
 *  - the message is not in the given circle
 *  - the emoji is not in the allowed set
 *  - the user has already reacted with this emoji (idempotent guard)
 */
export async function addReaction(
  circleId: string,
  messageId: string,
  userId: string,
  emoji: string
): Promise<ReactionCount[]> {
  if (!(ALLOWED_REACTIONS as readonly string[]).includes(emoji)) {
    throw new Error(`Emoji not allowed. Supported: ${ALLOWED_REACTIONS.join(" ")}`);
  }

  // Verify message belongs to this circle
  const { rows: msgRows } = await query<{ id: string }>(
    `SELECT id FROM circle_messages WHERE id = $1 AND circle_id = $2`,
    [messageId, circleId]
  );
  if (msgRows.length === 0) throw new Error("Message not found");

  // Upsert — silently ignore duplicate (idempotent)
  await query(
    `INSERT INTO message_reactions (message_id, user_id, emoji)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
    [messageId, userId, emoji]
  );

  const updated = await getReactionsForMessages([messageId], userId);
  return updated[messageId] ?? [];
}

/**
 * Remove an emoji reaction from a message.
 */
export async function removeReaction(
  circleId: string,
  messageId: string,
  userId: string,
  emoji: string,
  requestingUserId: string
): Promise<ReactionCount[]> {
  // Verify message belongs to this circle
  const { rows: msgRows } = await query<{ id: string; user_id: string }>(
    `SELECT mr.id, mr.user_id
     FROM message_reactions mr
     JOIN circle_messages cm ON cm.id = mr.message_id
     WHERE mr.message_id = $1 AND cm.circle_id = $2 AND mr.user_id = $3 AND mr.emoji = $4`,
    [messageId, circleId, userId, emoji]
  );

  if (msgRows.length === 0) throw new Error("Reaction not found");

  // Only the reaction owner or an admin can remove it
  const { rows: circleRows } = await query<{ creator_id: string }>(
    `SELECT creator_id FROM circles WHERE id = $1`,
    [circleId]
  );
  const isCreator = circleRows[0]?.creator_id === requestingUserId;
  const isOwner = userId === requestingUserId;

  if (!isOwner && !isCreator) throw new Error("Forbidden");

  await query(
    `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
    [messageId, userId, emoji]
  );

  const updated = await getReactionsForMessages([messageId], requestingUserId);
  return updated[messageId] ?? [];
}

/**
 * Admin delete: remove any reaction (by reaction id) regardless of owner.
 */
export async function adminDeleteReaction(
  circleId: string,
  reactionId: string,
  adminUserId: string
): Promise<void> {
  // Verify requester is admin or circle creator
  const { rows: adminRows } = await query<{ role: string }>(
    `SELECT role FROM users WHERE id = $1`,
    [adminUserId]
  );
  const { rows: circleRows } = await query<{ creator_id: string }>(
    `SELECT creator_id FROM circles WHERE id = $1`,
    [circleId]
  );
  const isAdmin = adminRows[0]?.role === "admin";
  const isCreator = circleRows[0]?.creator_id === adminUserId;

  if (!isAdmin && !isCreator) throw new Error("Forbidden");

  await query(`DELETE FROM message_reactions WHERE id = $1`, [reactionId]);
}
