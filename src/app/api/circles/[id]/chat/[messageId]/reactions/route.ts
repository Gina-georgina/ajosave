import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { withErrorHandler, withRateLimit } from "@/server/middleware";
import { addReaction, removeReaction } from "@/server/services/chat.service";
import type { ApiResponse, ReactionCount } from "@/types";
import { ALLOWED_REACTIONS } from "@/types";

type RouteCtx = { params: { id: string; messageId: string } };

function getMemberCheck(circleId: string, userId: string) {
  return query<{ id: string }>(
    `SELECT id FROM members WHERE circle_id = $1 AND user_id = $2 AND status = 'active'`,
    [circleId, userId]
  );
}

/**
 * POST /api/circles/[id]/chat/[messageId]/reactions
 * Body: { emoji: "👍" | "❤️" | "😂" | "🙏" }
 *
 * Add a reaction to a message. Idempotent — adding the same emoji twice is a no-op.
 */
export const POST = withRateLimit(
  withErrorHandler(async (req: NextRequest, ctx: unknown) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { params } = ctx as RouteCtx;
    const { id: circleId, messageId } = params;
    const userId = (session.user as { id: string }).id;

    const { rows: memberRows } = await getMemberCheck(circleId, userId);
    if (memberRows.length === 0) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { emoji } = body;
    if (!emoji || typeof emoji !== "string") {
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: `emoji is required. Allowed: ${ALLOWED_REACTIONS.join(" ")}`,
        },
        { status: 400 }
      );
    }

    const reactions = await addReaction(circleId, messageId, userId, emoji);
    return NextResponse.json<ApiResponse<ReactionCount[]>>(
      { success: true, data: reactions },
      { status: 201 }
    );
  }),
  { limit: 60, windowMs: 60_000 }
);

/**
 * DELETE /api/circles/[id]/chat/[messageId]/reactions
 * Body: { emoji: string; userId?: string }
 *
 * Remove a reaction. Regular members can only remove their own reactions.
 * Circle creator/admin can remove any reaction (moderation).
 */
export const DELETE = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { params } = ctx as RouteCtx;
  const { id: circleId, messageId } = params;
  const requestingUserId = (session.user as { id: string }).id;

  const { rows: memberRows } = await getMemberCheck(circleId, requestingUserId);
  if (memberRows.length === 0) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Forbidden" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const { emoji, userId: targetUserId } = body;

  if (!emoji || typeof emoji !== "string") {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "emoji is required" },
      { status: 400 }
    );
  }

  // When targetUserId is not provided, default to removing the requester's own reaction
  const reactionOwner = typeof targetUserId === "string" ? targetUserId : requestingUserId;

  const reactions = await removeReaction(
    circleId,
    messageId,
    reactionOwner,
    emoji,
    requestingUserId
  );

  return NextResponse.json<ApiResponse<ReactionCount[]>>(
    { success: true, data: reactions },
    { status: 200 }
  );
});
